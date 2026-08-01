import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const tempMessage = sqliteTable('temp_message', {
	tempMessageId: integer('temp_message_id').primaryKey({ autoIncrement: true }),
	tempInboxId: text('temp_inbox_id').notNull(),
	sendEmail: text('send_email'),
	name: text('name'),
	subject: text('subject'),
	text: text('text'),
	content: text('content'),
	recipient: text('recipient').default('[]').notNull(),
	cc: text('cc').default('[]').notNull(),
	messageId: text('message_id').default('').notNull(),
	unread: integer('unread').default(0).notNull(),
	rawSource: text('raw_source').default('').notNull(),
	size: integer('size').default(0).notNull(),
	starred: integer('starred').default(0).notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull(),
	isDeleted: integer('is_deleted').default(0).notNull()
});

export default tempMessage;
