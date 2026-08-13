import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const outlookMessage = sqliteTable('outlook_message', {
	outlookAccountId: integer('outlook_account_id').notNull(),
	graphMessageId: text('graph_message_id').notNull(),
	emailId: integer('email_id').notNull(),
	folder: text('folder').notNull()
}, table => [primaryKey({ columns: [table.outlookAccountId, table.graphMessageId] })]);

export default outlookMessage;
