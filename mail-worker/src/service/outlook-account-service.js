import BizError from '../error/biz-error';
import orm from '../entity/orm';
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

function randomState() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function tokenRequest(params) {
	const response = await fetch(microsoftTokenUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(params)
	});
	if (!response.ok) throw new BizError('Microsoft authorization failed', 400);
	const data = await response.json();
	if (!data.access_token) throw new BizError('Microsoft authorization returned no access token', 400);
	return data;
}

async function graphProfile(accessToken) {
	const response = await fetch(graphMeUrl, { headers: { authorization: `Bearer ${accessToken}` } });
	if (!response.ok) throw new BizError('Microsoft profile validation failed', 400);
	const data = await response.json();
	return normalizedEmail(data.mail || data.userPrincipalName);
}

const outlookAccountService = {
	async ensureLocalInboxAccount(c, userId, email) {
		const existing = await c.env.db.prepare(`SELECT * FROM account WHERE user_id = ? AND email COLLATE NOCASE = ? AND is_del = 0`).bind(userId, email).first();
		if (existing) return existing;
		const foreign = await c.env.db.prepare(`SELECT account_id FROM account WHERE user_id <> ? AND email COLLATE NOCASE = ? AND is_del = 0`).bind(userId, email).first();
		if (foreign) throw new BizError('Outlook email belongs to another user', 409);
		await c.env.db.prepare(`INSERT INTO account(email, name, user_id, status, all_receive, sort, is_del) VALUES (?, ?, ?, 0, 0, 0, 0)`).bind(email, email.split('@')[0], userId).run();
		return c.env.db.prepare(`SELECT * FROM account WHERE user_id = ? AND email COLLATE NOCASE = ? AND is_del = 0`).bind(userId, email).first();
	},

	async list(c, userId, params = {}) {
		const filters = ['a.user_id = ?', 'a.is_del = 0'];
		const bindings = [userId];
		if (params.groupId !== undefined && params.groupId !== '') { filters.push('a.group_id = ?'); bindings.push(Number(params.groupId)); }
		if (params.tagId !== undefined && params.tagId !== '') { filters.push('EXISTS (SELECT 1 FROM outlook_account_tag ft WHERE ft.outlook_account_id = a.outlook_account_id AND ft.outlook_tag_id = ?)'); bindings.push(Number(params.tagId)); }
		const rows = await c.env.db.prepare(`SELECT a.outlook_account_id outlookAccountId, a.email, a.group_id groupId, g.name groupName, a.sync_status syncStatus, a.sync_error syncError, a.last_sync_time lastSyncTime, a.create_time createTime, a.update_time updateTime FROM outlook_account a LEFT JOIN outlook_group g ON g.outlook_group_id = a.group_id AND g.user_id = a.user_id WHERE ${filters.join(' AND ')} ORDER BY a.outlook_account_id DESC`).bind(...bindings).all();
		const accountIds = rows.results.map(row => row.outlookAccountId);
		const tags = accountIds.length ? await c.env.db.prepare(`SELECT at.outlook_account_id outlookAccountId, t.outlook_tag_id outlookTagId, t.name FROM outlook_account_tag at JOIN outlook_tag t ON t.outlook_tag_id = at.outlook_tag_id WHERE at.outlook_account_id IN (${accountIds.map(() => '?').join(',')}) AND t.user_id = ? ORDER BY t.name`).bind(...accountIds, userId).all() : { results: [] };
		return { list: rows.results.map(row => {
			const itemTags = tags.results.filter(tag => tag.outlookAccountId === row.outlookAccountId);
			return { ...row, tagIds: itemTags.map(tag => tag.outlookTagId), tagNames: itemTags.map(tag => tag.name) };
		}) };
	},

	async startOAuth(c, userId, params) {
		const clientId = normalizedText(params.clientId, 'Client ID');
		const clientSecret = normalizedText(params.clientSecret, 'Client secret');
		const state = randomState();
		const redirectUri = `${new URL(c.req.url).origin}/api/oauth/outlook/callback`;
		await c.env.kv.put(`outlook-oauth:${state}`, JSON.stringify({ userId, clientId, clientSecretCiphertext: await outlookCryptoService.encrypt(c, clientSecret), redirectUri }), { expirationTtl: 600 });
		const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
		url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', response_mode: 'query', redirect_uri: redirectUri, scope: 'offline_access User.Read Mail.Read', state }).toString();
		return { authorizationUrl: url.toString() };
	},

	async finishOAuth(c, code, state) {
		if (!code || !state) throw new BizError('Invalid Outlook authorization callback', 400);
		const key = `outlook-oauth:${state}`;
		const saved = await c.env.kv.get(key, { type: 'json' });
		await c.env.kv.delete(key);
		if (!saved) throw new BizError('Outlook authorization state expired', 400);
		const clientSecret = await outlookCryptoService.decrypt(c, saved.clientSecretCiphertext);
		const token = await tokenRequest({ grant_type: 'authorization_code', code, client_id: saved.clientId, client_secret: clientSecret, redirect_uri: saved.redirectUri });
		if (!token.refresh_token) throw new BizError('Microsoft authorization returned no refresh token', 400);
		const email = await graphProfile(token.access_token);
		await this.ensureLocalInboxAccount(c, saved.userId, email);
		return this.saveCredentials(c, saved.userId, { email, clientId: saved.clientId, clientSecret, refreshToken: token.refresh_token });
	},

	async saveCredentials(c, userId, values) {
		const clientSecretCiphertext = await outlookCryptoService.encrypt(c, values.clientSecret);
		const refreshTokenCiphertext = await outlookCryptoService.encrypt(c, values.refreshToken);
		const existing = await c.env.db.prepare(`SELECT outlook_account_id FROM outlook_account WHERE user_id = ? AND email COLLATE NOCASE = ?`).bind(userId, values.email).first();
		if (existing) {
			await c.env.db.prepare(`UPDATE outlook_account SET client_id = ?, client_secret_ciphertext = ?, refresh_token_ciphertext = ?, delta_link = '', sync_status = 'ready', sync_error = '', is_del = 0, update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(values.clientId, clientSecretCiphertext, refreshTokenCiphertext, existing.outlook_account_id).run();
			return { outlookAccountId: existing.outlook_account_id, email: values.email };
		}
		const result = await c.env.db.prepare(`INSERT INTO outlook_account(user_id, email, client_id, client_secret_ciphertext, refresh_token_ciphertext) VALUES (?, ?, ?, ?, ?)`).bind(userId, values.email, values.clientId, clientSecretCiphertext, refreshTokenCiphertext).run();
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
				if (fields.length !== 4 || fields.some(field => !field)) throw new BizError('Expected email----client_secret----refresh_token----client_id', 400);
				const [submittedEmail, clientSecret, refreshToken, clientId] = fields;
				const email = normalizedEmail(submittedEmail);
				const token = await tokenRequest({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
				const profileEmail = await graphProfile(token.access_token);
				if (email !== profileEmail) throw new BizError('Imported email does not match Microsoft account', 400);
				await this.ensureLocalInboxAccount(c, userId, email);
				const account = await this.saveCredentials(c, userId, { email, clientId, clientSecret, refreshToken: token.refresh_token || refreshToken });
				imported.push({ line: index + 1, ...account });
			} catch (error) {
				failed.push({ line: index + 1, input, reason: error.message || 'Import failed' });
			}
		}
		return { imported, failed };
	},

	async setOrganization(c, userId, params) {
		const accountId = Number(params.outlookAccountId);
		if (!Number.isInteger(accountId) || accountId < 1) throw new BizError('Outlook account is invalid', 400);
		const account = await c.env.db.prepare(`SELECT outlook_account_id FROM outlook_account WHERE outlook_account_id = ? AND user_id = ? AND is_del = 0`).bind(accountId, userId).first();
		if (!account) throw new BizError('Outlook account not found', 404);
		const groupId = params.groupId === null ? null : Number(params.groupId);
		if (groupId !== null) {
			if (!Number.isInteger(groupId) || !(await c.env.db.prepare(`SELECT 1 FROM outlook_group WHERE outlook_group_id = ? AND user_id = ?`).bind(groupId, userId).first())) throw new BizError('Outlook group not found', 404);
		}
		if (!Array.isArray(params.tagIds)) throw new BizError('Outlook tags are invalid', 400);
		const tagIds = [...new Set(params.tagIds.map(Number))];
		if (tagIds.length > 20 || tagIds.some(id => !Number.isInteger(id) || id < 1)) throw new BizError('Outlook tags are invalid', 400);
		if (tagIds.length) {
			const rows = await c.env.db.prepare(`SELECT outlook_tag_id FROM outlook_tag WHERE user_id = ? AND outlook_tag_id IN (${tagIds.map(() => '?').join(',')})`).bind(userId, ...tagIds).all();
			if (rows.results.length !== tagIds.length) throw new BizError('Outlook tag not found', 404);
		}
		await c.env.db.prepare(`UPDATE outlook_account SET group_id = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(groupId, accountId).run();
		await c.env.db.prepare(`DELETE FROM outlook_account_tag WHERE outlook_account_id = ?`).bind(accountId).run();
		if (tagIds.length) await c.env.db.batch(tagIds.map(tagId => c.env.db.prepare(`INSERT INTO outlook_account_tag(outlook_account_id, outlook_tag_id) VALUES (?, ?)`).bind(accountId, tagId)));
		return { outlookAccountId: accountId, groupId, tagIds };
	},

	async delete(c, userId, accountId) {
		accountId = Number(accountId);
		const account = await c.env.db.prepare(`SELECT outlook_account_id FROM outlook_account WHERE outlook_account_id = ? AND user_id = ? AND is_del = 0`).bind(accountId, userId).first();
		if (!account) throw new BizError('Outlook account not found', 404);
		await c.env.db.batch([
			c.env.db.prepare(`UPDATE outlook_account SET is_del = ?, update_time = CURRENT_TIMESTAMP WHERE outlook_account_id = ?`).bind(isDel.DELETE, accountId),
			c.env.db.prepare(`DELETE FROM outlook_account_tag WHERE outlook_account_id = ?`).bind(accountId),
			c.env.db.prepare(`DELETE FROM outlook_message WHERE outlook_account_id = ?`).bind(accountId)
		]);
		return { deleted: 1 };
	}
};

export default outlookAccountService;
