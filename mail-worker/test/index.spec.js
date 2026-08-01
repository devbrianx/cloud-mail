import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src';
import { email } from '../src/email/email';
import apiKeyService from '../src/service/api-key-service';

const encoder = new TextEncoder();

async function hash(value) {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function request(path, options = {}) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`http://example.test${path}`, options), env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function seedKey(secret = 'cm_test-secret', scopes = ['inboxes:read', 'inboxes:write', 'messages:read', 'messages:write'], userId = 1) {
	await env.db.prepare('INSERT INTO api_key (user_id, name, secret_hash, secret_prefix, scopes) VALUES (?, ?, ?, ?, ?)')
		.bind(userId, 'test', await hash(secret), secret.slice(0, 8), JSON.stringify(scopes)).run();
	return secret;
}

function apiOptions(secret, method = 'GET', body) {
	return {
		method,
		headers: { 'X-API-Key': secret, ...(body ? { 'Content-Type': 'application/json' } : {}) },
		...(body ? { body: JSON.stringify(body) } : {})
	};
}

describe('temporary inbox API', () => {
	it('publishes the contract while disabled and rejects operational calls', async () => {
		const docs = await request('/v1/openapi.json');
		expect(docs.status).toBe(200);
		expect((await docs.json()).openapi).toBe('3.1.0');
		await env.kv.put('setting:', JSON.stringify({ ...(await env.kv.get('setting:', { type: 'json' })), apiEnabled: 1 }));
		const response = await request('/v1/inboxes', apiOptions('cm_invalid', 'POST', { domain: 'example.com' }));
		expect(response.status).toBe(403);
		expect((await response.json()).errorCode).toBe('api_disabled');
	});


	it('includes configured domains in the public website configuration', async () => {
		const response = await request('/api/setting/websiteConfig');
		expect(response.status).toBe(200);
		expect((await response.json()).data.domainList).toEqual(['@example.com', '@alt.example.com']);
	});
	it('creates only valid keys and never stores their plaintext secret', async () => {
		const context = { env, get() { return undefined; }, set() {} };
		const created = await apiKeyService.create(context, 1, { name: 'automation', scopes: ['inboxes:read'] });
		expect(created.secret).toMatch(/^cm_/);
		const stored = await env.db.prepare('SELECT secret_hash, secret_prefix FROM api_key WHERE api_key_id = ?').bind(created.apiKeyId).first();
		expect(stored.secret_hash).not.toContain(created.secret);
		expect(stored.secret_prefix).toBe(created.secret.slice(0, 8));
		await expect(apiKeyService.create(context, 1, { name: '', scopes: [] })).rejects.toMatchObject({ code: 400 });
		for (let index = 0; index < 9; index++) await apiKeyService.create(context, 1, { name: `key-${index}`, scopes: ['inboxes:read'] });
		await expect(apiKeyService.create(context, 1, { name: 'too-many', scopes: ['inboxes:read'] })).rejects.toMatchObject({ code: 403 });
	});

	it('creates a key-owned inbox and prevents same-user cross-key access', async () => {
		const first = await seedKey('cm_first');
		const second = await seedKey('cm_second');
		const created = await request('/v1/inboxes', apiOptions(first, 'POST', { domain: 'example.com', localPart: 'integration' }));
		expect(created.status).toBe(201);
		const inbox = (await created.json()).data;
		expect(inbox.address).toBe('integration@example.com');
		const duplicate = await request('/v1/inboxes', apiOptions(first, 'POST', { domain: 'example.com', localPart: 'integration' }));
		expect(duplicate.status).toBe(409);
		expect((await duplicate.json()).errorCode).toBe('address_conflict');
		const otherKey = await request(`/v1/inboxes/${inbox.id}`, apiOptions(second));
		expect(otherKey.status).toBe(404);
		expect((await otherKey.json()).errorCode).toBe('inbox_not_found');
	});

	it('stores inbound mail outside persistent mailbox tables and manages it through v1', async () => {
		const secret = await seedKey();
		const created = await request('/v1/inboxes', apiOptions(secret, 'POST', { domain: 'example.com', localPart: 'receive' }));
		const inbox = (await created.json()).data;
		const raw = 'From: Sender <sender@example.net>\r\nTo: receive@example.com\r\nSubject: Verification\r\nMessage-ID: <test@example.net>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="mail"\r\n\r\n--mail\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour code is 123456.\r\n--mail\r\nContent-Type: text/plain; name="proof.txt"\r\nContent-Disposition: attachment; filename="proof.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--mail--';
		const message = {
			to: inbox.address,
			raw: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); } }),
			setReject() {},
			forward() {}
		};
		await email(message, env, {});
		const list = await request(`/v1/inboxes/${inbox.id}/messages`, apiOptions(secret));
		expect(list.status).toBe(200);
		const listed = (await list.json()).data.messages;
		expect(listed).toHaveLength(1);
		expect(listed[0].subject).toBe('Verification');
		const detail = await request(`/v1/messages/${listed[0].id}`, apiOptions(secret));
		const detailData = (await detail.json()).data;
		expect(detailData.text).toContain('123456');
		expect(detailData.attachments).toHaveLength(1);
		const attachmentResponse = await request(detailData.attachments[0].downloadUrl, apiOptions(secret));
		expect(attachmentResponse.status).toBe(200);
		expect(await attachmentResponse.text()).toBe('hello');
		const patched = await request(`/v1/messages/${listed[0].id}`, apiOptions(secret, 'PATCH', { seen: true }));
		expect(patched.status).toBe(200);
		expect((await patched.json()).data.seen).toBe(true);
		const deleted = await request(`/v1/messages/${listed[0].id}`, apiOptions(secret, 'DELETE'));
		expect(deleted.status).toBe(204);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM temp_message').first()).total).toBe(0);
	});

	it('rejects revoked keys and cleans expired inboxes on access', async () => {
		const secret = await seedKey();
		const created = await request('/v1/inboxes', apiOptions(secret, 'POST', { domain: 'example.com', localPart: 'expired' }));
		const inbox = (await created.json()).data;
		await env.db.prepare('UPDATE temp_inbox SET expires_at = ? WHERE temp_inbox_id = ?').bind(new Date(0).toISOString(), inbox.id).run();
		const expired = await request(`/v1/inboxes/${inbox.id}`, apiOptions(secret));
		expect(expired.status).toBe(404);
		expect(await env.db.prepare('SELECT temp_inbox_id FROM temp_inbox WHERE temp_inbox_id = ?').bind(inbox.id).first()).toBeNull();
		await env.db.prepare('UPDATE api_key SET revoked_at = ? WHERE secret_hash = ?').bind(new Date().toISOString(), await hash(secret)).run();
		const revoked = await request('/v1/inboxes', apiOptions(secret));
		expect(revoked.status).toBe(401);
		expect((await revoked.json()).errorCode).toBe('api_key_invalid');
	});

	it('removes expired inboxes through the hourly scheduled handler', async () => {
		const secret = await seedKey();
		const created = await request('/v1/inboxes', apiOptions(secret, 'POST', { domain: 'example.com', localPart: 'cron-expired' }));
		const inbox = (await created.json()).data;
		await env.db.prepare('UPDATE temp_inbox SET expires_at = ? WHERE temp_inbox_id = ?').bind(new Date(0).toISOString(), inbox.id).run();
		const controller = createScheduledController({ scheduledTime: new Date(), cron: '0 * * * *' });
		const ctx = createExecutionContext();
		await worker.scheduled(controller, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await env.db.prepare('SELECT temp_inbox_id FROM temp_inbox WHERE temp_inbox_id = ?').bind(inbox.id).first()).toBeNull();
	});
});
