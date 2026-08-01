import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const tempInbox = sqliteTable('temp_inbox', {
	tempInboxId: text('temp_inbox_id').primaryKey(),
	apiKeyId: integer('api_key_id').notNull(),
	userId: integer('user_id').notNull(),
	address: text('address').notNull(),
	domain: text('domain').notNull(),
	mode: text('mode').default('fixed').notNull(),
	subdomain: text('subdomain').default('').notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull(),
	expiresAt: text('expires_at').notNull(),
	deletedAt: text('deleted_at')
});

export default tempInbox;
