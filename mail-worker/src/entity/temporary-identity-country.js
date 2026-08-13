import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const temporaryIdentityCountry = sqliteTable('temporary_identity_country', {
	userId: integer('user_id').notNull(),
	country: text('country').notNull(),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`)
}, table => [primaryKey({ columns: [table.userId, table.country] })]);

export default temporaryIdentityCountry;
