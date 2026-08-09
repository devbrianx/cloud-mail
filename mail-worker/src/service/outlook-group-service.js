import { eq } from 'drizzle-orm';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import outlookGroup from '../entity/outlook-group';

function nameOf(value, type) {
	if (typeof value !== 'string') throw new BizError(`${type} name is invalid`, 400);
	const name = value.trim();
	if (!name || Array.from(name).length > 32) throw new BizError(`${type} name is invalid`, 400);
	return name;
}

const outlookGroupService = {
	async list(c, userId) {
		const rows = await c.env.db.prepare(`SELECT g.outlook_group_id outlookGroupId, g.name, g.create_time createTime, g.update_time updateTime, COUNT(a.outlook_account_id) accountCount FROM outlook_group g LEFT JOIN outlook_account a ON a.group_id = g.outlook_group_id AND a.is_del = 0 WHERE g.user_id = ? GROUP BY g.outlook_group_id ORDER BY g.name`).bind(userId).all();
		return { list: rows.results };
	},
	async add(c, userId, value) {
		const name = nameOf(value, 'Outlook group');
		try {
			const row = await orm(c).insert(outlookGroup).values({ userId, name }).returning().get();
			return row;
		} catch {
			throw new BizError('Outlook group name already exists', 409);
		}
	},
	async set(c, userId, groupId, value) {
		const name = nameOf(value, 'Outlook group');
		const found = await orm(c).select().from(outlookGroup).where(eq(outlookGroup.outlookGroupId, Number(groupId))).get();
		if (!found || found.userId !== userId) throw new BizError('Outlook group not found', 404);
		try {
			await orm(c).update(outlookGroup).set({ name, updateTime: new Date().toISOString() }).where(eq(outlookGroup.outlookGroupId, found.outlookGroupId)).run();
			return { outlookGroupId: found.outlookGroupId, name };
		} catch { throw new BizError('Outlook group name already exists', 409); }
	},
	async delete(c, userId, groupId) {
		const found = await orm(c).select().from(outlookGroup).where(eq(outlookGroup.outlookGroupId, Number(groupId))).get();
		if (!found || found.userId !== userId) throw new BizError('Outlook group not found', 404);
		await c.env.db.batch([
			c.env.db.prepare(`UPDATE outlook_account SET group_id = NULL, update_time = CURRENT_TIMESTAMP WHERE user_id = ? AND group_id = ?`).bind(userId, found.outlookGroupId),
			c.env.db.prepare(`DELETE FROM outlook_group WHERE outlook_group_id = ? AND user_id = ?`).bind(found.outlookGroupId, userId)
		]);
		return { deleted: 1 };
	}
};

export default outlookGroupService;
