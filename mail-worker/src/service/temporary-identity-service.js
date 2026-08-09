import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import temporaryIdentity from '../entity/temporary-identity';
import temporaryIdentityCountry from '../entity/temporary-identity-country';

const ADDRESS_KEYS = ['Address', 'Address_Alias', 'Trans_Address', 'Trans_Cn_Address'];

function asText(value) {
	return typeof value === 'string' ? value : '';
}

function normalizeCountry(value, message = 'Temporary identity country is invalid') {
	if (typeof value !== 'string') throw new BizError(message, 400);
	const country = value.trim();
	if (!country || country.length > 64) throw new BizError(message, 400);
	return country;
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

function normalizeRecord(input, requiredRowkey, country) {
	if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.values(input).some(value => typeof value !== 'string')) throw new BizError('Temporary identity must be an object with string values', 400);
	const rowkey = requiredRowkey || asText(input.rowkey) || uuidv4();
	const record = { ...input, rowkey, Country: country };
	const data = JSON.stringify(record);
	if (new TextEncoder().encode(data).byteLength > 50 * 1024) throw new BizError('Temporary identity is too large', 400);
	return { rowkey, country, data, ...summary(record) };
}

function parseRecord(row) {
	try {
		const record = JSON.parse(row.data);
		if (!record || Object.getPrototypeOf(record) !== Object.prototype) throw new Error('invalid record');
		return { ...record, Country: asText(record.Country) || row.country };
	} catch {
		throw new BizError('Temporary identity data is invalid', 400);
	}
}

async function requireCountry(c, value) {
	const country = normalizeCountry(value);
	const row = await orm(c).select({ country: temporaryIdentityCountry.country }).from(temporaryIdentityCountry).where(eq(temporaryIdentityCountry.country, country)).get();
	if (!row) throw new BizError('Temporary identity country does not exist', 400);
	return country;
}

const temporaryIdentityService = {
	async countries(c) {
		const rows = await orm(c).select({ country: temporaryIdentityCountry.country, count: count(temporaryIdentity.rowkey) }).from(temporaryIdentityCountry).leftJoin(temporaryIdentity, eq(temporaryIdentity.country, temporaryIdentityCountry.country)).groupBy(temporaryIdentityCountry.country).orderBy(asc(sql`lower(${temporaryIdentityCountry.country})`)).all();
		return { list: rows.map(row => ({ country: row.country, count: Number(row.count) })) };
	},

	async addCountry(c, value) {
		const country = normalizeCountry(value, 'Temporary identity country is invalid');
		const existing = await orm(c).select({ country: temporaryIdentityCountry.country }).from(temporaryIdentityCountry).where(eq(temporaryIdentityCountry.country, country)).get();
		if (existing) throw new BizError('Temporary identity country already exists', 409);
		await orm(c).insert(temporaryIdentityCountry).values({ country }).run();
		return { country };
	},

	async renameCountry(c, value, nextValue) {
		const country = normalizeCountry(value, 'Temporary identity country is invalid');
		const nextCountry = normalizeCountry(nextValue, 'Temporary identity country is invalid');
		const existing = await orm(c).select({ country: temporaryIdentityCountry.country }).from(temporaryIdentityCountry).where(eq(temporaryIdentityCountry.country, country)).get();
		if (!existing) throw new BizError('Temporary identity country not found', 404);
		if (country === nextCountry) return { country };
		const duplicate = await orm(c).select({ country: temporaryIdentityCountry.country }).from(temporaryIdentityCountry).where(eq(temporaryIdentityCountry.country, nextCountry)).get();
		if (duplicate) throw new BizError('Temporary identity country already exists', 409);
		const identities = await orm(c).select().from(temporaryIdentity).where(eq(temporaryIdentity.country, country)).all();
		const now = new Date().toISOString();
		await c.env.db.batch([
			c.env.db.prepare(`UPDATE temporary_identity_country SET country = ? WHERE country = ?`).bind(nextCountry, country),
			...identities.map(row => {
				const data = JSON.stringify({ ...parseRecord(row), Country: nextCountry });
				return c.env.db.prepare(`UPDATE temporary_identity SET country = ?, data = ?, update_time = ? WHERE rowkey = ?`).bind(nextCountry, data, now, row.rowkey);
			})
		]);
		return { country: nextCountry };
	},

	async deleteCountry(c, value) {
		const country = normalizeCountry(value, 'Temporary identity country is invalid');
		const existing = await orm(c).select({ country: temporaryIdentityCountry.country }).from(temporaryIdentityCountry).where(eq(temporaryIdentityCountry.country, country)).get();
		if (!existing) throw new BizError('Temporary identity country not found', 404);
		const { total } = await orm(c).select({ total: count() }).from(temporaryIdentity).where(eq(temporaryIdentity.country, country)).get();
		if (total) throw new BizError('Temporary identity country still has identities', 409);
		await orm(c).delete(temporaryIdentityCountry).where(eq(temporaryIdentityCountry.country, country)).run();
		return { deleted: 1 };
	},

	async list(c, params = {}) {
		const country = normalizeCountry(params.country);
		const countryRow = await orm(c).select({ country: temporaryIdentityCountry.country }).from(temporaryIdentityCountry).where(eq(temporaryIdentityCountry.country, country)).get();
		if (!countryRow) return { list: [], total: 0 };
		const limit = params.limit == null ? 50 : Number(params.limit);
		const offset = params.offset == null ? 0 : Number(params.offset);
		const q = params.q == null ? '' : params.q;
		if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000 || typeof q !== 'string') throw new BizError('Temporary identity list is invalid', 400);
		const conditions = [eq(temporaryIdentity.country, country)];
		const query = q.trim();
		if (query) conditions.push(or(...[temporaryIdentity.fullName, temporaryIdentity.temporaryMail, temporaryIdentity.username, temporaryIdentity.gender, temporaryIdentity.city, temporaryIdentity.address].map(field => sql`${field} COLLATE NOCASE LIKE ${`%${query}%`}`)));
		const where = and(...conditions);
		const [list, { total }] = await Promise.all([
			orm(c).select({ rowkey: temporaryIdentity.rowkey, country: temporaryIdentity.country, fullName: temporaryIdentity.fullName, temporaryMail: temporaryIdentity.temporaryMail, username: temporaryIdentity.username, gender: temporaryIdentity.gender, city: temporaryIdentity.city, address: temporaryIdentity.address, createTime: temporaryIdentity.createTime, updateTime: temporaryIdentity.updateTime }).from(temporaryIdentity).where(where).orderBy(desc(temporaryIdentity.updateTime)).limit(limit).offset(offset).all(),
			orm(c).select({ total: count() }).from(temporaryIdentity).where(where).get()
		]);
		return { list, total };
	},

	async detail(c, rowkey) {
		const row = await orm(c).select().from(temporaryIdentity).where(eq(temporaryIdentity.rowkey, rowkey)).get();
		if (!row) throw new BizError('Temporary identity not found', 404);
		return parseRecord(row);
	},

	async add(c, countryValue, input) {
		const country = await requireCountry(c, countryValue);
		const row = normalizeRecord(input, null, country);
		const existing = await orm(c).select({ rowkey: temporaryIdentity.rowkey }).from(temporaryIdentity).where(eq(temporaryIdentity.rowkey, row.rowkey)).get();
		if (existing) throw new BizError('Temporary identity already exists', 409);
		await orm(c).insert(temporaryIdentity).values(row).run();
		return { rowkey: row.rowkey, country };
	},

	async set(c, rowkey, countryValue, input) {
		const country = await requireCountry(c, countryValue);
		const existing = await orm(c).select({ rowkey: temporaryIdentity.rowkey }).from(temporaryIdentity).where(eq(temporaryIdentity.rowkey, rowkey)).get();
		if (!existing) throw new BizError('Temporary identity not found', 404);
		const row = normalizeRecord(input, rowkey, country);
		await orm(c).update(temporaryIdentity).set({ ...row, updateTime: new Date().toISOString() }).where(eq(temporaryIdentity.rowkey, rowkey)).run();
		return { rowkey, country };
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
