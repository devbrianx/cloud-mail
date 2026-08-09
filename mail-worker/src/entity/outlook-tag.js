import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const outlookTag = sqliteTable('outlook_tag', {
	outlookTagId: integer('outlook_tag_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	name: text('name').notNull(),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export default outlookTag;
