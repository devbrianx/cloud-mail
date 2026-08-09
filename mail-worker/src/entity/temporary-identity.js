import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const temporaryIdentity = sqliteTable('temporary_identity', {
	rowkey: text('rowkey').primaryKey(),
	fullName: text('full_name').notNull().default(''),
	temporaryMail: text('temporary_mail').notNull().default(''),
	username: text('username').notNull().default(''),
	gender: text('gender').notNull().default(''),
	city: text('city').notNull().default(''),
	address: text('address').notNull().default(''),
	data: text('data').notNull(),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export default temporaryIdentity;
