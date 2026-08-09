import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
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

async function authOptions(userId, permKeys = [], method = 'GET', body) {
	await dbInit.v3_5DB({ env });
	await dbInit.v3_6DB({ env });
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
		if (url.includes('/delta-token')) return new Response(JSON.stringify({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-token' }), { status: 200 });
		if (url.includes('/messages/delta')) return new Response(JSON.stringify({ value: [{ id: 'graph-1', internetMessageId: '<graph-1>', subject: 'Verification 123456', from: { emailAddress: { address: 'sender@example.net', name: 'Sender' } }, toRecipients: [{ emailAddress: { address: 'outlook@example.com', name: 'Outlook' } }], ccRecipients: [], receivedDateTime: '2026-01-01T00:00:00Z', body: { contentType: 'html', content: '<p>message</p>' }, hasAttachments: true, isRead: false }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-token' }), { status: 200 });
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

	it('groups temporary identities by managed country', async () => {
		await dbInit.v3_4DB({ env }); await env.db.prepare(`INSERT INTO temporary_identity(rowkey, data) VALUES ('legacy', '{}')`).run(); await dbInit.v3_5DB({ env }); await dbInit.v3_5DB({ env }); expect((await env.db.prepare(`SELECT country FROM temporary_identity WHERE rowkey = 'legacy'`).first()).country).toBe('未分类'); expect((await env.db.prepare(`SELECT country FROM temporary_identity_country WHERE country = '未分类'`).first()).country).toBe('未分类'); const tree = await permService.tree({ env }); expect(tree.find(item => item.name === '临时身份').children.map(item => item.permKey)).toEqual(['temporary-identity:query', 'temporary-identity:add', 'temporary-identity:set', 'temporary-identity:delete']); await env.db.prepare(`INSERT INTO role(role_id, name, key) VALUES (2, 'query-only', '')`).run(); await env.db.prepare(`INSERT INTO user(user_id, email, type) VALUES (3, 'query@example.com', 2)`).run(); for (const country of ['美国', '韩国', '日本']) expect((await request('/api/temporaryIdentity/country/add', await authOptions(1, ['temporary-identity:add'], 'POST', { country }))).status).toBe(200); const record = { Full_Name: 'Mick Eli U', Gender: 'Male', Temporary_mail: 'boofxekkzc@iubridge.com', Username: 'weaponlaughable', Address: 'Istanbul address', Address_Alias: 'Alias address', Trans_Address: 'Translated address', Trans_Cn_Address: '中文地址', City: 'Istanbul', Password: 'v8Yb1xkxQUsF', Credit_Card_Number: '04929885152148429', CVV2: '251', Custom_Field: 'preserve me' }; const denied = await request('/api/temporaryIdentity/countries', await authOptions(3)); expect((await denied.json()).code).toBe(403); const missingCountry = await request('/api/temporaryIdentity/add', await authOptions(1, ['temporary-identity:add'], 'POST', { data: record })); expect((await missingCountry.json()).code).toBe(400); const unknownCountry = await request('/api/temporaryIdentity/add', await authOptions(1, ['temporary-identity:add'], 'POST', { country: '不存在', data: record })); expect((await unknownCountry.json()).code).toBe(400); const created = []; for (const [country, name] of [['美国', 'Alice'], ['韩国', 'Kim One'], ['韩国', 'Kim Two']]) { const response = await request('/api/temporaryIdentity/add', await authOptions(1, ['temporary-identity:add'], 'POST', { country, data: { ...record, Full_Name: name, Country: '错误国家' } })); created.push((await response.json()).data); } const countries = (await (await request('/api/temporaryIdentity/countries', await authOptions(3, ['temporary-identity:query']))).json()).data.list; expect(countries.find(item => item.country === '美国').count).toBe(1); expect(countries.find(item => item.country === '韩国').count).toBe(2); const korean = (await (await request('/api/temporaryIdentity/list?country=韩国', await authOptions(3, ['temporary-identity:query']))).json()).data; expect(korean.list).toHaveLength(2); const noCountry = await request('/api/temporaryIdentity/list', await authOptions(3, ['temporary-identity:query'])); expect((await noCountry.json()).code).toBe(400); const detail = (await (await request(`/api/temporaryIdentity/detail/${created[1].rowkey}`, await authOptions(3, ['temporary-identity:query']))).json()).data; expect(detail).toMatchObject({ Country: '韩国', Address_Alias: record.Address_Alias, Trans_Address: record.Trans_Address, Trans_Cn_Address: record.Trans_Cn_Address }); const queryOnlyAdd = await request('/api/temporaryIdentity/add', await authOptions(3, ['temporary-identity:query'], 'POST', { country: '美国', data: record })); expect((await queryOnlyAdd.json()).code).toBe(403); const renamed = await request('/api/temporaryIdentity/country/set/韩国', await authOptions(1, ['temporary-identity:set'], 'PUT', { country: '韩国共和国' })); expect((await renamed.json()).data.country).toBe('韩国共和国'); const renamedDetail = (await (await request(`/api/temporaryIdentity/detail/${created[1].rowkey}`, await authOptions(3, ['temporary-identity:query']))).json()).data; expect(renamedDetail.Country).toBe('韩国共和国'); const blockedDelete = await request('/api/temporaryIdentity/country/delete/韩国共和国', await authOptions(1, ['temporary-identity:delete'], 'DELETE')); expect((await blockedDelete.json()).code).toBe(409); const deletedJapan = await request('/api/temporaryIdentity/country/delete/日本', await authOptions(1, ['temporary-identity:delete'], 'DELETE')); expect((await deletedJapan.json()).data.deleted).toBe(1); const badData = await request('/api/temporaryIdentity/add', await authOptions(1, ['temporary-identity:add'], 'POST', { country: '美国', data: { Full_Name: ['array'] } })); expect((await badData.json()).code).toBe(400); const deleted = await request('/api/temporaryIdentity/delete', await authOptions(1, ['temporary-identity:delete'], 'DELETE', { rowkeys: created.map(item => item.rowkey) })); expect((await deleted.json()).data.deleted).toBe(3); });

	it('manages private Outlook accounts, groups, tags, and Graph inbox synchronization', async () => {
		await dbInit.v3_6DB({ env }); await dbInit.v3_6DB({ env });
		const tree = await permService.tree({ env }); expect(tree.find(item => item.name === 'Outlook 邮箱管理').children).toHaveLength(13);
		const allPermissions = ['outlook-account:query', 'outlook-account:add', 'outlook-account:set', 'outlook-account:delete', 'outlook-group:query', 'outlook-group:add', 'outlook-group:set', 'outlook-group:delete', 'outlook-tag:query', 'outlook-tag:add', 'outlook-tag:set', 'outlook-tag:delete', 'outlook-sync:run'];
		const mock = microsoftMock();
		try {
			const imported = await request('/api/outlookAccount/import', await authOptions(1, ['outlook-account:add'], 'POST', { rows: 'outlook@example.com----client-secret----refresh-token----client-id\nbroken-row' }));
			const importData = (await imported.json()).data; expect(importData.imported).toHaveLength(1); expect(importData.failed).toHaveLength(1);
			const stored = await env.db.prepare(`SELECT client_secret_ciphertext, refresh_token_ciphertext FROM outlook_account WHERE user_id = 1`).first(); expect(stored.client_secret_ciphertext).not.toContain('client-secret'); expect(stored.refresh_token_ciphertext).not.toContain('refresh-token');
			const noQuery = await request('/api/outlookAccount/list', await authOptions(1)); expect((await noQuery.json()).code).toBe(403);
			const listResponse = await request('/api/outlookAccount/list', await authOptions(1, ['outlook-account:query'])); const account = (await listResponse.json()).data.list[0]; expect(account).not.toHaveProperty('clientId'); expect(account).not.toHaveProperty('refreshToken');
			const group = (await (await request('/api/outlookGroup/add', await authOptions(1, ['outlook-group:add'], 'POST', { name: 'Work' }))).json()).data;
			const tag = (await (await request('/api/outlookTag/add', await authOptions(1, ['outlook-tag:add'], 'POST', { name: 'Urgent' }))).json()).data;
			expect((await request('/api/outlookAccount/set', await authOptions(1, ['outlook-account:set'], 'PUT', { outlookAccountId: account.outlookAccountId, groupId: group.outlookGroupId, tagIds: [tag.outlookTagId] }))).status).toBe(200);
			const synced = await request('/api/outlookSync/run', await authOptions(1, ['outlook-sync:run'], 'POST', { outlookAccountId: account.outlookAccountId })); expect((await synced.json()).data).toMatchObject({ isOutlook: true, received: 1 });
			const repeat = await request('/api/outlookSync/run', await authOptions(1, ['outlook-sync:run'], 'POST', { outlookAccountId: account.outlookAccountId })); expect((await repeat.json()).data.received).toBe(0);
			const emailRow = await env.db.prepare(`SELECT subject, account_id FROM email WHERE user_id = 1`).first(); expect(emailRow.subject).toBe('Verification 123456'); const attachments = await env.db.prepare(`SELECT filename FROM attachments WHERE email_id IN (SELECT email_id FROM email)`).all(); expect(attachments.results[0].filename).toBe('proof.txt');
			const localOnly = await request('/api/outlookSync/run', await authOptions(1, ['outlook-sync:run'], 'POST', { accountId: 1 })); expect((await localOnly.json()).data.isOutlook).toBe(false);
			const foreign = await request('/api/outlookAccount/set', await authOptions(2, ['outlook-account:set'], 'PUT', { outlookAccountId: account.outlookAccountId, groupId: null, tagIds: [] })); expect((await foreign.json()).code).toBe(404);
		await request(`/api/outlookTag/delete?outlookTagId=${tag.outlookTagId}`, await authOptions(1, ['outlook-tag:delete'], 'DELETE')); await request(`/api/outlookGroup/delete?outlookGroupId=${group.outlookGroupId}`, await authOptions(1, ['outlook-group:delete'], 'DELETE')); const cleared = await env.db.prepare(`SELECT group_id FROM outlook_account WHERE outlook_account_id = ?`).bind(account.outlookAccountId).first(); expect(cleared.group_id).toBeNull();
		} finally { mock.mockRestore(); }
	});
	it('removes expired inboxes through the scheduled handler', async () => { await enable(); const key = await seedKey(); const account = (await (await request('/v1/accounts', apiOptions(key, 'POST', { domain: 'example.com', localPart: 'expired' }))).json()).data; await env.db.prepare('UPDATE temp_inbox SET expires_at = ? WHERE temp_inbox_id = ?').bind(new Date(0).toISOString(), account.id).run(); const controller = createScheduledController({ scheduledTime: new Date(), cron: '0 * * * *' }); const ctx = createExecutionContext(); await worker.scheduled(controller, env, ctx); await waitOnExecutionContext(ctx); expect(await env.db.prepare('SELECT temp_inbox_id FROM temp_inbox WHERE temp_inbox_id = ?').bind(account.id).first()).toBeNull(); });
});
