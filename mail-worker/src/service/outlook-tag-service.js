import { eq } from 'drizzle-orm';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import outlookTag from '../entity/outlook-tag';

function nameOf(value) {
	if (typeof value !== 'string') throw new BizError('Outlook tag name is invalid', 400);
	const name = value.trim();
	if (!name || Array.from(name).length > 32) throw new BizError('Outlook tag name is invalid', 400);
	return name;
}

const outlookTagService = {
	async list(c, userId) {
		const rows = await c.env.db.prepare(`SELECT t.outlook_tag_id outlookTagId, t.name, t.create_time createTime, COUNT(a.outlook_account_id) accountCount FROM outlook_tag t LEFT JOIN outlook_account_tag at ON at.outlook_tag_id = t.outlook_tag_id LEFT JOIN outlook_account a ON a.outlook_account_id = at.outlook_account_id AND a.is_del = 0 WHERE t.user_id = ? GROUP BY t.outlook_tag_id ORDER BY t.name`).bind(userId).all();
		return { list: rows.results };
	},
	async add(c, userId, value) {
		const name = nameOf(value);
		try { return await orm(c).insert(outlookTag).values({ userId, name }).returning().get(); }
		catch { throw new BizError('Outlook tag name already exists', 409); }
	},
	async set(c, userId, tagId, value) {
		const name = nameOf(value);
		const found = await orm(c).select().from(outlookTag).where(eq(outlookTag.outlookTagId, Number(tagId))).get();
		if (!found || found.userId !== userId) throw new BizError('Outlook tag not found', 404);
		try {
			await orm(c).update(outlookTag).set({ name }).where(eq(outlookTag.outlookTagId, found.outlookTagId)).run();
			return { outlookTagId: found.outlookTagId, name };
		} catch { throw new BizError('Outlook tag name already exists', 409); }
	},
	async delete(c, userId, tagId) {
		const found = await orm(c).select().from(outlookTag).where(eq(outlookTag.outlookTagId, Number(tagId))).get();
		if (!found || found.userId !== userId) throw new BizError('Outlook tag not found', 404);
		await c.env.db.batch([
			c.env.db.prepare(`DELETE FROM outlook_account_tag WHERE outlook_tag_id = ?`).bind(found.outlookTagId),
			c.env.db.prepare(`DELETE FROM outlook_tag WHERE outlook_tag_id = ? AND user_id = ?`).bind(found.outlookTagId, userId)
		]);
		return { deleted: 1 };
	}
};

export default outlookTagService;
