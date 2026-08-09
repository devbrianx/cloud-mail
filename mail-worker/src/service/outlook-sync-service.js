import BizError from '../error/biz-error';
import constant from '../const/constant';
import { attConst, emailConst, isDel } from '../const/entity-const';
import attService from './att-service';
import emailService from './email-service';
import fileUtils from '../utils/file-utils';
import outlookGraphService from './outlook-graph-service';

const LOCK_TTL_SECONDS = 60;

function recipientList(values = []) {
	return values.filter(value => value?.emailAddress?.address).map(value => ({ address: value.emailAddress.address, name: value.emailAddress.name || '' }));
}

function safeError(error) {
	return error instanceof BizError ? error.message : 'Outlook synchronization failed';
}

async function activeOutlookAccount(c, userId, outlookAccountId) {
	const row = await c.env.db.prepare(`SELECT * FROM outlook_account WHERE outlook_account_id = ? AND user_id = ? AND is_del = 0`).bind(outlookAccountId, userId).first();
	if (!row) throw new BizError('Outlook account not found', 404);
	return row;
}

async function resolveAccount(c, userId, params) {
	const hasOutlookId = params.outlookAccountId !== undefined && params.outlookAccountId !== null;
	const hasLocalId = params.accountId !== undefined && params.accountId !== null;
	if (hasOutlookId === hasLocalId) throw new BizError('Provide exactly one Outlook or local account ID', 400);
	if (hasOutlookId) return { account: await activeOutlookAccount(c, userId, Number(params.outlookAccountId)), isOutlook: true };
	const local = await c.env.db.prepare(`SELECT account_id, email FROM account WHERE account_id = ? AND user_id = ? AND is_del = 0`).bind(Number(params.accountId), userId).first();
	if (!local) throw new BizError('Email account not found', 404);
	const provider = await c.env.db.prepare(`SELECT * FROM outlook_account WHERE user_id = ? AND email COLLATE NOCASE = ? AND is_del = 0`).bind(userId, local.account_id ? local.email : '').first();
	return { account: provider, isOutlook: Boolean(provider) };
}

const outlookSyncService = {
	async status(c, userId, outlookAccountId) {
		const account = await activeOutlookAccount(c, userId, Number(outlookAccountId));
		const row = await c.env.db.prepare(`SELECT COUNT(*) receivedCount FROM outlook_message WHERE outlook_account_id = ?`).bind(account.outlook_account_id).first();
		return { syncStatus: account.sync_status, syncError: account.sync_error, lastSyncTime: account.last_sync_time, receivedCount: row.receivedCount };
	},

	async run(c, userId, params) {
		const resolved = await resolveAccount(c, userId, params);
		if (!resolved.isOutlook) return { isOutlook: false, received: 0, skipped: 0 };
		const account = resolved.account;
		const lockKey = `outlook-sync-lock:${account.outlook_account_id}`;
		if (await c.env.kv.get(lockKey)) throw new BizError('Outlook synchronization is already running', 409);
		await c.env.kv.put(lockKey, '1', { expirationTtl: LOCK_TTL_SECONDS });
		try {
			await c.env.db.prepare(`UPDATE outlook_account SET sync_status = 'syncing', sync_error = '', update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(account.outlook_account_id).run();
			const accessToken = await outlookGraphService.refreshAccessToken(c, account);
			let url = account.delta_link || outlookGraphService.initialDeltaUrl();
			let deltaLink = '';
			let received = 0;
			let skipped = 0;
			while (url) {
				const page = await outlookGraphService.get(accessToken, url);
				for (const message of page.value || []) {
					if (message['@removed'] || !message.id) { skipped++; continue; }
					const known = await c.env.db.prepare(`SELECT 1 FROM outlook_message WHERE outlook_account_id = ? AND graph_message_id = ?`).bind(account.outlook_account_id, message.id).first();
					if (known) { skipped++; continue; }
					await this.persistMessage(c, account, accessToken, message);
					received++;
				}
				url = page['@odata.nextLink'] || '';
				deltaLink = page['@odata.deltaLink'] || deltaLink;
			}
			if (!deltaLink) throw new BizError('Microsoft Graph returned no delta cursor', 502);
			const lastSyncTime = new Date().toISOString();
			await c.env.db.prepare(`UPDATE outlook_account SET delta_link = ?, sync_status = 'ready', sync_error = '', last_sync_time = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(deltaLink, lastSyncTime, account.outlook_account_id).run();
			return { isOutlook: true, received, skipped, lastSyncTime };
		} catch (error) {
			const invalidCursor = account.delta_link && error instanceof BizError && error.message === 'Microsoft Graph request failed';
			const syncError = invalidCursor ? 'Outlook sync cursor expired; refresh again to resync' : safeError(error);
			await c.env.db.prepare(`UPDATE outlook_account SET delta_link = ?, sync_status = ?, sync_error = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(invalidCursor ? '' : account.delta_link, invalidCursor ? 'ready' : 'error', syncError, account.outlook_account_id).run();
			throw error;
		} finally {
			await c.env.kv.delete(lockKey);
		}
	},

	async persistMessage(c, providerAccount, accessToken, message) {
		const localAccount = await c.env.db.prepare(`SELECT * FROM account WHERE user_id = ? AND email COLLATE NOCASE = ? AND is_del = 0`).bind(providerAccount.user_id, providerAccount.email).first();
		if (!localAccount) throw new BizError('Outlook local inbox account not found', 409);
		const sender = message.from?.emailAddress || {};
		const recipients = recipientList(message.toRecipients);
		const body = message.body || {};
		const params = {
			toEmail: providerAccount.email,
			toName: localAccount.name || providerAccount.email.split('@')[0],
			sendEmail: sender.address || '',
			name: sender.name || sender.address || '',
			subject: message.subject || '',
			code: '',
			content: body.contentType === 'html' ? body.content || '' : '',
			text: body.contentType === 'html' ? '' : body.content || '',
			cc: JSON.stringify(recipientList(message.ccRecipients)),
			bcc: '[]',
			recipient: JSON.stringify(recipients.length ? recipients : [{ address: providerAccount.email, name: localAccount.name || '' }]),
			inReplyTo: '',
			relation: '',
			messageId: message.internetMessageId || '',
			userId: providerAccount.user_id,
			accountId: localAccount.account_id,
			type: emailConst.type.RECEIVE,
			isDel: isDel.DELETE,
			status: emailConst.status.SAVING,
			unread: message.isRead ? 1 : 0,
			createTime: message.receivedDateTime || new Date().toISOString()
		};
		const row = await emailService.receive(c, params, [], '');
		try {
			if (message.hasAttachments) await this.persistAttachments(c, providerAccount, localAccount, accessToken, message.id, row.emailId);
			await emailService.completeReceive(c, emailConst.status.RECEIVE, row.emailId);
			await c.env.db.prepare(`INSERT INTO outlook_message(outlook_account_id, graph_message_id, email_id) VALUES (?, ?, ?)`).bind(providerAccount.outlook_account_id, message.id, row.emailId).run();
		} catch (error) {
			await c.env.db.prepare(`DELETE FROM email WHERE email_id = ?`).bind(row.emailId).run();
			throw error;
		}
	},

	async persistAttachments(c, providerAccount, localAccount, accessToken, messageId, emailId) {
		const response = await outlookGraphService.get(accessToken, outlookGraphService.attachmentUrl(messageId));
		const attachments = [];
		for (const item of response.value || []) {
			if (!item.id || !String(item['@odata.type'] || '').includes('fileAttachment')) continue;
			const content = await outlookGraphService.bytes(accessToken, outlookGraphService.attachmentValueUrl(messageId, item.id));
			const filename = item.name || 'attachment';
			attachments.push({
				key: constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(content) + fileUtils.getExtFileName(filename),
				filename,
				mimeType: item.contentType || 'application/octet-stream',
				size: content.byteLength,
				content,
				contentId: item.contentId || null,
				disposition: item.isInline ? 'inline' : 'attachment',
				userId: providerAccount.user_id,
				accountId: localAccount.account_id,
				emailId,
				type: item.isInline ? attConst.type.EMBED : attConst.type.ATT
			});
		}
		if (attachments.length) await attService.addAtt(c, attachments);
	}
};

export default outlookSyncService;
