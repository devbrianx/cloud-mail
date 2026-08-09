import { integer, primaryKey, sqliteTable } from 'drizzle-orm/sqlite-core';

export const outlookAccountTag = sqliteTable('outlook_account_tag', {
	outlookAccountId: integer('outlook_account_id').notNull(),
	outlookTagId: integer('outlook_tag_id').notNull()
}, table => [primaryKey({ columns: [table.outlookAccountId, table.outlookTagId] })]);

export default outlookAccountTag;
