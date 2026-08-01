import { and, count, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import tempInbox from '../entity/temp-inbox';
import tempMessage from '../entity/temp-message';
import tempAttachment from '../entity/temp-attachment';
import { att } from '../entity/att';
import r2Service from './r2-service';

const DAY_MS = 24 * 60 * 60 * 1000;

function createInboxId() {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function createLocalPart() {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

const tempInboxService = {
	createLocalPart,

	async create(c, principal, { domain, localPart }, apiDomains, allowedDomains) {
		const normalizedDomain = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
		if (!apiDomains.includes(normalizedDomain) || !allowedDomains.includes(normalizedDomain)) {
			throw new BizError('API domain is not allowed', 400);
		}
		const normalizedLocalPart = localPart == null ? createLocalPart() : String(localPart).trim().toLowerCase();
		if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(normalizedLocalPart)) {
			throw new BizError('API inbox local part is invalid', 400);
		}
		const address = `${normalizedLocalPart}@${normalizedDomain}`;
		const existing = await orm(c).select({ tempInboxId: tempInbox.tempInboxId }).from(tempInbox).where(sql`${tempInbox.address} COLLATE NOCASE = ${address}`).get();
		if (existing) throw new BizError('API inbox address already exists', 409);
		const now = new Date();
		const row = await orm(c).insert(tempInbox).values({
			tempInboxId: createInboxId(),
			apiKeyId: principal.apiKeyId,
			userId: principal.userId,
			address,
			domain: normalizedDomain,
			createTime: now.toISOString(),
			expiresAt: new Date(now.getTime() + DAY_MS).toISOString()
		}).returning().get();
		return this.toApiInbox(row);
	},

	toApiInbox(row) {
		return { id: row.tempInboxId, address: row.address, domain: row.domain, createdAt: row.createTime, expiresAt: row.expiresAt, isActive: true };
	},

	async requireActiveOwnedInbox(c, apiKeyId, inboxId) {
		const row = await orm(c).select().from(tempInbox).where(and(eq(tempInbox.tempInboxId, inboxId), eq(tempInbox.apiKeyId, apiKeyId), isNull(tempInbox.deletedAt))).get();
		if (!row) throw new BizError('Inbox not found', 404);
		if (new Date(row.expiresAt).getTime() <= Date.now()) {
			await this.deleteInbox(c, row);
			throw new BizError('Inbox not found', 404);
		}
		return row;
	},

	async list(c, apiKeyId) {
		const now = new Date().toISOString();
		const rows = await orm(c).select().from(tempInbox).where(and(eq(tempInbox.apiKeyId, apiKeyId), isNull(tempInbox.deletedAt), gt(tempInbox.expiresAt, now))).orderBy(desc(tempInbox.createTime)).all();
		return { inboxes: rows.map(row => this.toApiInbox(row)), total: rows.length };
	},

	async detail(c, row) {
		const { total } = await orm(c).select({ total: count() }).from(tempMessage).where(and(eq(tempMessage.tempInboxId, row.tempInboxId), eq(tempMessage.isDeleted, 0))).get();
		return { ...this.toApiInbox(row), messageCount: total };
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
		await orm(c).delete(tempInbox).where(eq(tempInbox.tempInboxId, row.tempInboxId)).run();
	},

	async cleanupExpired(c) {
		const rows = await orm(c).select().from(tempInbox).where(lte(tempInbox.expiresAt, new Date().toISOString())).all();
		for (const row of rows) await this.deleteInbox(c, row);
	}
};

export default tempInboxService;
