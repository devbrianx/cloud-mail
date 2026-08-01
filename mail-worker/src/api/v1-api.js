import app from '../hono/hono';
import BizError from '../error/biz-error';
import apiResponse from '../model/api-response';
import settingService from '../service/setting-service';
import tempInboxService from '../service/temp-inbox-service';
import tempMessageService from '../service/temp-message-service';
import r2Service from '../service/r2-service';

const docs = {
	openapi: '3.1.0',
	info: { title: 'Cloud Mail Temporary Inbox API', version: '1.0.0', description: 'Key-owned temporary inboxes expire after 24 hours. Operational endpoints require an enabled API feature and X-API-Key.' },
	servers: [{ url: '/v1' }],
	components: {
		securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
		schemas: {
			Success: { type: 'object', required: ['success', 'data'], properties: { success: { const: true }, data: {} } },
			Error: { type: 'object', required: ['success', 'error', 'errorCode'], properties: { success: { const: false }, error: { type: 'string' }, errorCode: { type: 'string' } } },
			InboxCreate: { type: 'object', required: ['domain'], properties: { domain: { type: 'string' }, localPart: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,62}$' } } },
			Inbox: { type: 'object', required: ['id', 'address', 'domain', 'createdAt', 'expiresAt', 'isActive'], properties: { id: { type: 'string', pattern: '^[a-f0-9]{32}$' }, address: { type: 'string', format: 'email' }, domain: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' }, isActive: { type: 'boolean' } } },
			MessageUpdate: { type: 'object', required: ['seen'], additionalProperties: false, properties: { seen: { type: 'boolean' } } }
		}
	},
	paths: {
		'/inboxes': {
			get: { summary: 'List active inboxes created by this API key', security: [{ ApiKey: [] }], responses: { 200: { description: 'Inbox list' }, 401: { description: 'Invalid key' }, 403: { description: 'Disabled API or missing scope' } } },
			post: { summary: 'Create a 24-hour temporary inbox', security: [{ ApiKey: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/InboxCreate' } } } }, responses: { 201: { description: 'Created inbox' }, 400: { description: 'Invalid domain or local part' }, 409: { description: 'Address conflict' } } }
		},
		'/inboxes/{id}': { get: { summary: 'Get temporary inbox', security: [{ ApiKey: [] }], responses: { 200: { description: 'Inbox details' }, 404: { description: 'Not found or not owned by key' } } }, delete: { summary: 'Delete temporary inbox', security: [{ ApiKey: [] }], responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found or not owned by key' } } } },
		'/inboxes/{id}/messages': { get: { summary: 'List messages', security: [{ ApiKey: [] }], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }, { name: 'seen', in: 'query', schema: { type: 'boolean' } }, { name: 'after_id', in: 'query', schema: { type: 'integer', minimum: 1 } }], responses: { 200: { description: 'Message page' }, 404: { description: 'Not found or not owned by key' } } } },
		'/messages/{id}': { get: { summary: 'Get message detail', security: [{ ApiKey: [] }], responses: { 200: { description: 'Message detail' }, 404: { description: 'Not found or not owned by key' } } }, patch: { summary: 'Set seen state', security: [{ ApiKey: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageUpdate' } } } }, responses: { 200: { description: 'Updated message' }, 400: { description: 'Invalid update' }, 404: { description: 'Not found or not owned by key' } } }, delete: { summary: 'Delete message', security: [{ ApiKey: [] }], responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found or not owned by key' } } } },
		'/messages/{id}/attachments/{attachmentId}': { get: { summary: 'Download attachment', security: [{ ApiKey: [] }], responses: { 200: { description: 'Attachment binary' }, 404: { description: 'Not found or not owned by key' }, 503: { description: 'Configured storage unavailable' } } } }
	}
};

const llms = `# Cloud Mail Temporary Inbox API

Base URL: /v1

Operational endpoints require an administrator to enable the API feature and an API key created in the Cloud Mail web application. Send the key in the X-API-Key header. Every temporary inbox belongs only to the key that created it and expires after 24 hours.

## Scopes
- inboxes:read — list and view inboxes
- inboxes:write — create and delete inboxes
- messages:read — list/view messages and download attachments
- messages:write — update seen state and delete messages

## Examples

POST /v1/inboxes with X-API-Key, Content-Type: application/json, and {"domain":"example.com","localPart":"demo"} creates an inbox.
GET /v1/inboxes/{id}/messages lists messages.
PATCH /v1/messages/{id} with {"seen":true} updates read state.

Errors use {"success":false,"error":"...","errorCode":"..."}. Operational routes return api_disabled until an administrator enables the feature.`;

function apiError(c, error) {
	if (error instanceof BizError) {
		const errorCode = {
			'API domain is not allowed': 'domain_not_allowed',
			'API inbox local part is invalid': 'local_part_invalid',
			'API inbox address already exists': 'address_conflict',
			'Inbox not found': 'inbox_not_found',
			'Message not found': 'message_not_found',
			'Attachment not found': 'attachment_not_found',
			'Message update is invalid': 'invalid_message_update'
		}[error.message] || (error.code === 403 ? 'scope_forbidden' : 'invalid_request');
		return apiResponse.fail(c, error.code, errorCode, error.message);
	}
	console.error(error);
	return apiResponse.fail(c, 500, 'internal_error', 'Internal server error');
}

function apiHandler(handler) {
	return async c => {
		try {
			return await handler(c);
		} catch (error) {
			return apiError(c, error);
		}
	};
}

function principal(c) {
	return c.get('apiPrincipal');
}

function requireScope(c, scope) {
	if (!principal(c)?.scopes.includes(scope)) {
		return apiResponse.fail(c, 403, 'scope_forbidden', 'API key scope is insufficient');
	}
	return null;
}

function allowedDomains(c, setting) {
	const configured = c.env.domain;
	try {
		const domains = typeof configured === 'string' ? JSON.parse(configured) : configured;
		return { apiDomains: setting.apiDomains, allowedDomains: Array.isArray(domains) ? domains.map(domain => domain.toLowerCase()) : [] };
	} catch {
		throw new BizError('API domain configuration is invalid', 500);
	}
}

app.get('/v1/openapi.json', c => c.json(docs));
app.get('/v1/llms.txt', c => c.text(llms, 200, { 'Content-Type': 'text/markdown; charset=utf-8' }));

app.post('/v1/inboxes', apiHandler(async c => {
	const denied = requireScope(c, 'inboxes:write');
	if (denied) return denied;
	const setting = await settingService.query(c);
	const data = await tempInboxService.create(c, principal(c), await c.req.json(), ...Object.values(allowedDomains(c, setting)));
	return apiResponse.ok(c, data, 201);
}));

app.get('/v1/inboxes', apiHandler(async c => {
	const denied = requireScope(c, 'inboxes:read');
	if (denied) return denied;
	return apiResponse.ok(c, await tempInboxService.list(c, principal(c).apiKeyId));
}));

app.get('/v1/inboxes/:id', apiHandler(async c => {
	const denied = requireScope(c, 'inboxes:read');
	if (denied) return denied;
	const inbox = await tempInboxService.requireActiveOwnedInbox(c, principal(c).apiKeyId, c.req.param('id'));
	return apiResponse.ok(c, await tempInboxService.detail(c, inbox));
}));

app.delete('/v1/inboxes/:id', apiHandler(async c => {
	const denied = requireScope(c, 'inboxes:write');
	if (denied) return denied;
	const inbox = await tempInboxService.requireActiveOwnedInbox(c, principal(c).apiKeyId, c.req.param('id'));
	await tempInboxService.deleteInbox(c, inbox);
	return apiResponse.noContent(c);
}));

app.get('/v1/inboxes/:id/messages', apiHandler(async c => {
	const denied = requireScope(c, 'messages:read');
	if (denied) return denied;
	const inbox = await tempInboxService.requireActiveOwnedInbox(c, principal(c).apiKeyId, c.req.param('id'));
	return apiResponse.ok(c, await tempMessageService.list(c, inbox, c.req.query()));
}));

app.get('/v1/messages/:id', apiHandler(async c => {
	const denied = requireScope(c, 'messages:read');
	if (denied) return denied;
	const row = await tempMessageService.requireOwnedMessage(c, principal(c).apiKeyId, Number(c.req.param('id')));
	return apiResponse.ok(c, await tempMessageService.detail(c, row));
}));

app.patch('/v1/messages/:id', apiHandler(async c => {
	const denied = requireScope(c, 'messages:write');
	if (denied) return denied;
	const body = await c.req.json();
	if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'seen')) throw new BizError('Message update is invalid', 400);
	const row = await tempMessageService.requireOwnedMessage(c, principal(c).apiKeyId, Number(c.req.param('id')));
	return apiResponse.ok(c, await tempMessageService.setSeen(c, row, body.seen));
}));

app.delete('/v1/messages/:id', apiHandler(async c => {
	const denied = requireScope(c, 'messages:write');
	if (denied) return denied;
	const row = await tempMessageService.requireOwnedMessage(c, principal(c).apiKeyId, Number(c.req.param('id')));
	await tempMessageService.delete(c, row);
	return apiResponse.noContent(c);
}));

app.get('/v1/messages/:id/attachments/:attachmentId', apiHandler(async c => {
	const denied = requireScope(c, 'messages:read');
	if (denied) return denied;
	const row = await tempMessageService.requireOwnedMessage(c, principal(c).apiKeyId, Number(c.req.param('id')));
	const attachment = await tempMessageService.attachment(c, row, Number(c.req.param('attachmentId')));
	const object = await r2Service.getObj(c, attachment.key);
	if (!object?.body) return apiResponse.fail(c, 404, 'attachment_not_found', 'Attachment not found');
	return new Response(object.body, { headers: { 'Content-Type': attachment.mimeType || object.httpMetadata?.contentType || 'application/octet-stream', 'Content-Disposition': attachment.disposition || object.httpMetadata?.contentDisposition || `attachment;filename=${attachment.filename || ''}` } });
}));
