import app from '../hono/hono';
import BizError from '../error/biz-error';
import apiResponse from '../model/api-response';
import settingService from '../service/setting-service';
import tempInboxService from '../service/temp-inbox-service';
import tempMessageService from '../service/temp-message-service';
import tempTokenService from '../service/temp-token-service';
import apiUsageService from '../service/api-usage-service';
import r2Service from '../service/r2-service';
import { and, eq, isNull, sql } from 'drizzle-orm';
import orm from '../entity/orm';
import tempInbox from '../entity/temp-inbox';

const docs = {
	openapi: '3.1.0', info: { title: 'Cloud Mail Temporary Inbox API', version: '2.0.0', description: 'Compatible temporary account and message API.' }, servers: [{ url: '/v1' }],
	components: { securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' }, TempToken: { type: 'http', scheme: 'bearer' } }, schemas: { Envelope: { type: 'object', properties: { success: { type: 'boolean' }, data: {} } }, CreateAccountRequest: { type: 'object', properties: { localPart: { type: 'string' }, address: { type: 'string' }, domain: { type: 'string' }, password: { type: 'string' }, subdomain: { type: 'string' }, subdomainLabel: { type: 'string' } } } } },
	paths: {
		'/accounts': { post: { summary: 'Create a temporary account', security: [{ ApiKey: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateAccountRequest' } } } }, responses: { 201: { description: 'Created' } } } },
		'/accounts/wildcard': { post: { summary: 'Create a wildcard temporary account', security: [{ ApiKey: [] }], responses: { 201: { description: 'Created' } } } },
		'/accounts/me': { get: { summary: 'Current temporary account', security: [{ TempToken: [] }], responses: { 200: { description: 'Account' } } } },
		'/token': { post: { summary: 'Refresh temporary token', security: [{ TempToken: [] }], responses: { 200: { description: 'Token' } } } },
		'/inboxes/{id}': { get: { summary: 'Get temporary account', security: [{ ApiKey: [] }, { TempToken: [] }] } },
		'/accounts/{id}': { get: { summary: 'Deprecated account alias' }, delete: { summary: 'Delete temporary account' } },
		'/inboxes/{id}/messages': { get: { summary: 'List messages' } },
		'/messages': { get: { summary: 'List messages by address' } },
		'/messages/next': { get: { summary: 'Read next unread message' } },
		'/messages/mark-read': { post: { summary: 'Mark mailbox read' } },
		'/messages/{id}': { get: { summary: 'Get message' }, patch: { summary: 'Update message state' }, delete: { summary: 'Delete message' } },
		'/sources/{id}': { get: { summary: 'Get original RFC 822 source' } }
	}
};
const llms = `# Cloud Mail Temporary Inbox API\n\nBase URL: /v1\n\nAuthenticate account creation and API-key operations with \`X-API-Key: AC-...\`. Account creation returns a temporary bearer token; use it for \`GET /accounts/me\`, \`POST /token\`, and operations on that same inbox. API keys use the address query parameter for message operations.\n\nImplemented endpoints: POST /accounts, POST /accounts/wildcard, POST /token, GET /accounts/me, GET /inboxes/{id}, GET/DELETE /accounts/{id}, GET /inboxes/{id}/messages, GET /messages, GET /messages/next, POST /messages/mark-read, GET/PATCH/DELETE /messages/{id}, GET /sources/{id}, and attachment downloads. Webhooks and non-temporary mailbox features are excluded.`;
const errorCodes = [
	['token_invalid_or_expired', 'Invalid or expired token', '令牌无效或已过期'], ['scope_forbidden', 'API key scope is insufficient', 'API 密钥权限不足'], ['account_not_found', 'Temporary account not found', '临时邮箱不存在'], ['message_not_found', 'Message not found', '邮件不存在'], ['address_required', 'Address is required', '缺少邮箱地址'], ['address_invalid_or_missing', 'Address is invalid or unavailable', '邮箱地址无效或不可用'], ['address_already_in_use', 'Address is already in use', '邮箱地址已被使用'], ['domain_not_available', 'Domain is not available', '域名不可用'], ['subdomain_invalid', 'Subdomain is invalid', '子域名无效'], ['unsupported_temporary_api_option', 'Temporary API option is unsupported', '不支持的临时邮箱 API 选项']
].map(([code, en, zh]) => ({ code, en, zh }));

function apiError(c, error) {
	if (error instanceof BizError) {
		const codes = { 'API is disabled': 'api_disabled', 'API inbox local part is invalid': 'local_part_invalid', 'API inbox address already exists': 'address_already_in_use', 'API domain is not allowed': 'domain_not_available', 'Wildcard API domain is not allowed': 'domain_not_available', 'API inbox subdomain is invalid': 'subdomain_invalid', 'Address and localPart do not match': 'address_local_part_mismatch', 'Address domain does not match domain': 'address_domain_mismatch', 'Temporary API option is unsupported': 'unsupported_temporary_api_option', 'Inbox not found': 'account_not_found', 'Message not found': 'message_not_found', 'Attachment not found': 'attachment_not_found', 'Message update is invalid': 'invalid_message_update', 'Message limit is invalid': 'invalid_pagination', 'Message cursor is invalid': 'invalid_cursor', 'Message seen filter is invalid': 'invalid_seen_filter', 'Message since filter is invalid': 'invalid_since' };
		return apiResponse.fail(c, error.code, codes[error.message] || (error.code === 403 ? 'scope_forbidden' : 'invalid_request'), error.message);
	}
	console.error(error); return apiResponse.fail(c, 500, 'internal_error', 'Internal server error');
}
function principal(c) { return c.get('apiPrincipal'); }
function requireScope(c, scope) { return principal(c).kind === 'apiKey' && !principal(c).scopes.includes(scope) ? apiResponse.fail(c, 403, 'scope_forbidden', 'API key scope is insufficient') : null; }
function deprecated(c, successor) { c.header('Deprecation', 'true'); c.header('Link', `<${successor}>; rel="successor-version"`); }
function apiHandler(handler) { return async c => { try { const response = await handler(c); if (principal(c)?.kind === 'apiKey' && response.status < 400) await apiUsageService.recordSuccess(c, principal(c).apiKeyId); return response; } catch (error) { return apiError(c, error); } }; }
async function requestBody(c) { try { return await c.req.json(); } catch { return {}; } }

function domains(setting) {
	return {
		apiDomains: (setting.apiDomains || []).map(domain => domain.toLowerCase()),
		wildcardDomains: (setting.apiWildcardDomains || []).map(domain => domain.toLowerCase())
	};
}

async function requireInboxForPrincipal(c, address) {
	const actor = principal(c);
	if (actor.kind === 'tempToken') { if (address && address.toLowerCase() !== actor.inbox.address.toLowerCase()) throw new BizError('Inbox not found', 404); return await tempInboxService.requireActiveInbox(c, actor.inbox.tempInboxId); }
	if (!address) throw new BizError('Address is required', 400);
	if (!/^[^@\s]+@[^@\s]+$/.test(address)) throw new BizError('Address is invalid or unavailable', 400);
	const inbox = await orm(c).select().from(tempInbox).where(and(sql`${tempInbox.address} COLLATE NOCASE = ${address}`, eq(tempInbox.apiKeyId, actor.apiKeyId), isNull(tempInbox.deletedAt))).get();
	if (!inbox) throw new BizError('Inbox not found', 404); return await tempInboxService.requireActiveInbox(c, inbox.tempInboxId);
}
async function requireInboxId(c, id) { const inbox = await tempInboxService.requireActiveInbox(c, id); const actor = principal(c); if ((actor.kind === 'apiKey' && inbox.apiKeyId !== actor.apiKeyId) || (actor.kind === 'tempToken' && inbox.tempInboxId !== actor.inbox.tempInboxId)) throw new BizError('Inbox not found', 404); return inbox; }

app.get('/v1/openapi.json', c => c.json(docs));
app.get('/v1/openapi.yaml', c => c.text(`openapi: 3.1.0\ninfo:\n  title: Cloud Mail Temporary Inbox API\n  version: 2.0.0\npaths:\n  /accounts:\n    post:\n      summary: Create a temporary account\n  /messages:\n    get:\n      summary: List messages by address\n`, 200, { 'Content-Type': 'application/yaml; charset=utf-8' }));
app.get('/v1/llms.txt', c => c.text(llms, 200, { 'Content-Type': 'text/markdown; charset=utf-8' }));
app.get('/v1/error-codes', c => c.json({ errorCodes }));

async function createAccount(c, forceWildcard = false) { const denied = requireScope(c, 'inboxes:write'); if (denied) return denied; const setting = await settingService.query(c); const config = domains(setting); const inbox = await tempInboxService.createCompatible(c, principal(c), await requestBody(c), config.apiDomains, config.wildcardDomains, forceWildcard); return apiResponse.ok(c, { ...tempInboxService.toApiInbox(inbox), token: await tempTokenService.issue(c, inbox) }, 201); }
app.post('/v1/accounts', apiHandler(c => createAccount(c)));
app.post('/v1/inboxes', apiHandler(async c => { deprecated(c, '/v1/accounts'); return await createAccount(c); }));
app.post('/v1/accounts/wildcard', apiHandler(c => createAccount(c, true)));
app.post('/v1/token', apiHandler(async c => { if (principal(c).kind !== 'tempToken') return apiResponse.fail(c, 401, 'token_invalid_or_expired', 'Invalid or expired token'); const body = await requestBody(c); const data = await tempTokenService.refresh(c, principal(c), c.req.query('address') || body.address); if (!data) throw new BizError('Inbox not found', 404); return apiResponse.ok(c, data); }));
app.get('/v1/accounts/me', apiHandler(async c => { if (principal(c).kind !== 'tempToken') return apiResponse.fail(c, 401, 'token_invalid_or_expired', 'Invalid or expired token'); return apiResponse.ok(c, await tempInboxService.detail(c, await tempInboxService.requireActiveInbox(c, principal(c).inbox.tempInboxId))); }));
async function getInbox(c) { const denied = requireScope(c, 'inboxes:read'); if (denied) return denied; return apiResponse.ok(c, await tempInboxService.detail(c, await requireInboxId(c, c.req.param('id')))); }
app.get('/v1/inboxes/:id', apiHandler(getInbox));
app.get('/v1/accounts/:id', apiHandler(async c => { deprecated(c, `/v1/inboxes/${c.req.param('id')}`); return await getInbox(c); }));
app.delete('/v1/accounts/:id', apiHandler(async c => { const denied = requireScope(c, 'inboxes:write'); if (denied) return denied; await tempInboxService.deleteInbox(c, await requireInboxId(c, c.req.param('id'))); return apiResponse.noContent(c); }));

async function listMessages(c, inbox) {
	const denied = requireScope(c, 'messages:read');
	if (denied) return denied;
	return apiResponse.ok(c, await tempMessageService.list(c, inbox, c.req.query()));
}
app.get('/v1/inboxes/:id/messages', apiHandler(async c => listMessages(c, await requireInboxId(c, c.req.param('id')))));
app.get('/v1/messages', apiHandler(async c => listMessages(c, await requireInboxForPrincipal(c, c.req.query('address')))));
app.get('/v1/messages/next', apiHandler(async c => { const denied = requireScope(c, 'messages:write'); if (denied) return denied; const wait = Number(c.req.query('wait') || 0); if (!Number.isInteger(wait) || wait < 0 || wait > 30) throw new BizError('Message limit is invalid', 400); const inbox = await requireInboxForPrincipal(c, c.req.query('address')); const row = await tempMessageService.next(c, inbox); return row ? apiResponse.ok(c, { message: await tempMessageService.detail(c, row, principal(c).kind === 'tempToken' ? principal(c).token : null), inboxAddress: inbox.address }) : apiResponse.noContent(c); }));
app.post('/v1/messages/mark-read', apiHandler(async c => { const denied = requireScope(c, 'messages:write'); if (denied) return denied; return apiResponse.ok(c, await tempMessageService.markRead(c, await requireInboxForPrincipal(c, c.req.query('address')))); }));
async function messageRow(c, scope) { const denied = requireScope(c, scope); if (denied) return [null, denied]; const inbox = await requireInboxForPrincipal(c, c.req.query('address')); return [await tempMessageService.requireMessage(c, inbox, Number(c.req.param('id'))), null]; }
app.get('/v1/messages/:id', apiHandler(async c => { const [row, denied] = await messageRow(c, 'messages:read'); return denied || apiResponse.ok(c, await tempMessageService.detail(c, row, principal(c).kind === 'tempToken' ? principal(c).token : null)); }));
app.patch('/v1/messages/:id', apiHandler(async c => { const [row, denied] = await messageRow(c, 'messages:write'); return denied || apiResponse.ok(c, await tempMessageService.update(c, row, await requestBody(c))); }));
app.delete('/v1/messages/:id', apiHandler(async c => { const [row, denied] = await messageRow(c, 'messages:write'); if (denied) return denied; await tempMessageService.delete(c, row); return apiResponse.noContent(c); }));
app.get('/v1/sources/:id', apiHandler(async c => { const [row, denied] = await messageRow(c, 'messages:read'); return denied || apiResponse.ok(c, { id: String(row.message.tempMessageId), data: row.message.rawSource || '' }); }));
app.get('/v1/messages/:id/attachments/:attachmentId', apiHandler(async c => { const denied = requireScope(c, 'messages:read'); if (denied) return denied; const row = await tempMessageService.requireForPrincipal(c, principal(c), Number(c.req.param('id'))); const attachment = await tempMessageService.attachment(c, row, Number(c.req.param('attachmentId'))); const object = await r2Service.getObj(c, attachment.key); if (!object?.body) return apiResponse.fail(c, 404, 'attachment_not_found', 'Attachment not found'); return new Response(object.body, { headers: { 'Content-Type': attachment.mimeType || object.httpMetadata?.contentType || 'application/octet-stream', 'Content-Disposition': attachment.disposition || object.httpMetadata?.contentDisposition || `attachment;filename=${attachment.filename || ''}` } }); }));
