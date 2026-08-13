import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { email } from '../src/email/email';
import apiKeyService from '../src/service/api-key-service';
import KvConst from '../src/const/kv-const';
import permService from '../src/service/perm-service';
import { dbInit } from '../src/init/init';
import jwtUtils from '../src/utils/jwt-utils';

const encoder = new TextEncoder();

async function seedKey(secret = 'AC-test-secret', scopes = ['inboxes:read', 'inboxes:write', 'messages:read', 'messages:write'], userId = 1) { await env.db.prepare('INSERT INTO api_key (user_id, name, secret_hash, secret_prefix, scopes) VALUES (?, ?, ?, ?, ?)').bind(userId, 'test', await hash(secret), secret.slice(0, 8), JSON.stringify(scopes)).run(); return secret; }
async function hash(value) { const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value)); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''); }
async function request(path, options = {}) { const ctx = createExecutionContext(); const response = await worker.fetch(new Request(`http://example.test${path}`, options), env, ctx); await waitOnExecutionContext(ctx); return response; }
function apiOptions(secret, method = 'GET', body) { return { method, headers: { 'X-API-Key': secret, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }; }
async function enable() { await env.kv.put('setting:', JSON.stringify({ ...(await env.kv.get('setting:', { type: 'json' })), apiEnabled: 0 })); }

let authSchemaInitialized = false;

beforeEach(() => {
	authSchemaInitialized = false;
});

async function ensureAuthSchema() {
	if (authSchemaInitialized) return;
	await dbInit.v3_5DB({ env });
	await dbInit.v3_6DB({ env });
	await dbInit.v3_7DB({ env });
	await dbInit.v3_9DB({ env });
	await dbInit.v3_10DB({ env });
	await dbInit.v3_11DB({ env });
	await dbInit.v3_12DB({ env });
	authSchemaInitialized = true;
}

async function authOptions(userId, permKeys = [], method = 'GET', body) {
	await ensureAuthSchema();
	const tokenId = `token-${userId}-${permKeys.join('-') || 'none'}`;
	const token = await jwtUtils.generateToken({ env }, { userId, token: tokenId });
	const user = await env.db.prepare(`SELECT * FROM user WHERE user_id = ?`).bind(userId).first();
	await env.kv.put(`auth-uid:${userId}`, JSON.stringify({ tokens: [tokenId], user: { userId, email: user.email }, refreshTime: new Date().toISOString() }));
	for (const permKey of permKeys) {
		const perm = await env.db.prepare(`SELECT perm_id FROM perm WHERE perm_key = ?`).bind(permKey).first();
		await env.db.prepare(`INSERT INTO role_perm(role_id, perm_id) VALUES (?, ?)`).bind(user.type, perm.perm_id).run();
	}
	return { method, headers: { Authorization: token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) };
}

function microsoftMock() {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
		const url = String(input);
		if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'access-token', refresh_token: 'rotated-refresh' }), { status: 200 });
		if (url.endsWith('/me')) return new Response(JSON.stringify({ mail: 'outlook@example.com' }), { status: 200 });
		if (url.includes('/delta-token') || url.includes('/junk-delta-token')) return new Response(JSON.stringify({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-token' }), { status: 200 });
		if (url.includes('/mailFolders/JunkEmail/messages/delta')) return new Response(JSON.stringify({ value: [{ id: 'junk-1', internetMessageId: '<junk-1>', subject: 'Junk message', from: { emailAddress: { address: 'sender@example.net', name: 'Sender' } }, toRecipients: [{ emailAddress: { address: 'outlook@example.com', name: 'Outlook' } }], ccRecipients: [], receivedDateTime: '2026-01-01T00:00:00Z', body: { contentType: 'html', content: '<p>junk</p>' }, hasAttachments: false, isRead: false }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/junk-delta-token' }), { status: 200 });
		if (url.includes('/messages/delta')) return new Response(JSON.stringify({ value: [{ id: 'graph-newest', internetMessageId: '<graph-newest>', subject: 'Newest message', from: { emailAddress: { address: 'sender@example.net', name: 'Sender' } }, toRecipients: [{ emailAddress: { address: 'outlook@example.com', name: 'Outlook' } }], ccRecipients: [], receivedDateTime: '2026-01-02T00:00:00Z', body: { contentType: 'html', content: '<p>newest</p>' }, hasAttachments: true, isRead: false }, { id: 'graph-older', internetMessageId: '<graph-older>', subject: 'Older message', from: { emailAddress: { address: 'sender@example.net', name: 'Sender' } }, toRecipients: [{ emailAddress: { address: 'outlook@example.com', name: 'Outlook' } }], ccRecipients: [], receivedDateTime: '2026-01-01T00:00:00Z', body: { contentType: 'html', content: '<p>older</p>' }, hasAttachments: false, isRead: false }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-token' }), { status: 200 });
		if (url.includes('/attachments/') && url.endsWith('/$value')) return new Response(encoder.encode('proof'), { status: 200 });
		if (url.includes('/attachments')) return new Response(JSON.stringify({ value: [{ id: 'attachment-1', '@odata.type': '#microsoft.graph.fileAttachment', name: 'proof.txt', contentType: 'text/plain', size: 5, isInline: false }] }), { status: 200 });
		throw new Error(`Unexpected fetch ${url} ${init.method || 'GET'}`);
	});
}

describe('temporary inbox API compatibility', () => {
	it('publishes public documentation while disabled', async () => {
		for (const path of ['/v1/openapi.json', '/v1/openapi.yaml', '/v1/llms.txt', '/v1/error-codes']) expect((await request(path)).status).toBe(200);
		await env.kv.put('setting:', JSON.stringify({ ...(await env.kv.get('setting:', { type: 'json' })), apiEnabled: 1 }));
		const response = await request('/v1/accounts', apiOptions('AC-invalid', 'POST', {}));
		expect(response.status).toBe(403); expect((await response.json()).errorCode).toBe('api_disabled');
	});

	it('cleans legacy temporary data during cutover', async () => {
		await env.db.prepare(`CREATE TABLE temp_api_migration (version TEXT PRIMARY KEY)`).run();
		await env.db.prepare(`INSERT INTO api_key(user_id,name,secret_hash,secret_prefix,scopes) VALUES (1,'old','hash','cm_old','[]')`).run();
		await env.db.prepare(`INSERT INTO temp_inbox(temp_inbox_id,api_key_id,user_id,address,domain,expires_at) VALUES ('old',1,1,'old@example.com','example.com','2099-01-01T00:00:00.000Z')`).run();
		await env.db.prepare(`INSERT INTO temp_message(temp_inbox_id,recipient) VALUES ('old','[]')`).run();
		await dbInit.v3_2DB({ env });
		for (const table of ['api_key', 'temp_inbox', 'temp_message']) expect((await env.db.prepare(`SELECT count(*) total FROM ${table}`).first()).total).toBe(0);
	});

	it('creates AC-key owned fixed and wildcard accounts with temporary tokens', async () => {
		await enable(); const key = await seedKey();
		expect((await request('/v1/accounts', apiOptions('cm_old', 'POST', {}))).status).toBe(401);
		const created = await request('/v1/accounts', apiOptions(key, 'POST', { domain: 'example.com', localPart: 'demo' }));
		if (created.status !== 201) throw new Error(await created.text());
		const account = (await created.json()).data;
		expect(account).toMatchObject({ address: 'demo@example.com', mode: 'fixed', inboxType: 'temp', source: 'api' }); expect(account.token).toEqual(expect.any(String));
		const me = await request('/v1/accounts/me', { headers: { Authorization: `Bearer ${account.token}` } }); expect(me.status).toBe(200);
		const refreshed = await request('/v1/token', { method: 'POST', headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ address: account.address }) }); expect(refreshed.status).toBe(200);
		const wildcard = await request('/v1/accounts/wildcard', apiOptions(key, 'POST', { domain: 'example.com', localPart: 'wild', subdomain: 'child' })); expect((await wildcard.json()).data.address).toBe('wild@child.example.com');
		const denied = await request('/v1/accounts/wildcard', apiOptions(key, 'POST', { domain: 'alt.example.com' })); expect(denied.status).toBe(400);
		const alias = await request('/v1/inboxes', apiOptions(key, 'POST', { domain: 'example.com', localPart: 'alias' })); expect([null, 'true']).toContain(alias.headers.get('Deprecation'));
	});

	it('stores raw inbound messages and supports the reference message surface', async () => {
		await enable(); const key = await seedKey(); const account = (await (await request('/v1/accounts', apiOptions(key, 'POST', { domain: 'example.com', localPart: 'receive' }))).json()).data;
		const raw = 'From: Sender <sender@example.net>\r\nTo: receive@example.com\r\nSubject: Verification 123456\r\nMessage-ID: <test@example.net>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="mail"\r\n\r\n--mail\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour code is 123456.\r\n--mail\r\nContent-Type: text/plain; name="proof.txt"\r\nContent-Disposition: attachment; filename="proof.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--mail--';
		await email({ to: account.address, raw: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); } }), setReject() {}, forward() {} }, env, {});
		const list = await request(`/v1/messages?address=${encodeURIComponent(account.address)}&q=sender`, apiOptions(key)); expect(list.status).toBe(200); const message = (await list.json()).data.messages[0]; expect(message).toMatchObject({ inbox_id: account.id, size: raw.length });
		const detail = await request(`/v1/messages/${message.id}?address=${encodeURIComponent(account.address)}`, apiOptions(key)); const detailData = (await detail.json()).data; expect(detailData.verificationCode).toBe('123456');
		const source = await request(`/v1/sources/${message.id}?address=${encodeURIComponent(account.address)}`, apiOptions(key)); expect((await source.json()).data.data).toBe(raw);
		const tokenDetail = await request(`/v1/messages/${message.id}`, { headers: { Authorization: `Bearer ${account.token}` } }); if (tokenDetail.status !== 200) throw new Error(await tokenDetail.text()); const tokenUrl = (await tokenDetail.json()).data.attachments[0].downloadUrl; expect(tokenUrl).toContain(`token=${account.token}`);
		const attachment = await request(tokenUrl, { headers: {} }); expect(attachment.status).toBe(200); expect(await attachment.text()).toBe('hello');
		const patch = await request(`/v1/messages/${message.id}?address=${encodeURIComponent(account.address)}`, apiOptions(key, 'PATCH', { starred: true })); expect((await patch.json()).data.starred).toBe(true);
		const read = await request(`/v1/messages/mark-read?address=${encodeURIComponent(account.address)}`, apiOptions(key, 'POST')); expect((await read.json()).data.total).toBe(1);
		const apiAttachment = await request(detailData.attachments[0].downloadUrl + `?address=${encodeURIComponent(account.address)}`, apiOptions(key)); expect(apiAttachment.status).toBe(200); expect(await apiAttachment.text()).toBe('hello');
		const deleted = await request(`/v1/messages/${message.id}?address=${encodeURIComponent(account.address)}`, apiOptions(key, 'DELETE')); expect(deleted.status).toBe(204);
	});

	it('extracts contextual alphanumeric codes without matching unrelated numbers', async () => {
		await enable(); const key = await seedKey(); const account = (await (await request('/v1/accounts', apiOptions(key, 'POST', { domain: 'example.com', localPart: 'codes' }))).json()).data;
		const messages = [['SpaceXAI confirmation code: TXZ-J4E', '<p>Use confirmation code: <strong>TXZ-J4E</strong>. Sent in 2026.</p>', 'TXZ-J4E'], ['Monthly newsletter', '<p>The 2026 report contains 333333 subscribers.</p>', null]];
		for (const [subject, content] of messages) { const raw = `From: Sender <sender@example.net>\r\nTo: ${account.address}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${content}`; await email({ to: account.address, raw: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); } }), setReject() {}, forward() {} }, env, {}); }
		const list = (await (await request(`/v1/messages?address=${encodeURIComponent(account.address)}`, apiOptions(key))).json()).data.messages;
		for (const [subject, , expectedCode] of messages) { const message = list.find(item => item.subject === subject); const detail = (await (await request(`/v1/messages/${message.id}?address=${encodeURIComponent(account.address)}`, apiOptions(key))).json()).data; expect(detail.verificationCode).toBe(expectedCode); }
	});

	it('records only successful API-key business calls', async () => { await enable(); const key = await seedKey(); await request('/v1/openapi.json'); await request('/v1/accounts', apiOptions('AC_nope', 'POST', {})); await request('/v1/accounts', apiOptions(key, 'POST', { domain: 'example.com', localPart: 'usage' })); const apiKeyId = (await env.db.prepare(`SELECT api_key_id FROM api_key`).first()).api_key_id; const context = { env, get() { return undefined; }, set() {} }; const keys = await apiKeyService.list(context, 1); expect(keys.find(item => item.apiKeyId === apiKeyId)).toMatchObject({ todayCalls: 1, last30DaysCalls: 1 }); });
	it('seeds the API key permission tree idempotently', async () => { await dbInit.v3_1DB({ env }); await dbInit.v3_1DB({ env }); const tree = await permService.tree({ env }); expect(tree.find(item => item.name === '临时邮箱 API').children.map(item => item.permKey)).toEqual(['api-key:query']); });
	it('encrypts new API keys while leaving legacy secrets unavailable', async () => { const context = { env, get() { return undefined; }, set() {} }; const created = await apiKeyService.create(context, 1, { name: 'encrypted', scopes: ['inboxes:read'] }); const row = await env.db.prepare(`SELECT secret_ciphertext FROM api_key WHERE api_key_id = ?`).bind(created.apiKeyId).first(); expect(row.secret_ciphertext).not.toContain(created.secret); expect(created.prefix).toBe(`${created.secret.slice(0, 8)}***${created.secret.slice(-4)}`); const stored = (await apiKeyService.list(context, 1)).find(key => key.apiKeyId === created.apiKeyId); expect(stored.secret).toBe(created.secret); expect(stored.prefix).toBe(created.prefix); expect((await apiKeyService.authenticate(context, created.secret)).apiKeyId).toBe(created.apiKeyId); const legacySecret = await seedKey('AC-legacy-secret'); expect((await apiKeyService.list(context, 1)).find(key => key.prefix === legacySecret.slice(0, 8)).secret).toBeNull(); });

	it('migrates legacy temporary identities to the administrator and removes their role permissions', async () => {
		await env.db.prepare(`DROP TABLE temporary_identity_country`).run();
		await env.db.prepare(`DROP TABLE temporary_identity`).run();
		await dbInit.v3_4DB({ env });
		await env.db.prepare(`INSERT INTO temporary_identity(rowkey, data) VALUES ('legacy', '{"Full_Name":"Legacy"}')`).run();
		await dbInit.v3_5DB({ env });
		const parent = (await env.db.prepare(`INSERT INTO perm(name, perm_key, pid, type) VALUES ('临时身份', NULL, 0, 1)`).run()).meta.last_row_id;
		const permission = (await env.db.prepare(`INSERT INTO perm(name, perm_key, pid, type) VALUES ('临时身份查看', 'temporary-identity:query', ?, 2)`).bind(parent).run()).meta.last_row_id;
		await env.db.prepare(`INSERT INTO role_perm(role_id, perm_id) VALUES (1, ?)`).bind(permission).run();
		await dbInit.v3_11DB({ env });
		const migrated = await env.db.prepare(`SELECT rowkey, user_id, country, data FROM temporary_identity WHERE rowkey = 'legacy'`).first();
		expect(migrated).toMatchObject({ rowkey: 'legacy', user_id: 2, country: '未分类', data: '{"Full_Name":"Legacy"}' });
		expect(await env.db.prepare(`SELECT 1 FROM temporary_identity_country WHERE user_id = 2 AND country = '未分类'`).first()).not.toBeNull();
		expect(await env.db.prepare(`SELECT 1 FROM perm WHERE perm_key LIKE 'temporary-identity:%'`).first()).toBeNull();
		expect(await env.db.prepare(`SELECT 1 FROM role_perm WHERE perm_id = ?`).bind(permission).first()).toBeNull();
		await dbInit.v3_11DB({ env });
		expect((await env.db.prepare(`SELECT COUNT(*) total FROM temporary_identity_country WHERE user_id = 2 AND country = '未分类'`).first()).total).toBe(1);
	});

	it('rejects legacy identity migration without an active administrator', async () => {
		await env.db.prepare(`DROP TABLE temporary_identity_country`).run();
		await env.db.prepare(`DROP TABLE temporary_identity`).run();
		await dbInit.v3_4DB({ env });
		await env.db.prepare(`INSERT INTO temporary_identity(rowkey, data) VALUES ('legacy', '{}')`).run();
		await dbInit.v3_5DB({ env });
		await env.db.prepare(`DELETE FROM user WHERE user_id = 2`).run();
		await expect(dbInit.v3_11DB({ env })).rejects.toThrow('Temporary identity migration requires an active administrator user');
		expect(await env.db.prepare(`SELECT 1 FROM pragma_table_info('temporary_identity') WHERE name = 'user_id'`).first()).toBeNull();
	});

	it('keeps temporary identities private while allowing ordinary authenticated users to manage their own data', async () => {
		await env.db.prepare(`INSERT INTO user(user_id, email, type) VALUES (3, 'other@example.com', 1)`).run();
		const record = { Full_Name: 'Alice', Gender: 'Female', Temporary_mail: 'alice@example.com', Username: 'alice', Address: 'Alice Street' };
		expect((await (await request('/api/temporaryIdentity/country/add', await authOptions(1, [], 'POST', { country: '美国' }))).json()).code).toBe(200);
		const created = (await (await request('/api/temporaryIdentity/add', await authOptions(1, [], 'POST', { country: '美国', data: record }))).json()).data;
		for (const userId of [2, 3]) {
			expect((await (await request('/api/temporaryIdentity/countries', await authOptions(userId))).json()).data.list).toEqual([]);
			expect((await (await request('/api/temporaryIdentity/list?country=美国', await authOptions(userId))).json()).data).toEqual({ list: [], total: 0 });
			for (const [path, options] of [
				[`/api/temporaryIdentity/detail/${created.rowkey}`, await authOptions(userId)],
				[`/api/temporaryIdentity/set/${created.rowkey}`, await authOptions(userId, [], 'PUT', { data: { ...record, Full_Name: 'Intruder' } })],
				['/api/temporaryIdentity/delete', await authOptions(userId, [], 'DELETE', { rowkeys: [created.rowkey] })]
			]) expect((await (await request(path, options)).json()).code).toBe(404);
		}
		await request('/api/temporaryIdentity/country/add', await authOptions(3, [], 'POST', { country: '美国' }));
		const own = (await (await request('/api/temporaryIdentity/add', await authOptions(3, [], 'POST', { country: '美国', data: { ...record, Full_Name: 'Bob' } }))).json()).data;
		expect((await (await request('/api/temporaryIdentity/countries', await authOptions(1))).json()).data.list).toEqual([{ country: '美国', count: 1 }]);
		expect((await (await request('/api/temporaryIdentity/countries', await authOptions(3))).json()).data.list).toEqual([{ country: '美国', count: 1 }]);
		const updated = await request(`/api/temporaryIdentity/set/${own.rowkey}`, await authOptions(3, [], 'PUT', { data: { ...record, Full_Name: 'Bob Updated' } }));
		expect((await updated.json()).data).toEqual({ rowkey: own.rowkey, country: '美国' });
		expect((await (await request(`/api/temporaryIdentity/detail/${own.rowkey}`, await authOptions(3))).json()).data.Full_Name).toBe('Bob Updated');
		expect((await (await request('/api/temporaryIdentity/delete', await authOptions(3, [], 'DELETE', { rowkeys: [own.rowkey] }))).json()).data).toEqual({ deleted: 1 });
		expect((await (await request(`/api/temporaryIdentity/detail/${created.rowkey}`, await authOptions(1))).json()).data.Full_Name).toBe('Alice');
	});

	it('manages private Outlook accounts, groups, tags, and Graph inbox synchronization', async () => {
		await ensureAuthSchema();
		const legacyKeys = ['outlook-account:query', 'outlook-account:add', 'outlook-account:set', 'outlook-account:delete', 'outlook-group:query', 'outlook-group:add', 'outlook-group:set', 'outlook-group:delete', 'outlook-tag:query', 'outlook-tag:add', 'outlook-tag:set', 'outlook-tag:delete', 'outlook-sync:run'];
		const outlookPerm = await env.db.prepare(`SELECT * FROM perm WHERE name = 'Outlook 邮箱管理' AND pid = 0`).first();
		expect(outlookPerm).toMatchObject({ perm_key: 'outlook:query', type: 2, sort: 5.4 });
		for (const key of legacyKeys) await env.db.prepare(`INSERT INTO perm(name, perm_key, pid, type) VALUES (?, ?, ?, 2)`).bind(key, key, outlookPerm.perm_id).run();
		const legacyPerms = await env.db.prepare(`SELECT perm_id FROM perm WHERE perm_key IN (${legacyKeys.map(() => '?').join(',')})`).bind(...legacyKeys).all();
		for (const { perm_id } of legacyPerms.results) await env.db.prepare(`INSERT INTO role_perm(role_id, perm_id) VALUES (1, ?)`).bind(perm_id).run();
		await dbInit.v3_12DB({ env });
		await dbInit.v3_12DB({ env });
		const tree = await permService.tree({ env });
		const migratedOutlook = tree.find(item => item.name === 'Outlook 邮箱管理');
		expect(migratedOutlook).toMatchObject({ permKey: 'outlook:query', pid: 0, type: 2 });
		expect(migratedOutlook.children).toEqual([]);
		expect((await env.db.prepare(`SELECT perm_key FROM perm WHERE perm_key IN (${legacyKeys.map(() => '?').join(',')})`).bind(...legacyKeys).all()).results).toEqual([]);
		expect((await env.db.prepare(`SELECT COUNT(*) total FROM role_perm WHERE role_id = 1 AND perm_id = ?`).bind(migratedOutlook.permId).first()).total).toBe(1);
		await env.db.prepare(`INSERT INTO role (role_id, name, key) VALUES (2, 'outlook-user', '')`).run();
		await env.db.prepare(`INSERT INTO user (user_id, email, type) VALUES (3, 'outlook-user@example.com', 2)`).run();
		const mock = microsoftMock();
		try {
			const unauthorizedOAuthStart = await request('/api/outlookAccount/oauth/start', await authOptions(3, [], 'POST')); expect((await unauthorizedOAuthStart.json()).code).toBe(403);
			const imported = await request('/api/outlookAccount/import', await authOptions(1, ['outlook:query'], 'POST', { rows: 'outlook@example.com----password----client-id----refresh-token\nbroken-row' }));
			const importData = (await imported.json()).data; expect(importData.imported).toHaveLength(1); expect(importData.failed).toHaveLength(1);
			for (const email of ['pool-one@example.com', 'pool-two@example.com']) {
				await env.db.prepare(`INSERT INTO outlook_connection(user_id, provider_email, client_id, refresh_token_ciphertext) VALUES (1, ?, 'client-id', 'refresh-token')`).bind(email).run();
				const connection = await env.db.prepare(`SELECT outlook_connection_id FROM outlook_connection WHERE user_id = 1 AND provider_email = ?`).bind(email).first();
				await env.db.prepare(`INSERT INTO outlook_account(user_id, email, client_id, client_secret_ciphertext, refresh_token_ciphertext, outlook_connection_id) VALUES (1, ?, 'client-id', '', 'refresh-token', ?)`).bind(email, connection.outlook_connection_id).run();
			}
			const reimported = await request('/api/outlookAccount/import', await authOptions(1, ['outlook:query'], 'POST', { rows: 'outlook@example.com----password----client-id----replacement-refresh-token' })); expect((await reimported.json()).data).toMatchObject({ imported: [expect.objectContaining({ email: 'outlook@example.com' })], failed: [] }); expect((await env.db.prepare(`SELECT COUNT(*) total FROM outlook_connection WHERE user_id = 1 AND provider_email = 'outlook@example.com' AND client_id = 'client-id'`).first()).total).toBe(1);
			const stored = await env.db.prepare(`SELECT client_secret_ciphertext, refresh_token_ciphertext FROM outlook_connection WHERE user_id = 1`).first(); expect(stored.client_secret_ciphertext).toBe(''); expect(stored.refresh_token_ciphertext).not.toContain('refresh-token');
			const importExchange = mock.mock.calls.find(([url, init]) => String(url).includes('/token') && String(init?.body).includes('grant_type=refresh_token')); expect(String(importExchange?.[1]?.body)).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
			const importedProfileRequests = mock.mock.calls.filter(([url]) => String(url).endsWith('/me')); expect(importedProfileRequests).toHaveLength(0);
			const noQuery = await request('/api/outlookAccount/list', await authOptions(3)); expect((await noQuery.json()).code).toBe(403);
			const firstPageResponse = await request('/api/outlookAccount/list?limit=2&offset=0', await authOptions(1, ['outlook:query'])); const firstPage = (await firstPageResponse.json()).data; const secondPageResponse = await request('/api/outlookAccount/list?limit=2&offset=2', await authOptions(1, ['outlook:query'])); const secondPage = (await secondPageResponse.json()).data; expect(firstPage).toMatchObject({ total: 3 }); expect(firstPage.list).toHaveLength(2); expect(secondPage.list).toHaveLength(1); expect(new Set([...firstPage.list, ...secondPage.list].map(item => item.outlookAccountId)).size).toBe(3); expect(firstPage.list[0].outlookAccountId).toBeGreaterThan(firstPage.list[1].outlookAccountId); const account = secondPage.list.find(item => item.email === 'outlook@example.com'); const localAccount = await env.db.prepare(`SELECT account_id FROM account WHERE user_id = ? AND email = ?`).bind(1, account.email).first(); expect(account).toMatchObject({ accountId: localAccount.account_id }); expect(account).not.toHaveProperty('clientId'); expect(account).not.toHaveProperty('refreshToken'); expect(account).not.toHaveProperty('importMode'); expect(account).not.toHaveProperty('protocol'); expect(account).not.toHaveProperty('providerEmail'); expect((await request('/api/outlookAccount/list?limit=0', await authOptions(1, ['outlook:query']))).status).toBe(200); expect((await (await request('/api/outlookAccount/list?limit=0', await authOptions(1, ['outlook:query']))).json()).code).toBe(400);
			const searchedAccounts = await request('/api/outlookAccount/list?q=POOL-ONE&limit=15&offset=0', await authOptions(1, ['outlook:query'])); expect((await searchedAccounts.json()).data).toMatchObject({ total: 1, list: [expect.objectContaining({ email: 'pool-one@example.com' })] });
			const oauthStart = await request('/api/outlookAccount/oauth/start', await authOptions(1, ['outlook:query'], 'POST')); const oauthStartData = (await oauthStart.json()).data; const authorizationUrl = new URL(oauthStartData.authorizationUrl); const oauthState = authorizationUrl.searchParams.get('state'); expect(authorizationUrl.origin).toBe('https://login.microsoftonline.com'); expect(authorizationUrl.searchParams.get('client_id')).toBe('test-outlook-client-id'); expect(authorizationUrl.searchParams.get('response_type')).toBe('code'); expect(authorizationUrl.searchParams.get('response_mode')).toBe('query'); expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('http://example.test/api/oauth/outlook/callback'); expect(authorizationUrl.searchParams.get('scope')).toBe('offline_access User.Read Mail.Read'); expect(oauthState).toEqual(expect.any(String)); const savedOAuthState = await env.kv.get(`outlook-oauth:${oauthState}`, { type: 'json' }); expect(savedOAuthState).toEqual({ userId: 1, redirectUri: 'http://example.test/api/oauth/outlook/callback' }); expect(JSON.stringify(savedOAuthState)).not.toContain('test-outlook-client');
			const oauthCallback = await request(`/api/oauth/outlook/callback?code=oauth-code&state=${encodeURIComponent(oauthState)}`); expect(oauthCallback.status).toBe(200); const callbackHtml = await oauthCallback.text(); expect(callbackHtml).toContain('outlook-oauth-result'); expect(callbackHtml).toContain('"success":true'); expect(callbackHtml).toContain('http://example.test'); expect(await env.kv.get(`outlook-oauth:${oauthState}`)).toBeNull(); const codeExchange = mock.mock.calls.find(([url, init]) => String(url).includes('/token') && String(init?.body).includes('grant_type=authorization_code')); expect(String(codeExchange?.[1]?.body)).toContain('client_id=test-outlook-client-id'); expect(String(codeExchange?.[1]?.body)).toContain('client_secret=test-outlook-client-secret');
			const group = (await (await request('/api/outlookGroup/add', await authOptions(1, ['outlook:query'], 'POST', { name: 'Work', sort: 10 }))).json()).data;
			const earlierGroup = (await (await request('/api/outlookGroup/add', await authOptions(1, ['outlook:query'], 'POST', { name: 'Personal', sort: 0 }))).json()).data;
			expect((await (await request('/api/outlookGroup/list', await authOptions(1, ['outlook:query']))).json()).data.list.map(item => item.outlookGroupId)).toEqual([earlierGroup.outlookGroupId, group.outlookGroupId]);
			const tag = (await (await request('/api/outlookTag/add', await authOptions(1, ['outlook:query'], 'POST', { name: 'Urgent' }))).json()).data;
			expect((await request('/api/outlookAccount/set', await authOptions(1, ['outlook:query'], 'PUT', { outlookAccountId: account.outlookAccountId, groupId: group.outlookGroupId, tagIds: [tag.outlookTagId] }))).status).toBe(200);
			const groupedList = await request(`/api/outlookAccount/list?groupId=${group.outlookGroupId}&limit=50&offset=0`, await authOptions(1, ['outlook:query'])); expect((await groupedList.json()).data.list).toEqual([expect.objectContaining({ outlookAccountId: account.outlookAccountId, accountId: localAccount.account_id, groupId: group.outlookGroupId })]);
			const reorderedGroup = await request('/api/outlookGroup/set', await authOptions(1, ['outlook:query'], 'PUT', { outlookGroupId: group.outlookGroupId, name: 'Work', sort: 0 })); expect((await reorderedGroup.json()).data).toMatchObject({ outlookGroupId: group.outlookGroupId, sort: 0 }); const orderedGroupIds = (await (await request('/api/outlookGroup/list', await authOptions(1, ['outlook:query']))).json()).data.list.map(item => item.outlookGroupId); expect(orderedGroupIds).toEqual([group.outlookGroupId, earlierGroup.outlookGroupId]); const invalidGroupSort = await request('/api/outlookGroup/set', await authOptions(1, ['outlook:query'], 'PUT', { outlookGroupId: group.outlookGroupId, name: 'Work', sort: -1 })); expect((await invalidGroupSort.json()).code).toBe(400);
			expect((await (await request('/api/outlookGroup/memberIds?outlookGroupId=' + group.outlookGroupId, await authOptions(1, ['outlook:query']))).json()).data.outlookAccountIds).toEqual([account.outlookAccountId]);
			const batchClear = await request('/api/outlookAccount/batchSetGroup', await authOptions(1, ['outlook:query'], 'PUT', { outlookAccountIds: [account.outlookAccountId], groupId: null })); expect((await batchClear.json()).data).toEqual({ updated: 1 }); const taggedAfterBatch = await env.db.prepare(`SELECT outlook_tag_id FROM outlook_account_tag WHERE outlook_account_id = ?`).bind(account.outlookAccountId).all(); expect(taggedAfterBatch.results).toHaveLength(1); expect((await (await request('/api/outlookGroup/memberIds?outlookGroupId=' + group.outlookGroupId, await authOptions(1, ['outlook:query']))).json()).data.outlookAccountIds).toEqual([]); await request('/api/outlookAccount/batchSetGroup', await authOptions(1, ['outlook:query'], 'PUT', { outlookAccountIds: [account.outlookAccountId], groupId: group.outlookGroupId }));
			const batchDeleted = await request('/api/outlookAccount/batchDelete', await authOptions(1, ['outlook:query'], 'DELETE', { outlookAccountIds: firstPage.list.map(item => item.outlookAccountId) })); expect((await batchDeleted.json()).data).toEqual({ deleted: 2 }); const deletedConnections = await env.db.prepare(`SELECT is_del FROM outlook_connection WHERE user_id = 1 AND provider_email IN ('pool-one@example.com', 'pool-two@example.com')`).all(); expect(deletedConnections.results).toEqual([{ is_del: 1 }, { is_del: 1 }]);
			const synced = await request('/api/outlookSync/run', await authOptions(1, ['outlook:query'], 'POST', { outlookAccountId: account.outlookAccountId })); expect((await synced.json()).data).toMatchObject({ isOutlook: true, received: 3 });
			const firstDeltaRequest = mock.mock.calls.find(([url]) => String(url).includes('/mailFolders/Inbox/messages/delta'));
			expect(String(firstDeltaRequest?.[0])).toContain('%24filter=receivedDateTime+ge+');
			const repeat = await request('/api/outlookSync/run', await authOptions(1, ['outlook:query'], 'POST', { outlookAccountId: account.outlookAccountId })); expect((await repeat.json()).data.received).toBe(0);
			const emailRows = await env.db.prepare(`SELECT subject, account_id FROM email WHERE user_id = 1`).all(); expect(emailRows.results).toEqual(expect.arrayContaining([expect.objectContaining({ subject: 'Newest message' }), expect.objectContaining({ subject: 'Older message' }), expect.objectContaining({ subject: 'Junk message' })])); const attachments = await env.db.prepare(`SELECT filename FROM attachments WHERE email_id IN (SELECT email_id FROM email)`).all(); expect(attachments.results[0].filename).toBe('proof.txt');
			await env.db.prepare(`INSERT INTO perm (name, perm_key, pid, type) VALUES ('Inbox accounts', 'account:query', 0, 2)`).run();
			await env.db.prepare(`CREATE TABLE star (star_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, email_id INTEGER NOT NULL)`).run();
			const inboxAccounts = await request('/api/account/list?accountId=0&size=30', await authOptions(1, ['account:query'])); expect((await inboxAccounts.json()).data.map(item => item.accountId)).not.toContain(localAccount.account_id);
			const inboxMessages = await request(`/api/email/list?accountId=${localAccount.account_id}&allReceive=0&emailId=0&timeSort=0&size=50&type=0`, await authOptions(1)); expect((await inboxMessages.json()).data).toMatchObject({ list: [], total: 0 });
			const outlookMessages = await request(`/api/email/list?accountId=${localAccount.account_id}&allReceive=0&emailId=0&timeSort=0&size=50&type=0&outlook=1&outlookFolder=inbox`, await authOptions(1)); const outlookMessageData = (await outlookMessages.json()).data; expect(outlookMessageData).toMatchObject({ total: 2 }); expect(outlookMessageData.list.map(item => item.subject)).toEqual(['Newest message', 'Older message']); const outlookNextPage = await request(`/api/email/list?accountId=${localAccount.account_id}&allReceive=0&emailId=${outlookMessageData.list[0].emailId}&timeSort=0&size=1&type=0&outlook=1&outlookFolder=inbox`, await authOptions(1)); expect((await outlookNextPage.json()).data).toMatchObject({ total: 2, list: [expect.objectContaining({ subject: 'Older message' })] }); const junkMessages = await request(`/api/email/list?accountId=${localAccount.account_id}&allReceive=0&emailId=0&timeSort=0&size=50&type=0&outlook=1&outlookFolder=junkemail`, await authOptions(1)); expect((await junkMessages.json()).data).toMatchObject({ total: 1, list: [expect.objectContaining({ subject: 'Junk message' })] });
			const localOnly = await request('/api/outlookSync/run', await authOptions(1, ['outlook:query'], 'POST', { accountId: 1 })); expect((await localOnly.json()).data.isOutlook).toBe(false);
			await env.db.prepare(`INSERT INTO account (account_id, email, name, user_id) VALUES (10, 'outlook-user@example.com', 'outlook-user', 3)`).run();
			await env.db.prepare(`INSERT INTO outlook_connection(user_id, provider_email, client_id, refresh_token_ciphertext) VALUES (3, 'outlook-user@example.com', 'client-id', 'refresh-token')`).run();
			const outlookUserConnection = await env.db.prepare(`SELECT outlook_connection_id FROM outlook_connection WHERE user_id = 3`).first();
			await env.db.prepare(`INSERT INTO outlook_account(user_id, email, client_id, client_secret_ciphertext, refresh_token_ciphertext, outlook_connection_id) VALUES (3, 'outlook-user@example.com', 'client-id', 'client-secret', 'refresh-token', ?)`).bind(outlookUserConnection.outlook_connection_id).run();
			const outlookUserAccounts = await request('/api/outlookAccount/list?limit=50&offset=0', await authOptions(3, ['outlook:query'])); expect((await outlookUserAccounts.json()).data.list).toEqual([expect.objectContaining({ email: 'outlook-user@example.com', accountId: 10 })]);
			const outlookUserGroups = await request('/api/outlookGroup/list', await authOptions(3, ['outlook:query'])); expect((await outlookUserGroups.json()).data.list).toEqual([]);
			const foreignAccount = await request('/api/outlookAccount/set', await authOptions(3, ['outlook:query'], 'PUT', { outlookAccountId: account.outlookAccountId, groupId: null, tagIds: [] })); expect((await foreignAccount.json()).code).toBe(404);
			const foreignGroup = await request(`/api/outlookGroup/memberIds?outlookGroupId=${group.outlookGroupId}`, await authOptions(3, ['outlook:query'])); expect((await foreignGroup.json()).code).toBe(404);
			const foreignTag = await request('/api/outlookTag/set', await authOptions(3, ['outlook:query'], 'PUT', { outlookTagId: tag.outlookTagId, name: 'Foreign' })); expect((await foreignTag.json()).code).toBe(404);
			const foreignSync = await request('/api/outlookSync/run', await authOptions(3, ['outlook:query'], 'POST', { outlookAccountId: account.outlookAccountId })); expect((await foreignSync.json()).code).toBe(404);
			await request(`/api/outlookTag/delete?outlookTagId=${tag.outlookTagId}`, await authOptions(1, ['outlook:query'], 'DELETE')); await request(`/api/outlookGroup/delete?outlookGroupId=${group.outlookGroupId}`, await authOptions(1, ['outlook:query'], 'DELETE')); const cleared = await env.db.prepare(`SELECT group_id FROM outlook_account WHERE outlook_account_id = ?`).bind(account.outlookAccountId).first(); expect(cleared.group_id).toBeNull();
		} finally { mock.mockRestore(); }
	});
	it('removes expired inboxes through the scheduled handler', async () => { await enable(); const key = await seedKey(); const account = (await (await request('/v1/accounts', apiOptions(key, 'POST', { domain: 'example.com', localPart: 'expired' }))).json()).data; await env.db.prepare('UPDATE temp_inbox SET expires_at = ? WHERE temp_inbox_id = ?').bind(new Date(0).toISOString(), account.id).run(); const controller = createScheduledController({ scheduledTime: new Date(), cron: '0 * * * *' }); const ctx = createExecutionContext(); await worker.scheduled(controller, env, ctx); await waitOnExecutionContext(ctx); expect(await env.db.prepare('SELECT temp_inbox_id FROM temp_inbox WHERE temp_inbox_id = ?').bind(account.id).first()).toBeNull(); });
});
