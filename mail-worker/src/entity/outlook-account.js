import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const outlookAccount = sqliteTable('outlook_account', {
	outlookAccountId: integer('outlook_account_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	email: text('email').notNull(),
	clientId: text('client_id').notNull(),
	clientSecretCiphertext: text('client_secret_ciphertext').notNull(),
	refreshTokenCiphertext: text('refresh_token_ciphertext').notNull(),
	groupId: integer('group_id'),
	deltaLink: text('delta_link').notNull().default(''),
	syncStatus: text('sync_status').notNull().default('ready'),
	syncError: text('sync_error').notNull().default(''),
	lastSyncTime: text('last_sync_time'),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	isDel: integer('is_del').notNull().default(0)
});

export default outlookAccount;
