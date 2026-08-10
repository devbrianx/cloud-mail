import BizError from '../error/biz-error';
import constant from '../const/constant';
import { attConst, emailConst, isDel } from '../const/entity-const';
import attService from './att-service';
import emailService from './email-service';
import fileUtils from '../utils/file-utils';
import outlookGraphService from './outlook-graph-service';

const LOCK_TTL_SECONDS = 60;

const GRAPH_FOLDERS = ['inbox', 'junkemail'];

function recipientList(values = []) {
	return values.filter(value => value?.emailAddress?.address).map(value => ({ address: value.emailAddress.address, name: value.emailAddress.name || '' }));
}

function safeError(error) {
	return error instanceof BizError ? error.message : 'Outlook synchronization failed';
}

async function activeOutlookAccount(c, userId, outlookAccountId) {
	const row = await c.env.db.prepare(`SELECT a.*, c.outlook_connection_id connection_id, c.provider_email, c.client_id, c.client_secret_ciphertext, c.refresh_token_ciphertext, c.sync_status, c.sync_error, c.last_sync_time FROM outlook_account a JOIN outlook_connection c ON c.outlook_connection_id = a.outlook_connection_id AND c.is_del = 0 WHERE a.outlook_account_id = ? AND a.user_id = ? AND a.is_del = 0`).bind(outlookAccountId, userId).first();
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
	const provider = await c.env.db.prepare(`SELECT a.*, c.outlook_connection_id connection_id, c.provider_email, c.client_id, c.client_secret_ciphertext, c.refresh_token_ciphertext, c.sync_status, c.sync_error, c.last_sync_time FROM outlook_account a JOIN outlook_connection c ON c.outlook_connection_id = a.outlook_connection_id AND c.is_del = 0 WHERE a.user_id = ? AND a.email COLLATE NOCASE = ? AND a.is_del = 0`).bind(userId, local.email).first();
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
		const connection = resolved.account;
		const lockKey = `outlook-sync-lock:${connection.connection_id}`;
		if (await c.env.kv.get(lockKey)) throw new BizError('Outlook synchronization is already running', 409);
		await c.env.kv.put(lockKey, '1', { expirationTtl: LOCK_TTL_SECONDS });
		try {
			await c.env.db.prepare(`UPDATE outlook_connection SET sync_status = 'syncing', sync_error = '', update_time = CURRENT_TIMESTAMP WHERE outlook_connection_id = ?`).bind(connection.connection_id).run();
			const accessToken = await outlookGraphService.refreshAccessToken(c, connection);
			const accounts = (await c.env.db.prepare(`SELECT * FROM outlook_account WHERE outlook_connection_id = ? AND user_id = ? AND is_del = 0`).bind(connection.connection_id, userId).all()).results;
			let received = 0;
			let skipped = 0;
			const states = (await c.env.db.prepare(`SELECT folder, delta_link FROM outlook_folder_state WHERE outlook_connection_id = ?`).bind(connection.connection_id).all()).results;
			for (const folder of GRAPH_FOLDERS) {
				let url = states.find(state => state.folder === folder)?.delta_link || outlookGraphService.initialDeltaUrl(folder === 'junkemail' ? 'JunkEmail' : 'Inbox');
				let deltaLink = '';
				while (url) {
					const page = await outlookGraphService.get(accessToken, url);
					for (const message of page.value || []) {
						if (message['@removed'] || !message.id) { skipped++; continue; }
						const destinations = accounts;
						if (!destinations.length) { skipped++; continue; }
						const unseen = [];
						for (const account of destinations) {
							const known = await c.env.db.prepare(`SELECT 1 FROM outlook_message WHERE outlook_account_id = ? AND graph_message_id = ?`).bind(account.outlook_account_id, message.id).first();
							if (known) await c.env.db.prepare(`UPDATE outlook_message SET folder = ? WHERE outlook_account_id = ? AND graph_message_id = ?`).bind(folder, account.outlook_account_id, message.id).run();
							else unseen.push(account);
						}
						if (!unseen.length) { skipped++; continue; }
						const attachments = message.hasAttachments ? await this.loadAttachments(accessToken, message.id) : [];
						for (const account of unseen) await this.persistMessage(c, account, accessToken, message, attachments, folder);
						received += unseen.length;
					}
					url = page['@odata.nextLink'] || '';
					deltaLink = page['@odata.deltaLink'] || deltaLink;
				}
				if (!deltaLink) throw new BizError('Microsoft Graph returned no delta cursor', 502);
				await c.env.db.prepare(`INSERT INTO outlook_folder_state(outlook_connection_id, folder, delta_link) VALUES (?, ?, ?) ON CONFLICT(outlook_connection_id, folder) DO UPDATE SET delta_link = excluded.delta_link`).bind(connection.connection_id, folder, deltaLink).run();
			}
			const lastSyncTime = new Date().toISOString();
			await c.env.db.prepare(`UPDATE outlook_connection SET sync_status = 'ready', sync_error = '', last_sync_time = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_connection_id = ?`).bind(lastSyncTime, connection.connection_id).run();
			return { isOutlook: true, received, skipped, lastSyncTime };
		} catch (error) {
			const invalidCursor = error instanceof BizError && error.message === 'Microsoft Graph request failed';
			const syncError = invalidCursor ? 'Outlook sync cursor expired; refresh again to resync' : safeError(error);
			if (invalidCursor) await c.env.db.prepare(`UPDATE outlook_folder_state SET delta_link = '' WHERE outlook_connection_id = ?`).bind(connection.connection_id).run();
			await c.env.db.prepare(`UPDATE outlook_connection SET sync_status = ?, sync_error = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_connection_id = ?`).bind(invalidCursor ? 'ready' : 'error', syncError, connection.connection_id).run();
			throw error;
		} finally { await c.env.kv.delete(lockKey); }
	},

	async persistMessage(c, providerAccount, accessToken, message, attachments, folder) {
		const localAccount = await c.env.db.prepare(`SELECT * FROM account WHERE user_id = ? AND email COLLATE NOCASE = ? AND is_del = 0 ORDER BY account_id ASC LIMIT 1`).bind(providerAccount.user_id, providerAccount.email).first();
		if (!localAccount) throw new BizError('Outlook local inbox account not found', 409);
		const sender = message.from?.emailAddress || {};
		const recipients = recipientList(message.toRecipients);
		const body = message.body || {};
		const row = await emailService.receive(c, { toEmail: providerAccount.email, toName: localAccount.name || providerAccount.email.split('@')[0], sendEmail: sender.address || '', name: sender.name || sender.address || '', subject: message.subject || '', code: '', content: body.contentType === 'html' ? body.content || '' : '', text: body.contentType === 'html' ? '' : body.content || '', cc: JSON.stringify(recipientList(message.ccRecipients)), bcc: '[]', recipient: JSON.stringify(recipients.length ? recipients : [{ address: providerAccount.email, name: localAccount.name || '' }]), inReplyTo: '', relation: '', messageId: message.internetMessageId || '', userId: providerAccount.user_id, accountId: localAccount.account_id, type: emailConst.type.RECEIVE, isDel: isDel.DELETE, status: emailConst.status.SAVING, unread: message.isRead ? 1 : 0, createTime: message.receivedDateTime || new Date().toISOString() }, [], '');
		try {
			if (attachments.length) await attService.addAtt(c, attachments.map(item => ({ ...item, userId: providerAccount.user_id, accountId: localAccount.account_id, emailId: row.emailId })));
			await emailService.completeReceive(c, emailConst.status.RECEIVE, row.emailId);
			await c.env.db.prepare(`INSERT INTO outlook_message(outlook_account_id, graph_message_id, email_id, folder) VALUES (?, ?, ?, ?)`).bind(providerAccount.outlook_account_id, message.id, row.emailId, folder).run();
		} catch (error) { await c.env.db.prepare(`DELETE FROM email WHERE email_id = ?`).bind(row.emailId).run(); throw error; }
	},
	async loadAttachments(accessToken, messageId) {
		const response = await outlookGraphService.get(accessToken, outlookGraphService.attachmentUrl(messageId));
		const attachments = [];
		for (const item of response.value || []) {
			if (!item.id || !String(item['@odata.type'] || '').includes('fileAttachment')) continue;
			const content = await outlookGraphService.bytes(accessToken, outlookGraphService.attachmentValueUrl(messageId, item.id));
			const filename = item.name || 'attachment';
			attachments.push({ key: constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(content) + fileUtils.getExtFileName(filename), filename, mimeType: item.contentType || 'application/octet-stream', size: content.byteLength, content, contentId: item.contentId || null, disposition: item.isInline ? 'inline' : 'attachment', type: item.isInline ? attConst.type.EMBED : attConst.type.ATT });
		}
		return attachments;
	}
};

export default outlookSyncService;
