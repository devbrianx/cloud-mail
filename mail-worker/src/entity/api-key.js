import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const apiKey = sqliteTable('api_key', {
	apiKeyId: integer('api_key_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	name: text('name').notNull(),
	secretHash: text('secret_hash').notNull(),
	secretPrefix: text('secret_prefix').notNull(),
	scopes: text('scopes').notNull(),
	revokedAt: text('revoked_at'),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});

export default apiKey;
