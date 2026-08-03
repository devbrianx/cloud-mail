import { and, count, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import apiKey from '../entity/api-key';
import tempInbox from '../entity/temp-inbox';
import tempMessage from '../entity/temp-message';
import tempAttachment from '../entity/temp-attachment';
import { att } from '../entity/att';
import r2Service from './r2-service';
import apiUsageService from './api-usage-service';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_PART = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{0,61}$/;
const INBOX_ID = /^[a-f0-9]{32}$/;

function createInboxId() {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function createRandom(length) {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function normalize(value) {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const tempInboxService = {
	createLocalPart: () => createRandom(12),

	async createCompatible(c, principal, input, apiDomains, wildcardDomains, forceWildcard = false) {
		const request = input && typeof input === 'object' ? input : {};
		const legacyAddress = normalize(request.address);
		const [legacyLocalPart, legacyDomain] = legacyAddress.includes('@') ? legacyAddress.split('@') : [legacyAddress, ''];
		const explicitLocalPart = normalize(request.localPart);
		if (explicitLocalPart && legacyLocalPart && explicitLocalPart !== legacyLocalPart) throw new BizError('Address and localPart do not match', 400);
		const localPart = explicitLocalPart || legacyLocalPart || createRandom(12);
		if (!LOCAL_PART.test(localPart)) throw new BizError('API inbox local part is invalid', 400);
		const requestedDomain = normalize(request.domain);
		if (legacyDomain && requestedDomain && legacyDomain !== requestedDomain) throw new BizError('Address domain does not match domain', 400);
		const wildcard = forceWildcard || request.subdomain != null || request.subdomainLabel != null;
		const rootDomain = requestedDomain || legacyDomain || (wildcard ? wildcardDomains[0] : apiDomains[0]) || '';
		if (!rootDomain || !apiDomains.includes(rootDomain)) throw new BizError('API domain is not allowed', 400);
		let mode = 'fixed';
		let subdomain = '';
		let domain = rootDomain;
		if (wildcard) {
			if (!wildcardDomains.includes(rootDomain)) throw new BizError('Wildcard API domain is not allowed', 400);
			subdomain = normalize(request.subdomain ?? request.subdomainLabel) || createRandom(6);
			if (!SUBDOMAIN.test(subdomain)) throw new BizError('API inbox subdomain is invalid', 400);
			domain = `${subdomain}.${rootDomain}`;
			mode = 'wildcard';
		}
		const address = `${localPart}@${domain}`;
		const existing = await orm(c).select({ tempInboxId: tempInbox.tempInboxId }).from(tempInbox).where(sql`${tempInbox.address} COLLATE NOCASE = ${address}`).get();
		if (existing) throw new BizError('API inbox address already exists', 409);
		const now = new Date();
		return await orm(c).insert(tempInbox).values({
			tempInboxId: createInboxId(), apiKeyId: principal.apiKeyId, userId: principal.userId, address, domain, mode, subdomain,
			createTime: now.toISOString(), expiresAt: new Date(now.getTime() + DAY_MS).toISOString()
		}).returning().get();
	},

	toApiInbox(row) {
		return { id: row.tempInboxId, address: row.address, mode: row.mode || 'fixed', domain: row.domain, subdomain: row.subdomain || '', inboxType: 'temp', source: 'api', expiresAt: row.expiresAt, isActive: new Date(row.expiresAt).getTime() > Date.now(), createdAt: row.createTime };
	},

	async requireActiveInbox(c, inboxId) {
		const row = await orm(c).select().from(tempInbox).where(and(eq(tempInbox.tempInboxId, inboxId), isNull(tempInbox.deletedAt))).get();
		if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
			if (row) await this.deleteInbox(c, row);
			throw new BizError('Inbox not found', 404);
		}
		return row;
	},

	async requireActiveOwnedInbox(c, apiKeyId, inboxId) {
		const row = await this.requireActiveInbox(c, inboxId);
		if (row.apiKeyId !== apiKeyId) throw new BizError('Inbox not found', 404);
		return row;
	},

	async detail(c, row) {
		const { total } = await orm(c).select({ total: count() }).from(tempMessage).where(and(eq(tempMessage.tempInboxId, row.tempInboxId), eq(tempMessage.isDeleted, 0))).get();
		return { ...this.toApiInbox(row), messageCount: total };
	},

	async listActiveByUser(c, userId, { limit: requestedLimit, offset: requestedOffset } = {}) {
		const limit = requestedLimit == null ? 50 : Number(requestedLimit);
		const offset = requestedOffset == null ? 0 : Number(requestedOffset);
		if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new BizError('Temporary inbox list is invalid', 400);
		const conditions = and(eq(tempInbox.userId, userId), isNull(tempInbox.deletedAt), gt(tempInbox.expiresAt, new Date().toISOString()));
		const [rows, { total }] = await Promise.all([
			orm(c).select().from(tempInbox).where(conditions).orderBy(desc(tempInbox.createTime)).limit(limit).offset(offset).all(),
			orm(c).select({ total: count() }).from(tempInbox).where(conditions).get()
		]);
		const list = await Promise.all(rows.map(async row => ({ ...this.toApiInbox(row), messageCount: (await orm(c).select({ total: count() }).from(tempMessage).where(and(eq(tempMessage.tempInboxId, row.tempInboxId), eq(tempMessage.isDeleted, 0))).get()).total })));
		return { list, total };
	},

	async createForUser(c, userId, apiKeyId, input, setting) {
		const keyId = Number(apiKeyId);
		if (!Number.isInteger(keyId) || keyId < 1) throw new BizError('API key is invalid', 400);
		const key = await orm(c).select().from(apiKey).where(and(eq(apiKey.apiKeyId, keyId), eq(apiKey.userId, userId))).get();
		if (!key) throw new BizError('API key not found', 404);
		let scopes;
		try {
			scopes = JSON.parse(key.scopes);
		} catch {
			throw new BizError('API key scope is invalid', 400);
		}
		if (!Array.isArray(scopes) || !scopes.includes('inboxes:write')) throw new BizError('API key scope is insufficient', 403);
		return await this.createCompatible(c, { apiKeyId: key.apiKeyId, userId }, input, setting.apiDomains, setting.apiWildcardDomains);
	},

	async requireActiveOwnedByUser(c, userId, inboxId) {
		const row = await orm(c).select().from(tempInbox).where(and(eq(tempInbox.tempInboxId, inboxId), eq(tempInbox.userId, userId), isNull(tempInbox.deletedAt), gt(tempInbox.expiresAt, new Date().toISOString()))).get();
		if (!row) throw new BizError('Inbox not found', 404);
		return row;
	},

	async deleteActiveOwnedByUser(c, userId, inboxIds) {
		if (!Array.isArray(inboxIds) || !inboxIds.length || inboxIds.length > 100 || inboxIds.some(id => typeof id !== 'string' || !INBOX_ID.test(id.trim()))) throw new BizError('Temporary inbox ids are invalid', 400);
		const ids = [...new Set(inboxIds.map(id => id.trim()))];
		const rows = await orm(c).select().from(tempInbox).where(and(inArray(tempInbox.tempInboxId, ids), eq(tempInbox.userId, userId), isNull(tempInbox.deletedAt), gt(tempInbox.expiresAt, new Date().toISOString()))).all();
		for (const row of rows) await this.deleteInbox(c, row);
		return { deleted: rows.length };
	},

	async deleteObjectIfUnreferenced(c, key) {
		const tempReference = await orm(c).select({ total: count() }).from(tempAttachment).where(eq(tempAttachment.key, key)).get();
		const persistentReference = await orm(c).select({ total: count() }).from(att).where(eq(att.key, key)).get();
		if (!tempReference.total && !persistentReference.total) await r2Service.delete(c, key);
	},

	async deleteMessage(c, messageId, inboxId) {
		const attachments = await orm(c).select().from(tempAttachment).where(eq(tempAttachment.tempMessageId, messageId)).all();
		await orm(c).delete(tempAttachment).where(eq(tempAttachment.tempMessageId, messageId)).run();
		await orm(c).delete(tempMessage).where(and(eq(tempMessage.tempMessageId, messageId), eq(tempMessage.tempInboxId, inboxId))).run();
		for (const attachment of attachments) await this.deleteObjectIfUnreferenced(c, attachment.key);
	},

	async deleteInbox(c, row) {
		const messages = await orm(c).select({ tempMessageId: tempMessage.tempMessageId }).from(tempMessage).where(eq(tempMessage.tempInboxId, row.tempInboxId)).all();
		for (const message of messages) await this.deleteMessage(c, message.tempMessageId, row.tempInboxId);
		await c.env.db.prepare(`DELETE FROM temp_token WHERE temp_inbox_id = ?`).bind(row.tempInboxId).run();
		await orm(c).delete(tempInbox).where(eq(tempInbox.tempInboxId, row.tempInboxId)).run();
	},

	async cleanupExpired(c) {
		const now = new Date().toISOString();
		const rows = await orm(c).select().from(tempInbox).where(lte(tempInbox.expiresAt, now)).all();
		for (const row of rows) await this.deleteInbox(c, row);
		await c.env.db.prepare(`DELETE FROM temp_token WHERE expires_at <= ?`).bind(now).run();
		await apiUsageService.cleanup(c);
	}
};

export default tempInboxService;
