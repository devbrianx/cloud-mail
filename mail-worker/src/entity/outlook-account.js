import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const outlookAccount = sqliteTable('outlook_account', {
	outlookAccountId: integer('outlook_account_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	email: text('email').notNull(),
	outlookConnectionId: integer('outlook_connection_id'),
	groupId: integer('group_id'),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	isDel: integer('is_del').notNull().default(0)
});

export default outlookAccount;
