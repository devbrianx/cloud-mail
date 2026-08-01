import { and, count, desc, eq, lt } from 'drizzle-orm';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import tempInbox from '../entity/temp-inbox';
import tempMessage from '../entity/temp-message';
import tempAttachment from '../entity/temp-attachment';
import r2Service from './r2-service';
import fileUtils from '../utils/file-utils';
import constant from '../const/constant';
import tempInboxService from './temp-inbox-service';

function parseJson(value) {
	try {
		return JSON.parse(value || '[]');
	} catch {
		return [];
	}
}

function summary(row, attachmentCount) {
	return {
		id: row.tempMessageId,
		from: { name: row.name || '', address: row.sendEmail || '' },
		to: parseJson(row.recipient),
		subject: row.subject || '',
		seen: row.unread === 1,
		hasAttachments: attachmentCount > 0,
		createdAt: row.createTime
	};
}

const tempMessageService = {
	async receiveInbound(c, inbox, parsedEmail) {
		const recipient = parsedEmail.to || [{ address: inbox.address, name: inbox.address.split('@')[0] }];
		const row = await orm(c).insert(tempMessage).values({
			tempInboxId: inbox.tempInboxId,
			sendEmail: parsedEmail.from?.address || '',
			name: parsedEmail.from?.name || '',
			subject: parsedEmail.subject || '',
			text: parsedEmail.text || '',
			content: parsedEmail.html || '',
			recipient: JSON.stringify(recipient),
			cc: JSON.stringify(parsedEmail.cc || []),
			messageId: parsedEmail.messageId || '',
			unread: 0
		}).returning().get();

		for (const attachment of parsedEmail.attachments || []) {
			const key = constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(attachment.content) + fileUtils.getExtFileName(attachment.filename);
			const disposition = attachment.contentId ? `inline;filename=${attachment.filename}` : `attachment;filename=${attachment.filename}`;
			await r2Service.putObj(c, key, attachment.content, {
				contentType: attachment.mimeType,
				contentDisposition: disposition,
				...(attachment.contentId ? { cacheControl: 'max-age=259200' } : {})
			});
			await orm(c).insert(tempAttachment).values({
				tempMessageId: row.tempMessageId,
				key,
				filename: attachment.filename || '',
				mimeType: attachment.mimeType || 'application/octet-stream',
				size: attachment.content.length ?? attachment.content.byteLength,
				disposition,
				contentId: attachment.contentId || null
			}).run();
		}
		return row;
	},

	async list(c, inbox, params) {
		const limit = params.limit == null ? 50 : Number(params.limit);
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BizError('Message limit is invalid', 400);
		let seen;
		if (params.seen != null) {
			if (params.seen !== 'true' && params.seen !== 'false') throw new BizError('Message seen filter is invalid', 400);
			seen = params.seen === 'true' ? 1 : 0;
		}
		const afterId = params.after_id == null ? null : Number(params.after_id);
		if (afterId != null && (!Number.isInteger(afterId) || afterId < 1)) throw new BizError('Message cursor is invalid', 400);
		const conditions = [eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0)];
		if (seen != null) conditions.push(eq(tempMessage.unread, seen));
		if (afterId != null) conditions.push(lt(tempMessage.tempMessageId, afterId));
		const rows = await orm(c).select().from(tempMessage).where(and(...conditions)).orderBy(desc(tempMessage.tempMessageId)).limit(limit + 1).all();
		const hasMore = rows.length > limit;
		const messages = rows.slice(0, limit);
		const attachmentCounts = await Promise.all(messages.map(async row => ({
			id: row.tempMessageId,
			count: (await orm(c).select({ total: count() }).from(tempAttachment).where(eq(tempAttachment.tempMessageId, row.tempMessageId)).get()).total
		})));
		const countById = new Map(attachmentCounts.map(item => [item.id, item.count]));
		const { total } = await orm(c).select({ total: count() }).from(tempMessage).where(and(eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0))).get();
		const { unreadCount } = await orm(c).select({ unreadCount: count() }).from(tempMessage).where(and(eq(tempMessage.tempInboxId, inbox.tempInboxId), eq(tempMessage.isDeleted, 0), eq(tempMessage.unread, 0))).get();
		return {
			messages: messages.map(row => summary(row, countById.get(row.tempMessageId) || 0)),
			total,
			unreadCount,
			nextCursor: hasMore ? String(messages.at(-1).tempMessageId) : ''
		};
	},

	async requireOwnedMessage(c, apiKeyId, messageId) {
		const row = await orm(c).select({ message: tempMessage, inbox: tempInbox }).from(tempMessage).innerJoin(tempInbox, eq(tempMessage.tempInboxId, tempInbox.tempInboxId)).where(and(eq(tempMessage.tempMessageId, messageId), eq(tempInbox.apiKeyId, apiKeyId), eq(tempMessage.isDeleted, 0))).get();
		if (!row) throw new BizError('Message not found', 404);
		if (new Date(row.inbox.expiresAt).getTime() <= Date.now()) {
			await tempInboxService.deleteInbox(c, row.inbox);
			throw new BizError('Message not found', 404);
		}
		return row;
	},

	async detail(c, row) {
		const attachments = await orm(c).select().from(tempAttachment).where(eq(tempAttachment.tempMessageId, row.message.tempMessageId)).all();
		return {
			id: row.message.tempMessageId,
			from: { name: row.message.name || '', address: row.message.sendEmail || '' },
			to: parseJson(row.message.recipient),
			subject: row.message.subject || '',
			text: row.message.text || '',
			html: row.message.content ? [row.message.content] : [],
			seen: row.message.unread === 1,
			hasAttachments: attachments.length > 0,
			createdAt: row.message.createTime,
			attachments: attachments.map(attachment => ({
				id: attachment.tempAttachmentId,
				filename: attachment.filename || '',
				contentType: attachment.mimeType || 'application/octet-stream',
				size: attachment.size || 0,
				downloadUrl: `/v1/messages/${row.message.tempMessageId}/attachments/${attachment.tempAttachmentId}`
			}))
		};
	},

	async setSeen(c, row, seen) {
		if (typeof seen !== 'boolean') throw new BizError('Message update is invalid', 400);
		await orm(c).update(tempMessage).set({ unread: seen ? 1 : 0 }).where(eq(tempMessage.tempMessageId, row.message.tempMessageId)).run();
		return { id: row.message.tempMessageId, seen };
	},

	async delete(c, row) {
		await tempInboxService.deleteMessage(c, row.message.tempMessageId, row.inbox.tempInboxId);
	},

	async attachment(c, row, attachmentId) {
		const attachment = await orm(c).select().from(tempAttachment).where(and(eq(tempAttachment.tempAttachmentId, attachmentId), eq(tempAttachment.tempMessageId, row.message.tempMessageId))).get();
		if (!attachment) throw new BizError('Attachment not found', 404);
		return attachment;
	}
};

export default tempMessageService;
