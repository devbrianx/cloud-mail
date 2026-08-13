import BizError from '../error/biz-error';
import constant from '../const/constant';
import { attConst, emailConst, isDel } from '../const/entity-const';
import attService from './att-service';
import emailService from './email-service';
import fileUtils from '../utils/file-utils';
import outlookGraphService from './outlook-graph-service';

const LOCK_TTL_SECONDS = 60;

const GRAPH_FOLDERS = ['inbox', 'junkemail'];

const INITIAL_SYNC_DAYS = 30;
const ATTACHMENT_DOWNLOAD_CONCURRENCY = 3;

async function mapConcurrent(values, limit, mapper) {
	const results = new Array(values.length);
	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < values.length) {
			const index = nextIndex++;
			results[index] = await mapper(values[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
	return results;
}

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
			const localAccounts = (await c.env.db.prepare(`SELECT account_id, email, name FROM account WHERE user_id = ? AND is_del = 0`).bind(userId).all()).results;
			const localAccountByEmail = new Map(localAccounts.map(account => [account.email.toLowerCase(), account]));
			const states = (await c.env.db.prepare(`SELECT folder, delta_link FROM outlook_folder_state WHERE outlook_connection_id = ?`).bind(connection.connection_id).all()).results;
			const receivedAfter = new Date(Date.now() - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000).toISOString();
			const results = await Promise.all(GRAPH_FOLDERS.map(folder => this.syncFolder(c, connection, accounts, localAccountByEmail, accessToken, states, folder, receivedAfter)));
			const received = results.reduce((total, result) => total + result.received, 0);
			const skipped = results.reduce((total, result) => total + result.skipped, 0);
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

	async syncFolder(c, connection, accounts, localAccountByEmail, accessToken, states, folder, receivedAfter) {
		let url = states.find(state => state.folder === folder)?.delta_link || outlookGraphService.initialDeltaUrl(folder === 'junkemail' ? 'JunkEmail' : 'Inbox', receivedAfter);
		let deltaLink = '';
		let received = 0;
		let skipped = 0;
		while (url) {
			const page = await outlookGraphService.get(accessToken, url);
			const pageResult = await this.persistPage(c, accounts, localAccountByEmail, accessToken, page.value || [], folder);
			received += pageResult.received;
			skipped += pageResult.skipped;
			url = page['@odata.nextLink'] || '';
			deltaLink = page['@odata.deltaLink'] || deltaLink;
		}
		if (!deltaLink) throw new BizError('Microsoft Graph returned no delta cursor', 502);
		await c.env.db.prepare(`INSERT INTO outlook_folder_state(outlook_connection_id, folder, delta_link) VALUES (?, ?, ?) ON CONFLICT(outlook_connection_id, folder) DO UPDATE SET delta_link = excluded.delta_link`).bind(connection.connection_id, folder, deltaLink).run();
		return { received, skipped };
	},

	async persistPage(c, accounts, localAccountByEmail, accessToken, messages, folder) {
		const validMessages = messages.filter(message => !message['@removed'] && message.id);
		let skipped = messages.length - validMessages.length;
		if (!validMessages.length || !accounts.length) return { received: 0, skipped: skipped + validMessages.length };

		const accountIds = accounts.map(account => account.outlook_account_id);
		const messageIds = validMessages.map(message => message.id);
		const accountPlaceholders = accountIds.map(() => '?').join(',');
		const messagePlaceholders = messageIds.map(() => '?').join(',');
		const knownRows = (await c.env.db.prepare(`SELECT outlook_account_id, graph_message_id, folder FROM outlook_message WHERE outlook_account_id IN (${accountPlaceholders}) AND graph_message_id IN (${messagePlaceholders})`).bind(...accountIds, ...messageIds).all()).results;
		const knownMessages = new Map(knownRows.map(row => [`${row.outlook_account_id}:${row.graph_message_id}`, row]));
		const folderUpdates = [];
		let received = 0;

		for (const message of validMessages) {
			const unseen = [];
			for (const account of accounts) {
				const known = knownMessages.get(`${account.outlook_account_id}:${message.id}`);
				if (!known) unseen.push(account);
				else if (known.folder !== folder) folderUpdates.push(c.env.db.prepare(`UPDATE outlook_message SET folder = ? WHERE outlook_account_id = ? AND graph_message_id = ?`).bind(folder, account.outlook_account_id, message.id));
			}
			if (!unseen.length) { skipped++; continue; }
			const attachments = message.hasAttachments ? await this.loadAttachments(accessToken, message.id) : [];
			for (const account of unseen) await this.persistMessage(c, account, localAccountByEmail.get(account.email.toLowerCase()), message, attachments, folder);
			received += unseen.length;
		}

		if (folderUpdates.length) await c.env.db.batch(folderUpdates);
		return { received, skipped };
	},

	async persistMessage(c, providerAccount, localAccount, message, attachments, folder) {
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
		const fileAttachments = (response.value || []).filter(item => item.id && String(item['@odata.type'] || '').includes('fileAttachment'));
		return mapConcurrent(fileAttachments, ATTACHMENT_DOWNLOAD_CONCURRENCY, async item => {
			const content = await outlookGraphService.bytes(accessToken, outlookGraphService.attachmentValueUrl(messageId, item.id));
			const filename = item.name || 'attachment';
			return { key: constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(content) + fileUtils.getExtFileName(filename), filename, mimeType: item.contentType || 'application/octet-stream', size: content.byteLength, content, contentId: item.contentId || null, disposition: item.isInline ? 'inline' : 'attachment', type: item.isInline ? attConst.type.EMBED : attConst.type.ATT };
		});
	}
};

export default outlookSyncService;
