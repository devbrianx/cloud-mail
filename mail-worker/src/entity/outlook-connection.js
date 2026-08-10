import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const outlookConnection = sqliteTable('outlook_connection', {
	outlookConnectionId: integer('outlook_connection_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	providerEmail: text('provider_email').notNull(),
	providerUserPrincipalName: text('provider_user_principal_name').notNull().default(''),
	clientId: text('client_id').notNull(),
	clientSecretCiphertext: text('client_secret_ciphertext').notNull().default(''),
	refreshTokenCiphertext: text('refresh_token_ciphertext').notNull(),
	syncStatus: text('sync_status').notNull().default('ready'),
	syncError: text('sync_error').notNull().default(''),
	lastSyncTime: text('last_sync_time'),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	isDel: integer('is_del').notNull().default(0)
});

export default outlookConnection;
