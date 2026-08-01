import { and, count, eq, isNull } from 'drizzle-orm';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import apiKey from '../entity/api-key';
import settingService from './setting-service';
import { settingConst } from '../const/entity-const';

export const API_SCOPES = ['inboxes:read', 'inboxes:write', 'messages:read', 'messages:write'];

const encoder = new TextEncoder();

async function sha256(value) {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes) {
	return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const apiKeyService = {
	async requireEnabled(c) {
		const setting = await settingService.query(c);
		if (setting.apiEnabled !== settingConst.api.OPEN) {
			throw new BizError('API is disabled', 403);
		}
		return setting;
	},

	async create(c, userId, { name, scopes }) {
		await this.requireEnabled(c);
		const normalizedName = typeof name === 'string' ? name.trim() : '';
		if (!normalizedName || normalizedName.length > 64) {
			throw new BizError('API key name must be between 1 and 64 characters', 400);
		}
		if (!Array.isArray(scopes) || !scopes.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !API_SCOPES.includes(scope))) {
			throw new BizError('API key scopes are invalid', 400);
		}
		const { total } = await orm(c).select({ total: count() }).from(apiKey).where(and(eq(apiKey.userId, userId), isNull(apiKey.revokedAt))).get();
		if (total >= 10) {
			throw new BizError('API key limit reached', 403);
		}
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const secret = `cm_${base64url(bytes)}`;
		const secretHash = await sha256(secret);
		const row = await orm(c).insert(apiKey).values({
			userId,
			name: normalizedName,
			secretHash,
			secretPrefix: secret.slice(0, 8),
			scopes: JSON.stringify(scopes)
		}).returning().get();
		return { apiKeyId: row.apiKeyId, name: row.name, prefix: row.secretPrefix, scopes, secret, createTime: row.createTime };
	},

	async list(c, userId) {
		await this.requireEnabled(c);
		const rows = await orm(c).select().from(apiKey).where(eq(apiKey.userId, userId)).all();
		return rows.map(row => ({
			apiKeyId: row.apiKeyId,
			name: row.name,
			prefix: row.secretPrefix,
			scopes: JSON.parse(row.scopes),
			revokedAt: row.revokedAt,
			createTime: row.createTime
		}));
	},

	async revoke(c, userId, apiKeyId) {
		await this.requireEnabled(c);
		await orm(c).update(apiKey).set({ revokedAt: new Date().toISOString() }).where(and(eq(apiKey.apiKeyId, apiKeyId), eq(apiKey.userId, userId), isNull(apiKey.revokedAt))).run();
	},

	async authenticate(c, secret) {
		if (typeof secret !== 'string' || !secret.startsWith('cm_')) return null;
		const secretHash = await sha256(secret);
		const row = await orm(c).select().from(apiKey).where(and(eq(apiKey.secretHash, secretHash), isNull(apiKey.revokedAt))).get();
		if (!row) return null;
		try {
			return { apiKeyId: row.apiKeyId, userId: row.userId, scopes: JSON.parse(row.scopes) };
		} catch {
			return null;
		}
	}
};

export default apiKeyService;
