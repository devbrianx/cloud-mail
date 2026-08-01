import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const apiKeyUsage = sqliteTable('api_key_usage', {
	apiKeyId: integer('api_key_id').notNull(),
	usageDate: text('usage_date').notNull(),
	callCount: integer('call_count').default(0).notNull()
});

export default apiKeyUsage;
