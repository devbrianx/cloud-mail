import { and, count, desc, eq, gt, like, lt, sql } from 'drizzle-orm';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import tempInbox from '../entity/temp-inbox';
import tempMessage from '../entity/temp-message';
import tempAttachment from '../entity/temp-attachment';
import r2Service from './r2-service';
import fileUtils from '../utils/file-utils';
import constant from '../const/constant';
import emailUtils from '../utils/email-utils';
import tempInboxService from './temp-inbox-service';

function parseJson(value) { try { return JSON.parse(value || '[]'); } catch { return []; } }
function verificationCode(row) {
	const content = `${row.subject || ''}\n${row.text || ''}\n${emailUtils.htmlToText(row.content || '')}`;
	return /(?<!\d)\d{4,8}(?!\d)/.exec(content)?.[0] || null;
}
function summary(row, attachmentCount) {
	return { id: String(row.tempMessageId), inbox_id: row.tempInboxId, inboxId: row.tempInboxId, from: { name: row.name || '', address: row.sendEmail || '' }, to: parseJson(row.recipient), subject: row.subject || '', seen: row.unread === 1, starred: row.starred === 1, hasAttachments: attachmentCount > 0, size: row.size || 0, createdAt: row.createTime };
}

const tempMessageService = {
	async receiveInbound(c, inbox, parsedEmail, rawSource) {
		const recipient = parsedEmail.to || [{ address: inbox.address, name: inbox.address.split('@')[0] }];
		const row = await orm(c).insert(tempMessage).values({ tempInboxId: inbox.tempInboxId, sendEmail: parsedEmail.from?.address || '', name: parsedEmail.from?.name || '', subject: parsedEmail.subject || '', text: parsedEmail.text || '', content: parsedEmail.html || '', recipient: JSON.stringify(recipient), cc: JSON.stringify(parsedEmail.cc || []), messageId: parsedEmail.messageId || '', unread: 0, rawSource: rawSource || '', size: new TextEncoder().encode(rawSource || '').byteLength, starred: 0 }).returning().get();
		for (const attachment of parsedEmail.attachments || []) {
			const key = constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(attachment.content) + fileUtils.getExtFileName(attachment.filename);
			const disposition = attachment.contentId ? `inline;filename=${attachment.filename}` : `attachment;filename=${attachment.filename}`;
			await r2Service.putObj(c, key, attachment.content, { contentType: attachment.mimeType, contentDisposition: disposition, ...(attachment.contentId ? { cacheControl: 'max-age=259200' } : {}) });
			await orm(c).insert(tempAttachment).values({ tempMessageId: row.tempMessageId, key, filename: attachment.filename || '', mimeType: attachment.mimeType || 'application/octet-stream', size: attachment.content.length ?? attachment.content.byteLength, disposition, contentId: attachment.contentId || null }).run();
		}
		return row;
	},

	async list(c, inbox, params) {
		const limit = params.limit == null ? 50 : Number(params.limit);
		const offset = params.offset == null ? 0 : Number(params.offset);
		if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new BizError('Message limit is invalid', 400);
		const conditions = [eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0)];
		const filtered = ['seen', 'since', 'q', 'after_id'].some(key => params[key] != null);
		if (params.seen != null) { if (!['true', 'false'].includes(params.seen)) throw new BizError('Message seen filter is invalid', 400); conditions.push(eq(tempMessage.unread, params.seen === 'true' ? 1 : 0)); }
		if (params.since != null) { const since = new Date(params.since); if (Number.isNaN(since.getTime())) throw new BizError('Message since filter is invalid', 400); conditions.push(gt(tempMessage.createTime, since.toISOString())); }
		if (params.q) { const q = `%${String(params.q).toLowerCase()}%`; conditions.push(sql`(lower(${tempMessage.subject}) LIKE ${q} OR lower(${tempMessage.name}) LIKE ${q} OR lower(${tempMessage.sendEmail}) LIKE ${q})`); }
		const afterId = params.after_id == null ? null : Number(params.after_id);
		if (afterId != null) { if (!Number.isInteger(afterId) || afterId < 1) throw new BizError('Message cursor is invalid', 400); conditions.push(lt(tempMessage.tempMessageId, afterId)); }
		let query = orm(c).select().from(tempMessage).where(and(...conditions)).orderBy(desc(tempMessage.tempMessageId)).limit(limit + 1);
		if (afterId == null && offset) query = query.offset(offset);
		const rows = await query.all(); const hasMore = rows.length > limit; const messages = rows.slice(0, limit);
		const counts = await Promise.all(messages.map(async row => [row.tempMessageId, (await orm(c).select({ total: count() }).from(tempAttachment).where(eq(tempAttachment.tempMessageId, row.tempMessageId)).get()).total]));
		const { total } = await orm(c).select({ total: count() }).from(tempMessage).where(and(eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0))).get();
		const { unreadCount } = await orm(c).select({ unreadCount: count() }).from(tempMessage).where(and(eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0), eq(tempMessage.unread, 0))).get();
		return { messages: messages.map(row => summary(row, new Map(counts).get(row.tempMessageId))), total, unreadCount, ...(filtered && hasMore ? { nextCursor: String(messages.at(-1).tempMessageId) } : {}) };
	},

	async requireMessage(c, inbox, messageId) {
		const row = await orm(c).select({ message: tempMessage, inbox: tempInbox }).from(tempMessage).innerJoin(tempInbox, eq(tempMessage.tempInboxId, tempInbox.tempInboxId)).where(and(eq(tempMessage.tempMessageId, messageId), eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0))).get();
		if (!row) throw new BizError('Message not found', 404); return row;
	},

	async requireForPrincipal(c, actor, messageId) {
		const row = await orm(c).select({ message: tempMessage, inbox: tempInbox }).from(tempMessage).innerJoin(tempInbox, eq(tempMessage.tempInboxId, tempInbox.tempInboxId)).where(and(eq(tempMessage.tempMessageId, messageId), eq(tempMessage.isDeleted, 0))).get();
		if (!row) throw new BizError('Message not found', 404);
		const inbox = await tempInboxService.requireActiveInbox(c, row.inbox.tempInboxId);
		if ((actor.kind === 'apiKey' && inbox.apiKeyId !== actor.apiKeyId) || (actor.kind === 'tempToken' && inbox.tempInboxId !== actor.inbox.tempInboxId)) throw new BizError('Message not found', 404);
		return { ...row, inbox };
	},

	async detail(c, row, downloadToken = null) {
		const attachments = await orm(c).select().from(tempAttachment).where(eq(tempAttachment.tempMessageId, row.message.tempMessageId)).all();
		const tokenQuery = downloadToken ? `?token=${encodeURIComponent(downloadToken)}` : '';
		return { ...summary(row.message, attachments.length), text: row.message.text || '', html: row.message.content ? [row.message.content] : [], verificationCode: verificationCode(row.message), attachments: attachments.map(attachment => ({ id: String(attachment.tempAttachmentId), filename: attachment.filename || '', contentType: attachment.mimeType || 'application/octet-stream', size: attachment.size || 0, disposition: attachment.disposition || '', contentId: attachment.contentId || null, downloadUrl: `/v1/messages/${row.message.tempMessageId}/attachments/${attachment.tempAttachmentId}${tokenQuery}` })) };
	},

	async update(c, row, body) {
		const update = {}; if (!body || !Object.keys(body).length) update.unread = 1;
		else { if (body.seen != null) { if (typeof body.seen !== 'boolean') throw new BizError('Message update is invalid', 400); update.unread = body.seen ? 1 : 0; } if (body.starred != null) { if (typeof body.starred !== 'boolean') throw new BizError('Message update is invalid', 400); update.starred = body.starred ? 1 : 0; } if (!Object.keys(update).length) throw new BizError('Message update is invalid', 400); }
		await orm(c).update(tempMessage).set(update).where(eq(tempMessage.tempMessageId, row.message.tempMessageId)).run();
		return { id: String(row.message.tempMessageId), seen: update.unread == null ? row.message.unread === 1 : update.unread === 1, starred: update.starred == null ? row.message.starred === 1 : update.starred === 1 };
	},
	async next(c, inbox) { const message = await orm(c).select().from(tempMessage).where(and(eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0), eq(tempMessage.unread, 0))).orderBy(tempMessage.tempMessageId).get(); if (!message) return null; await orm(c).update(tempMessage).set({ unread: 1 }).where(eq(tempMessage.tempMessageId, message.tempMessageId)).run(); return await this.requireMessage(c, inbox, message.tempMessageId); },
	async markRead(c, inbox) { const { total } = await orm(c).select({ total: count() }).from(tempMessage).where(and(eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0))).get(); const { unread } = await orm(c).select({ unread: count() }).from(tempMessage).where(and(eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0), eq(tempMessage.unread, 0))).get(); await orm(c).update(tempMessage).set({ unread: 1 }).where(and(eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0), eq(tempMessage.unread, 0))).run(); return { mailbox: inbox.address, updated: unread, alreadySeen: total - unread, total }; },
	async delete(c, row) { await tempInboxService.deleteMessage(c, row.message.tempMessageId, row.inbox.tempInboxId); },
	async attachment(c, row, attachmentId) { const attachment = await orm(c).select().from(tempAttachment).where(and(eq(tempAttachment.tempAttachmentId, attachmentId), eq(tempAttachment.tempMessageId, row.message.tempMessageId))).get(); if (!attachment) throw new BizError('Attachment not found', 404); return attachment; }
};
export default tempMessageService;
