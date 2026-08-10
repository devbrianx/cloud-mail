import BizError from '../error/biz-error';
import outlookCryptoService from './outlook-crypto-service';
import { isDel } from '../const/entity-const';

const MAX_IMPORT_LINES = 100;
const MAX_IMPORT_BYTES = 16 * 1024;
const microsoftTokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const graphMeUrl = 'https://graph.microsoft.com/v1.0/me';

function normalizedText(value, label) {
	if (typeof value !== 'string' || !value.trim()) throw new BizError(`${label} is required`, 400);
	return value.trim();
}

function normalizedEmail(value) {
	const email = normalizedText(value, 'Outlook email').toLowerCase();
	if (!/^\S+@\S+\.\S+$/.test(email)) throw new BizError('Outlook email is invalid', 400);
	return email;
}

function configuredOAuthCredential(value, errorMessage) {
	try { return normalizedText(value, errorMessage); } catch { throw new BizError(errorMessage, 500); }
}

function randomState() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function tokenRequest(params, resource) {
	const response = await fetch(microsoftTokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const code = typeof data.error === 'string' ? data.error : 'request_failed';
		throw new BizError(`Microsoft ${resource} token refresh failed (${code}); the client ID, refresh token, permissions, or client secret are invalid`, 400);
	}
	if (!data.access_token) throw new BizError(`Microsoft ${resource} authorization returned no access token`, 400);
	return data;
}

async function graphProfile(accessToken) {
	const response = await fetch(graphMeUrl, { headers: { authorization: `Bearer ${accessToken}` } });
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const code = typeof data?.error?.code === 'string' ? data.error.code : 'request_failed';
		throw new BizError(`Microsoft Graph profile validation failed (${code}); the token requires Graph User.Read permission`, 400);
	}
	return { email: normalizedEmail(data.mail || data.userPrincipalName), userPrincipalName: typeof data.userPrincipalName === 'string' ? data.userPrincipalName.trim() : '' };
}

function configuredClientSecret(c, clientId) {
	return c.env.outlook_client_id === clientId && typeof c.env.outlook_client_secret === 'string' && c.env.outlook_client_secret.trim() ? c.env.outlook_client_secret.trim() : '';
}

function positiveInteger(value) {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? number : null;
}

function accountIdsOf(value) {
	if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(id => !Number.isInteger(id) || id < 1)) throw new BizError('Outlook account ids are invalid', 400);
	const ids = new Set(value);
	if (ids.size !== value.length) throw new BizError('Outlook account ids are invalid', 400);
	return [...ids];
}
const outlookAccountService = {
	async ensureLocalInboxAccount(c, userId, email) {
		const existing = await c.env.db.prepare(`SELECT * FROM account WHERE user_id = ? AND email COLLATE NOCASE = ? AND is_del = 0 ORDER BY account_id ASC LIMIT 1`).bind(userId, email).first();
		if (existing) return existing;
		const foreign = await c.env.db.prepare(`SELECT account_id FROM account WHERE user_id <> ? AND email COLLATE NOCASE = ? AND is_del = 0`).bind(userId, email).first();
		if (foreign) throw new BizError('Outlook email belongs to another user', 409);
		await c.env.db.prepare(`INSERT INTO account(email, name, user_id, status, all_receive, sort, is_del) VALUES (?, ?, ?, 0, 0, 0, 0)`).bind(email, email.split('@')[0], userId).run();
		return c.env.db.prepare(`SELECT * FROM account WHERE user_id = ? AND email COLLATE NOCASE = ? AND is_del = 0 ORDER BY account_id ASC LIMIT 1`).bind(userId, email).first();
	},
	async list(c, userId, params = {}) {
		const limit = params.limit == null ? 50 : Number(params.limit);
		const offset = params.offset == null ? 0 : Number(params.offset);
		if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new BizError('Outlook account list is invalid', 400);
		const filters = ['a.user_id = ?', 'a.is_del = 0'];
		const bindings = [userId];
		const query = params.q == null ? '' : params.q;
		if (typeof query !== 'string' || query.length > 128) throw new BizError('Outlook account list is invalid', 400);
		const search = query.trim();
		if (search) {
			filters.push('a.email COLLATE NOCASE LIKE ?');
			bindings.push(`%${search}%`);
		}
		for (const [key, clause] of [['groupId', 'a.group_id = ?'], ['tagId', 'EXISTS (SELECT 1 FROM outlook_account_tag ft WHERE ft.outlook_account_id = a.outlook_account_id AND ft.outlook_tag_id = ?)'], ['outlookAccountId', 'a.outlook_account_id = ?']]) {
			if (params[key] === undefined || params[key] === '') continue;
			const value = positiveInteger(params[key]);
			if (value === null) throw new BizError('Outlook account list is invalid', 400);
			filters.push(clause);
			bindings.push(value);
		}
		const joins = 'FROM outlook_account a JOIN outlook_connection c ON c.outlook_connection_id = a.outlook_connection_id AND c.is_del = 0 LEFT JOIN outlook_group g ON g.outlook_group_id = a.group_id AND g.user_id = a.user_id';
		const where = `WHERE ${filters.join(' AND ')}`;
		const [rows, totalRow] = await Promise.all([
			c.env.db.prepare(`SELECT a.outlook_account_id outlookAccountId, a.email, (SELECT account_id FROM account WHERE user_id = a.user_id AND email COLLATE NOCASE = a.email AND is_del = 0 ORDER BY account_id ASC LIMIT 1) accountId, a.group_id groupId, g.name groupName, c.sync_status syncStatus, c.sync_error syncError, c.last_sync_time lastSyncTime, a.create_time createTime, a.update_time updateTime ${joins} ${where} ORDER BY a.outlook_account_id DESC LIMIT ? OFFSET ?`).bind(...bindings, limit, offset).all(),
			c.env.db.prepare(`SELECT COUNT(*) total ${joins} ${where}`).bind(...bindings).first()
		]);
		const accountIds = rows.results.map(row => row.outlookAccountId);
		const tags = accountIds.length ? await c.env.db.prepare(`SELECT at.outlook_account_id outlookAccountId, t.outlook_tag_id outlookTagId, t.name FROM outlook_account_tag at JOIN outlook_tag t ON t.outlook_tag_id = at.outlook_tag_id WHERE at.outlook_account_id IN (${accountIds.map(() => '?').join(',')}) AND t.user_id = ? ORDER BY t.name`).bind(...accountIds, userId).all() : { results: [] };
		const tagsByAccount = new Map();
		for (const tag of tags.results) {
			const itemTags = tagsByAccount.get(tag.outlookAccountId) || [];
			itemTags.push(tag);
			tagsByAccount.set(tag.outlookAccountId, itemTags);
		}
		return { list: rows.results.map(row => { const itemTags = tagsByAccount.get(row.outlookAccountId) || []; return { ...row, tagIds: itemTags.map(tag => tag.outlookTagId), tagNames: itemTags.map(tag => tag.name) }; }), total: totalRow.total };
	},

	async startOAuth(c, userId) {
		const clientId = configuredOAuthCredential(c.env.outlook_client_id, 'Outlook OAuth client ID is not configured');
		configuredOAuthCredential(c.env.outlook_client_secret, 'Outlook OAuth client secret is not configured');
		const state = randomState();
		const redirectUri = `${new URL(c.req.url).origin}/api/oauth/outlook/callback`;
		await c.env.kv.put(`outlook-oauth:${state}`, JSON.stringify({ userId, redirectUri }), { expirationTtl: 600 });
		const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
		url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', response_mode: 'query', redirect_uri: redirectUri, scope: 'offline_access User.Read Mail.Read', state }).toString();
		return { authorizationUrl: url.toString() };
	},

	async finishOAuth(c, code, state) {
		if (!code || !state) throw new BizError('Invalid Outlook authorization callback', 400);
		const saved = await c.env.kv.get(`outlook-oauth:${state}`, { type: 'json' });
		await c.env.kv.delete(`outlook-oauth:${state}`);
		if (!saved) throw new BizError('Outlook authorization state expired', 400);
		const clientId = configuredOAuthCredential(c.env.outlook_client_id, 'Outlook OAuth client ID is not configured');
		const clientSecret = configuredOAuthCredential(c.env.outlook_client_secret, 'Outlook OAuth client secret is not configured');
		const token = await tokenRequest({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: saved.redirectUri }, 'Graph');
		if (!token.refresh_token) throw new BizError('Microsoft authorization returned no refresh token', 400);
		const profile = await graphProfile(token.access_token);
		return this.saveImportedAccount(c, saved.userId, { email: profile.email, profile, clientId, clientSecret, refreshToken: token.refresh_token });
	},

	async saveImportedAccount(c, userId, values) {
		await this.ensureLocalInboxAccount(c, userId, values.email);
		const existingConnection = await c.env.db.prepare(`SELECT outlook_connection_id FROM outlook_connection WHERE user_id = ? AND provider_email = ? AND client_id = ?`).bind(userId, values.profile.email, values.clientId).first();
		const refreshTokenCiphertext = await outlookCryptoService.encrypt(c, values.refreshToken);
		const clientSecretCiphertext = values.clientSecret ? await outlookCryptoService.encrypt(c, values.clientSecret) : '';
		let connectionId = existingConnection?.outlook_connection_id;
		if (connectionId) {
			await c.env.db.batch([
				c.env.db.prepare(`UPDATE outlook_connection SET provider_user_principal_name = ?, client_secret_ciphertext = ?, refresh_token_ciphertext = ?, sync_status = 'ready', sync_error = '', is_del = 0, update_time = CURRENT_TIMESTAMP WHERE outlook_connection_id = ?`).bind(values.profile.userPrincipalName, clientSecretCiphertext, refreshTokenCiphertext, connectionId),
				c.env.db.prepare(`DELETE FROM outlook_folder_state WHERE outlook_connection_id = ?`).bind(connectionId)
			]);
		} else {
			const result = await c.env.db.prepare(`INSERT INTO outlook_connection(user_id, provider_email, provider_user_principal_name, client_id, client_secret_ciphertext, refresh_token_ciphertext) VALUES (?, ?, ?, ?, ?, ?)`).bind(userId, values.profile.email, values.profile.userPrincipalName, values.clientId, clientSecretCiphertext, refreshTokenCiphertext).run();
			connectionId = result.meta.last_row_id;
		}
		const existingAccount = await c.env.db.prepare(`SELECT outlook_account_id FROM outlook_account WHERE user_id = ? AND email COLLATE NOCASE = ?`).bind(userId, values.email).first();
		if (existingAccount) { await c.env.db.prepare(`UPDATE outlook_account SET outlook_connection_id = ?, is_del = 0, update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(connectionId, existingAccount.outlook_account_id).run(); return { outlookAccountId: existingAccount.outlook_account_id, email: values.email }; }
		const result = await c.env.db.prepare(`INSERT INTO outlook_account(user_id, email, client_id, client_secret_ciphertext, refresh_token_ciphertext, outlook_connection_id) VALUES (?, ?, ?, ?, ?, ?)`).bind(userId, values.email, values.clientId, clientSecretCiphertext, refreshTokenCiphertext, connectionId).run();
		return { outlookAccountId: result.meta.last_row_id, email: values.email };
	},

	async importRows(c, userId, rows) {
		if (typeof rows !== 'string' || new TextEncoder().encode(rows).byteLength > MAX_IMPORT_BYTES) throw new BizError('Outlook import is too large', 400);
		const lines = rows.split(/\r?\n/).filter(line => line.trim());
		if (lines.length > MAX_IMPORT_LINES) throw new BizError('Outlook import has too many lines', 400);
		const imported = [], failed = [];
		for (const [index, input] of lines.entries()) {
			try {
				const fields = input.split('----').map(field => field.trim());
				if (fields.length !== 4 || fields.some(field => !field)) throw new BizError('Expected email----password----client_id----refresh_token', 400);
				const [submittedEmail, ignoredPassword, clientId, refreshToken] = fields;
				void ignoredPassword;
				const email = normalizedEmail(submittedEmail);
				const token = await tokenRequest({ grant_type: 'refresh_token', client_id: normalizedText(clientId, 'Outlook client ID'), ...(configuredClientSecret(c, clientId) ? { client_secret: configuredClientSecret(c, clientId) } : {}), refresh_token: normalizedText(refreshToken, 'Outlook refresh token'), scope: 'https://graph.microsoft.com/.default' }, 'Graph');
				const account = await this.saveImportedAccount(c, userId, { email, profile: { email, userPrincipalName: '' }, clientId, clientSecret: configuredClientSecret(c, clientId), refreshToken: token.refresh_token || refreshToken });
				imported.push({ line: index + 1, ...account });
			} catch (error) { failed.push({ line: index + 1, reason: error.message || 'Import failed' }); }
		}
		return { imported, failed };
	},

	async setOrganization(c, userId, params) {
		const accountId = Number(params.outlookAccountId);
		if (!Number.isInteger(accountId) || accountId < 1) throw new BizError('Outlook account is invalid', 400);
		const account = await c.env.db.prepare(`SELECT outlook_account_id FROM outlook_account WHERE outlook_account_id = ? AND user_id = ? AND is_del = 0`).bind(accountId, userId).first();
		if (!account) throw new BizError('Outlook account not found', 404);
		const groupId = params.groupId === null ? null : Number(params.groupId);
		if (groupId !== null && (!Number.isInteger(groupId) || !(await c.env.db.prepare(`SELECT 1 FROM outlook_group WHERE outlook_group_id = ? AND user_id = ?`).bind(groupId, userId).first()))) throw new BizError('Outlook group not found', 404);
		if (!Array.isArray(params.tagIds)) throw new BizError('Outlook tags are invalid', 400);
		const tagIds = [...new Set(params.tagIds.map(Number))];
		if (tagIds.length > 20 || tagIds.some(id => !Number.isInteger(id) || id < 1)) throw new BizError('Outlook tags are invalid', 400);
		if (tagIds.length) { const rows = await c.env.db.prepare(`SELECT outlook_tag_id FROM outlook_tag WHERE user_id = ? AND outlook_tag_id IN (${tagIds.map(() => '?').join(',')})`).bind(userId, ...tagIds).all(); if (rows.results.length !== tagIds.length) throw new BizError('Outlook tag not found', 404); }
		await c.env.db.prepare(`UPDATE outlook_account SET group_id = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(groupId, accountId).run();
		await c.env.db.prepare(`DELETE FROM outlook_account_tag WHERE outlook_account_id = ?`).bind(accountId).run();
		if (tagIds.length) await c.env.db.batch(tagIds.map(tagId => c.env.db.prepare(`INSERT INTO outlook_account_tag(outlook_account_id, outlook_tag_id) VALUES (?, ?)`).bind(accountId, tagId)));
		return { outlookAccountId: accountId, groupId, tagIds };
	},

	async batchSetGroup(c, userId, params) {
		const accountIds = accountIdsOf(params?.outlookAccountIds);
		const groupId = params?.groupId === null ? null : positiveInteger(params?.groupId);
		if (groupId === null && params?.groupId !== null) throw new BizError('Outlook account ids are invalid', 400);
		if (groupId !== null && !(await c.env.db.prepare(`SELECT 1 FROM outlook_group WHERE outlook_group_id = ? AND user_id = ?`).bind(groupId, userId).first())) throw new BizError('Outlook group not found', 404);
		const rows = await c.env.db.prepare(`SELECT outlook_account_id FROM outlook_account WHERE user_id = ? AND is_del = 0 AND outlook_account_id IN (${accountIds.map(() => '?').join(',')})`).bind(userId, ...accountIds).all();
		if (rows.results.length !== accountIds.length) throw new BizError('Outlook account not found', 404);
		await c.env.db.prepare(`UPDATE outlook_account SET group_id = ?, update_time = CURRENT_TIMESTAMP WHERE user_id = ? AND outlook_account_id IN (${accountIds.map(() => '?').join(',')})`).bind(groupId, userId, ...accountIds).run();
		return { updated: accountIds.length };
	},

	async batchDelete(c, userId, params) {
		const accountIds = accountIdsOf(params?.outlookAccountIds);
		const rows = await c.env.db.prepare(`SELECT outlook_account_id FROM outlook_account WHERE user_id = ? AND is_del = 0 AND outlook_account_id IN (${accountIds.map(() => '?').join(',')})`).bind(userId, ...accountIds).all();
		if (rows.results.length !== accountIds.length) throw new BizError('Outlook account not found', 404);
		for (const accountId of accountIds) await this.delete(c, userId, accountId);
		return { deleted: accountIds.length };
	},

	async delete(c, userId, accountId) {
		accountId = Number(accountId);
		const account = await c.env.db.prepare(`SELECT outlook_account_id, outlook_connection_id FROM outlook_account WHERE outlook_account_id = ? AND user_id = ? AND is_del = 0`).bind(accountId, userId).first();
		if (!account) throw new BizError('Outlook account not found', 404);
		await c.env.db.batch([c.env.db.prepare(`UPDATE outlook_account SET is_del = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(isDel.DELETE, accountId), c.env.db.prepare(`DELETE FROM outlook_account_tag WHERE outlook_account_id = ?`).bind(accountId), c.env.db.prepare(`DELETE FROM outlook_message WHERE outlook_account_id = ?`).bind(accountId)]);
		const remaining = await c.env.db.prepare(`SELECT 1 FROM outlook_account WHERE outlook_connection_id = ? AND is_del = 0`).bind(account.outlook_connection_id).first();
		if (!remaining) await c.env.db.prepare(`UPDATE outlook_connection SET is_del = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_connection_id = ?`).bind(isDel.DELETE, account.outlook_connection_id).run();
		return { deleted: 1 };
	}
};

export default outlookAccountService;
