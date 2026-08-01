import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const tempToken = sqliteTable('temp_token', {
	tokenHash: text('token_hash').primaryKey(),
	tempInboxId: text('temp_inbox_id').notNull(),
	expiresAt: text('expires_at').notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});

export default tempToken;
