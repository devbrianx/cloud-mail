import { count, eq } from 'drizzle-orm';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import apiKey from '../entity/api-key';
import settingService from './setting-service';
import { settingConst } from '../const/entity-const';
import tempInbox from '../entity/temp-inbox';
import tempInboxService from './temp-inbox-service';
import apiUsageService from './api-usage-service';

export const API_SCOPES = ['inboxes:read', 'inboxes:write', 'messages:read', 'messages:write'];

const encoder = new TextEncoder();

async function sha256(value) {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes) {
	return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(value) {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
	return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function encryptionKey(c) {
	const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(c.env.jwt_secret));
	return crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptSecret(c, secret) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(c), encoder.encode(secret));
	return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}

async function decryptSecret(c, value) {
	try {
		const [encodedIv, encodedCiphertext] = typeof value === 'string' ? value.split('.') : [];
		if (!encodedIv || !encodedCiphertext) return null;
		const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64urlDecode(encodedIv) }, await encryptionKey(c), base64urlDecode(encodedCiphertext));
		return new TextDecoder().decode(plaintext);
	} catch {
		return null;
	}
}

function displayPrefix(secret, fallback) {
	return secret ? `${secret.slice(0, 8)}***${secret.slice(-4)}` : fallback;
}

const apiKeyService = {
	async requireEnabled(c) {
		const setting = await settingService.query(c);
		if (setting.apiEnabled !== settingConst.api.OPEN) throw new BizError('API is disabled', 403);
		return setting;
	},

	async create(c, userId, { name, scopes }) {
		await this.requireEnabled(c);
		const normalizedName = typeof name === 'string' ? name.trim() : '';
		if (!normalizedName || normalizedName.length > 64) throw new BizError('API key name must be between 1 and 64 characters', 400);
		if (!Array.isArray(scopes) || !scopes.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !API_SCOPES.includes(scope))) throw new BizError('API key scopes are invalid', 400);
		const { total } = await orm(c).select({ total: count() }).from(apiKey).where(eq(apiKey.userId, userId)).get();
		if (total >= 10) throw new BizError('API key limit reached', 403);
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const secret = `AC-${base64url(bytes)}`;
		const row = await orm(c).insert(apiKey).values({ userId, name: normalizedName, secretHash: await sha256(secret), secretPrefix: secret.slice(0, 8), secretCiphertext: await encryptSecret(c, secret), scopes: JSON.stringify(scopes) }).returning().get();
		return { apiKeyId: row.apiKeyId, name: row.name, prefix: displayPrefix(secret, row.secretPrefix), scopes, secret, createTime: row.createTime };
	},

	async list(c, userId) {
		await this.requireEnabled(c);
		const rows = await orm(c).select().from(apiKey).where(eq(apiKey.userId, userId)).all();
		const usage = await apiUsageService.usageByKey(c, rows.map(row => row.apiKeyId));
		return await Promise.all(rows.map(async row => {
			const secret = await decryptSecret(c, row.secretCiphertext);
			return {
				apiKeyId: row.apiKeyId,
				name: row.name,
				prefix: displayPrefix(secret, row.secretPrefix),
				secret,
				scopes: JSON.parse(row.scopes),
				createTime: row.createTime,
				...(usage.get(row.apiKeyId) || { todayCalls: 0, last30DaysCalls: 0 })
			};
		}));
	},

	async delete(c, userId, apiKeyId) {
		await this.requireEnabled(c);
		const key = await orm(c).select().from(apiKey).where(eq(apiKey.apiKeyId, apiKeyId)).get();
		if (!key || key.userId !== userId) return;
		const inboxes = await orm(c).select().from(tempInbox).where(eq(tempInbox.apiKeyId, apiKeyId)).all();
		for (const inbox of inboxes) await tempInboxService.deleteInbox(c, inbox);
		await c.env.db.batch([
			c.env.db.prepare(`DELETE FROM api_key_usage WHERE api_key_id = ?`).bind(apiKeyId),
			c.env.db.prepare(`DELETE FROM api_key WHERE api_key_id = ?`).bind(apiKeyId)
		]);
	},

	async authenticate(c, secret) {
		if (typeof secret !== 'string' || !secret.startsWith('AC-')) return null;
		const row = await orm(c).select().from(apiKey).where(eq(apiKey.secretHash, await sha256(secret))).get();
		if (!row) return null;
		try {
			return { kind: 'apiKey', apiKeyId: row.apiKeyId, userId: row.userId, scopes: JSON.parse(row.scopes) };
		} catch {
			return null;
		}
	}
};

export default apiKeyService;
