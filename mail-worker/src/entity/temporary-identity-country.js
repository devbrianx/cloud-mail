import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const temporaryIdentityCountry = sqliteTable('temporary_identity_country', {
	country: text('country').primaryKey(),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export default temporaryIdentityCountry;
