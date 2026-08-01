import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const tempAttachment = sqliteTable('temp_attachment', {
	tempAttachmentId: integer('temp_attachment_id').primaryKey({ autoIncrement: true }),
	tempMessageId: integer('temp_message_id').notNull(),
	key: text('key').notNull(),
	filename: text('filename'),
	mimeType: text('mime_type'),
	size: integer('size'),
	disposition: text('disposition'),
	contentId: text('content_id'),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});

export default tempAttachment;
