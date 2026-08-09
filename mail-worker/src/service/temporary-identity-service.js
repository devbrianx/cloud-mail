import { count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import temporaryIdentity from '../entity/temporary-identity';

const ADDRESS_KEYS = ['Address', 'Address_Alias', 'Trans_Address', 'Trans_Cn_Address'];

function asText(value) {
	return typeof value === 'string' ? value : '';
}

function summary(record) {
	return {
		fullName: asText(record.Full_Name),
		temporaryMail: asText(record.Temporary_mail),
		username: asText(record.Username),
		gender: asText(record.Gender),
		city: asText(record.City),
		address: ADDRESS_KEYS.map(key => asText(record[key]).trim()).find(Boolean) || ''
	};
}

function normalizeRecord(input, requiredRowkey) {
	if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.values(input).some(value => typeof value !== 'string')) throw new BizError('Temporary identity must be an object with string values', 400);
	const rowkey = requiredRowkey || asText(input.rowkey) || uuidv4();
	const record = { ...input, rowkey };
	const data = JSON.stringify(record);
	if (new TextEncoder().encode(data).byteLength > 50 * 1024) throw new BizError('Temporary identity is too large', 400);
	return { rowkey, data, ...summary(record) };
}

function parseRecord(row) {
	try {
		const record = JSON.parse(row.data);
		if (!record || Object.getPrototypeOf(record) !== Object.prototype) throw new Error('invalid record');
		return record;
	} catch {
		throw new BizError('Temporary identity data is invalid', 400);
	}
}

const temporaryIdentityService = {
	async list(c, params = {}) {
		const limit = params.limit == null ? 50 : Number(params.limit);
		const offset = params.offset == null ? 0 : Number(params.offset);
		const q = params.q == null ? '' : params.q;
		if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000 || typeof q !== 'string') throw new BizError('Temporary identity list is invalid', 400);
		const query = q.trim();
		const condition = query ? or(...[temporaryIdentity.fullName, temporaryIdentity.temporaryMail, temporaryIdentity.username, temporaryIdentity.gender, temporaryIdentity.city, temporaryIdentity.address].map(field => sql`${field} COLLATE NOCASE LIKE ${`%${query}%`}`)) : undefined;
		const rowsQuery = orm(c).select({ rowkey: temporaryIdentity.rowkey, fullName: temporaryIdentity.fullName, temporaryMail: temporaryIdentity.temporaryMail, username: temporaryIdentity.username, gender: temporaryIdentity.gender, city: temporaryIdentity.city, address: temporaryIdentity.address, createTime: temporaryIdentity.createTime, updateTime: temporaryIdentity.updateTime }).from(temporaryIdentity);
		const totalQuery = orm(c).select({ total: count() }).from(temporaryIdentity);
		if (condition) { rowsQuery.where(condition); totalQuery.where(condition); }
		const [list, { total }] = await Promise.all([rowsQuery.orderBy(desc(temporaryIdentity.updateTime)).limit(limit).offset(offset).all(), totalQuery.get()]);
		return { list, total };
	},

	async detail(c, rowkey) {
		const row = await orm(c).select().from(temporaryIdentity).where(eq(temporaryIdentity.rowkey, rowkey)).get();
		if (!row) throw new BizError('Temporary identity not found', 404);
		return parseRecord(row);
	},

	async add(c, input) {
		const row = normalizeRecord(input);
		const existing = await orm(c).select({ rowkey: temporaryIdentity.rowkey }).from(temporaryIdentity).where(eq(temporaryIdentity.rowkey, row.rowkey)).get();
		if (existing) throw new BizError('Temporary identity already exists', 409);
		await orm(c).insert(temporaryIdentity).values(row).run();
		return { rowkey: row.rowkey };
	},

	async import(c, records) {
		if (!Array.isArray(records) || records.length < 1 || records.length > 100) throw new BizError('Temporary identity import is invalid', 400);
		const rows = records.map(record => normalizeRecord(record));
		const rowkeys = rows.map(row => row.rowkey);
		if (new Set(rowkeys).size !== rowkeys.length) throw new BizError('Temporary identity already exists', 409);
		const existing = await orm(c).select({ rowkey: temporaryIdentity.rowkey }).from(temporaryIdentity).where(inArray(temporaryIdentity.rowkey, rowkeys)).all();
		if (existing.length) throw new BizError('Temporary identity already exists', 409);
		await c.env.db.batch(rows.map(row => c.env.db.prepare(`INSERT INTO temporary_identity (rowkey, full_name, temporary_mail, username, gender, city, address, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.rowkey, row.fullName, row.temporaryMail, row.username, row.gender, row.city, row.address, row.data)));
		return { imported: rows.length, rowkeys };
	},

	async set(c, rowkey, input) {
		const row = normalizeRecord(input, rowkey);
		const existing = await orm(c).select({ rowkey: temporaryIdentity.rowkey }).from(temporaryIdentity).where(eq(temporaryIdentity.rowkey, rowkey)).get();
		if (!existing) throw new BizError('Temporary identity not found', 404);
		await orm(c).update(temporaryIdentity).set({ ...row, updateTime: new Date().toISOString() }).where(eq(temporaryIdentity.rowkey, rowkey)).run();
		return { rowkey };
	},

	async delete(c, rowkeys) {
		if (!Array.isArray(rowkeys) || rowkeys.length < 1 || rowkeys.length > 100 || rowkeys.some(rowkey => typeof rowkey !== 'string' || !rowkey)) throw new BizError('Temporary identity delete is invalid', 400);
		const ids = [...new Set(rowkeys)];
		if (ids.length !== rowkeys.length) throw new BizError('Temporary identity delete is invalid', 400);
		const result = await orm(c).delete(temporaryIdentity).where(inArray(temporaryIdentity.rowkey, ids)).run();
		return { deleted: result.meta.changes };
	}
};

export default temporaryIdentityService;
