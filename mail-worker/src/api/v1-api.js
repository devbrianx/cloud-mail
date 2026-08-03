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

const json = schema => ({ content: { 'application/json': { schema } } });
const response = (description, schema) => ({ description, ...(schema ? json(schema) : {}) });
const success = schema => ({ type: 'object', required: ['success', 'data'], properties: { success: { const: true }, data: schema } });
const error = { type: 'object', required: ['success', 'error', 'errorCode'], properties: { success: { const: false }, error: { type: 'string' }, errorCode: { type: 'string' } } };
const idParameter = { name: 'id', in: 'path', required: true, description: '临时邮箱 ID（32 位十六进制字符串）', schema: { type: 'string', pattern: '^[a-f0-9]{32}$' } };
const messageIdParameter = { name: 'id', in: 'path', required: true, description: '邮件 ID', schema: { type: 'integer', minimum: 1 } };
const attachmentIdParameter = { name: 'attachmentId', in: 'path', required: true, description: '附件 ID', schema: { type: 'integer', minimum: 1 } };
const addressParameter = { name: 'address', in: 'query', required: false, description: '邮箱地址。使用 API Key 时必填；使用临时 Token 时可省略且只能是该 Token 绑定的地址。', schema: { type: 'string', format: 'email' } };
const listParameters = [
	{ name: 'limit', in: 'query', description: '每页数量，1–100，默认 50', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
	{ name: 'offset', in: 'query', description: '偏移量，默认 0；与 after_id 不能同时分页', schema: { type: 'integer', minimum: 0, default: 0 } },
	{ name: 'seen', in: 'query', description: '按已读状态过滤', schema: { type: 'boolean' } },
	{ name: 'since', in: 'query', description: '仅返回此 ISO 8601 时间之后的邮件', schema: { type: 'string', format: 'date-time' } },
	{ name: 'q', in: 'query', description: '按发件人名称、地址或主题搜索', schema: { type: 'string' } },
	{ name: 'after_id', in: 'query', description: '游标：返回比该邮件 ID 更早的邮件；使用时忽略 offset', schema: { type: 'integer', minimum: 1 } }
];

const docs = {
	openapi: '3.1.0',
	info: {
		title: 'Cloud Mail Temporary Inbox API',
		version: '2.0.0',
		description: '创建并操作 24 小时有效的临时邮箱。所有业务接口在 API 功能启用后可用；文档接口始终公开。完整中文说明见 /v1/llms.txt。'
	},
	servers: [{ url: '/v1', description: '与 Cloud Mail 前端同源的 API 根路径' }],
	tags: [{ name: '账户', description: '创建、读取和删除临时邮箱' }, { name: '邮件', description: '读取、更新和删除临时邮件' }, { name: '文档', description: '公开 API 规范与错误码' }],
	components: {
		securitySchemes: {
			ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: '值为 Cloud Mail 创建的 AC- API Key。每个操作需要对应 x-required-scope。' },
			TempToken: { type: 'http', scheme: 'bearer', bearerFormat: 'temporary-token', description: '创建邮箱时返回，只能操作它绑定的一个临时邮箱。' }
		},
		schemas: {
			ErrorResponse: error,
			Inbox: { type: 'object', required: ['id', 'address', 'mode', 'domain', 'expiresAt', 'isActive', 'createdAt'], properties: { id: { type: 'string' }, address: { type: 'string', format: 'email' }, mode: { type: 'string', enum: ['fixed', 'wildcard'] }, domain: { type: 'string' }, subdomain: { type: 'string' }, inboxType: { const: 'temp' }, source: { const: 'api' }, expiresAt: { type: 'string', format: 'date-time' }, isActive: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, messageCount: { type: 'integer', minimum: 0 } } },
			CreateAccountRequest: { type: 'object', properties: { localPart: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,62}$', description: '邮箱 @ 前缀；省略时随机生成' }, domain: { type: 'string', description: '已启用的 API 根域名；省略时使用第一个可用域名' } } },
			CreateWildcardAccountRequest: { type: 'object', properties: { localPart: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,62}$' }, domain: { type: 'string', description: '已启用且允许通配子域的根域名；省略时使用第一个可用通配域名' }, subdomain: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,61}$', description: '子域；省略时随机生成' } } },
			CreateAccountResponse: { allOf: [{ $ref: '#/components/schemas/Inbox' }, { type: 'object', required: ['token'], properties: { token: { type: 'string', description: '仅在创建响应中返回的临时 Bearer Token' } } }] },
			TokenResponse: { type: 'object', required: ['id', 'address', 'token'], properties: { id: { type: 'string' }, address: { type: 'string', format: 'email' }, token: { type: 'string' } } },
			Recipient: { type: 'object', properties: { name: { type: 'string' }, address: { type: 'string', format: 'email' } } },
			MessageSummary: { type: 'object', required: ['id', 'inboxId', 'from', 'to', 'subject', 'seen', 'starred', 'createdAt'], properties: { id: { type: 'string' }, inbox_id: { type: 'string' }, inboxId: { type: 'string' }, from: { $ref: '#/components/schemas/Recipient' }, to: { type: 'array', items: { $ref: '#/components/schemas/Recipient' } }, subject: { type: 'string' }, seen: { type: 'boolean' }, starred: { type: 'boolean' }, hasAttachments: { type: 'boolean' }, size: { type: 'integer', minimum: 0 }, createdAt: { type: 'string', format: 'date-time' } } },
			Attachment: { type: 'object', required: ['id', 'filename', 'contentType', 'size', 'downloadUrl'], properties: { id: { type: 'string' }, filename: { type: 'string' }, contentType: { type: 'string' }, size: { type: 'integer', minimum: 0 }, disposition: { type: 'string' }, contentId: { type: ['string', 'null'] }, downloadUrl: { type: 'string' } } },
			MessageDetail: { allOf: [{ $ref: '#/components/schemas/MessageSummary' }, { type: 'object', required: ['text', 'html', 'attachments'], properties: { text: { type: 'string' }, html: { type: 'array', items: { type: 'string' } }, verificationCode: { type: ['string', 'null'] }, attachments: { type: 'array', items: { $ref: '#/components/schemas/Attachment' } } } }] },
			MessageList: { type: 'object', required: ['messages', 'total', 'unreadCount'], properties: { messages: { type: 'array', items: { $ref: '#/components/schemas/MessageSummary' } }, total: { type: 'integer', minimum: 0 }, unreadCount: { type: 'integer', minimum: 0 }, nextCursor: { type: 'string' } } },
			MessageUpdateRequest: { type: 'object', minProperties: 1, properties: { seen: { type: 'boolean' }, starred: { type: 'boolean' } }, additionalProperties: false },
			MessageUpdateResponse: { type: 'object', required: ['id', 'seen', 'starred'], properties: { id: { type: 'string' }, seen: { type: 'boolean' }, starred: { type: 'boolean' } } },
			MarkReadResponse: { type: 'object', required: ['mailbox', 'updated', 'alreadySeen', 'total'], properties: { mailbox: { type: 'string', format: 'email' }, updated: { type: 'integer' }, alreadySeen: { type: 'integer' }, total: { type: 'integer' } } }
		}
	},
	paths: {
		'/accounts': { post: { tags: ['账户'], operationId: 'createAccount', summary: '创建固定临时邮箱', description: '需要 API Key 与 inboxes:write。邮箱有效期为 24 小时。', security: [{ ApiKey: [] }], 'x-required-scope': 'inboxes:write', requestBody: { required: false, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateAccountRequest' }, example: { localPart: 'demo', domain: 'example.com' } } } }, responses: { 201: response('创建成功', success({ $ref: '#/components/schemas/CreateAccountResponse' })), 400: response('参数或域名无效', error), 401: response('API Key 无效', error), 403: response('API 未启用或 scope 不足', error), 409: response('地址已存在', error) } } },
		'/accounts/wildcard': { post: { tags: ['账户'], operationId: 'createWildcardAccount', summary: '创建通配子域临时邮箱', description: '需要 API Key 与 inboxes:write。域名必须在通配域白名单中。', security: [{ ApiKey: [] }], 'x-required-scope': 'inboxes:write', requestBody: { required: false, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateWildcardAccountRequest' }, example: { localPart: 'demo', domain: 'example.com', subdomain: 'client' } } } }, responses: { 201: response('创建成功', success({ $ref: '#/components/schemas/CreateAccountResponse' })), 400: response('参数或通配域无效', error), 401: response('API Key 无效', error), 403: response('API 未启用或 scope 不足', error), 409: response('地址已存在', error) } } },
		'/accounts/me': { get: { tags: ['账户'], operationId: 'getCurrentAccount', summary: '读取当前临时 Token 绑定的邮箱', security: [{ TempToken: [] }], responses: { 200: response('邮箱详情', success({ $ref: '#/components/schemas/Inbox' })), 401: response('临时 Token 无效或过期', error), 404: response('邮箱已删除或过期', error) } } },
		'/accounts/{id}': { delete: { tags: ['账户'], operationId: 'deleteAccount', summary: '删除临时邮箱', description: 'API Key 需要 inboxes:write；临时 Token 只能删除其绑定邮箱。成功时没有响应 body。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'inboxes:write (仅 API Key)', parameters: [idParameter], responses: { 204: response('删除成功'), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮箱不存在、已过期或无权访问', error) } } },
		'/inboxes/{id}': { get: { tags: ['账户'], operationId: 'getInbox', summary: '按 ID 读取临时邮箱', description: 'API Key 需要 inboxes:read；临时 Token 只能读取其绑定邮箱。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'inboxes:read (仅 API Key)', parameters: [idParameter], responses: { 200: response('邮箱详情', success({ $ref: '#/components/schemas/Inbox' })), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮箱不存在、已过期或无权访问', error) } } },
		'/inboxes/{id}/messages': { get: { tags: ['邮件'], operationId: 'listInboxMessages', summary: '按邮箱 ID 列出邮件', description: 'API Key 需要 messages:read；临时 Token 只能读取其绑定邮箱。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'messages:read (仅 API Key)', parameters: [idParameter, ...listParameters], responses: { 200: response('邮件列表', success({ $ref: '#/components/schemas/MessageList' })), 400: response('筛选或分页参数无效', error), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮箱不存在、已过期或无权访问', error) } } },
		'/token': { post: { tags: ['账户'], operationId: 'refreshToken', summary: '刷新临时 Token', description: '仅临时 Token 可调用。必须通过 query address 或 JSON body address 提供它绑定的邮箱地址。', security: [{ TempToken: [] }], parameters: [{ ...addressParameter, required: false }], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', required: ['address'], properties: { address: { type: 'string', format: 'email' } } } } } }, responses: { 200: response('新 Token', success({ $ref: '#/components/schemas/TokenResponse' })), 401: response('临时 Token 无效或过期', error), 404: response('地址不匹配、邮箱不存在或已过期', error) } } },
		'/messages': { get: { tags: ['邮件'], operationId: 'listMessages', summary: '按地址列出邮件', description: 'API Key 必须携带 address 且需要 messages:read；临时 Token 可省略 address。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'messages:read (仅 API Key)', parameters: [addressParameter, ...listParameters], responses: { 200: response('邮件列表', success({ $ref: '#/components/schemas/MessageList' })), 400: response('地址、筛选或分页参数无效', error), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮箱不存在、已过期或无权访问', error) } } },
		'/messages/next': { get: { tags: ['邮件'], operationId: 'getNextMessage', summary: '读取下一封未读邮件', description: 'API Key 需要 messages:write；wait 为 0–30 的整数。没有未读邮件时返回 204。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'messages:write (仅 API Key)', parameters: [addressParameter, { name: 'wait', in: 'query', description: '保留参数，范围 0–30', schema: { type: 'integer', minimum: 0, maximum: 30, default: 0 } }], responses: { 200: response('下一封邮件及邮箱地址', success({ type: 'object', properties: { message: { $ref: '#/components/schemas/MessageDetail' }, inboxAddress: { type: 'string', format: 'email' } } })), 204: response('没有未读邮件'), 400: response('地址或 wait 参数无效', error), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮箱不存在、已过期或无权访问', error) } } },
		'/messages/mark-read': { post: { tags: ['邮件'], operationId: 'markMessagesRead', summary: '将邮箱内全部邮件标为已读', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'messages:write (仅 API Key)', parameters: [addressParameter], responses: { 200: response('已读统计', success({ $ref: '#/components/schemas/MarkReadResponse' })), 400: response('地址无效', error), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮箱不存在、已过期或无权访问', error) } } },
		'/messages/{id}': { get: { tags: ['邮件'], operationId: 'getMessage', summary: '读取单封邮件详情', description: 'API Key 必须携带 address 且需要 messages:read；临时 Token 可省略 address。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'messages:read (仅 API Key)', parameters: [messageIdParameter, addressParameter], responses: { 200: response('邮件详情', success({ $ref: '#/components/schemas/MessageDetail' })), 400: response('地址或邮件 ID 无效', error), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮件不存在或无权访问', error) } }, patch: { tags: ['邮件'], operationId: 'updateMessage', summary: '更新邮件已读或星标状态', description: 'API Key 必须携带 address 且需要 messages:write；请求体至少含 seen 或 starred 之一。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'messages:write (仅 API Key)', parameters: [messageIdParameter, addressParameter], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageUpdateRequest' }, example: { seen: true, starred: false } } } }, responses: { 200: response('更新后的状态', success({ $ref: '#/components/schemas/MessageUpdateResponse' })), 400: response('地址、邮件 ID 或请求体无效', error), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮件不存在或无权访问', error) } }, delete: { tags: ['邮件'], operationId: 'deleteMessage', summary: '删除单封邮件', description: 'API Key 必须携带 address 且需要 messages:write。成功时没有响应 body。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'messages:write (仅 API Key)', parameters: [messageIdParameter, addressParameter], responses: { 204: response('删除成功'), 400: response('地址或邮件 ID 无效', error), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮件不存在或无权访问', error) } } },
		'/sources/{id}': { get: { tags: ['邮件'], operationId: 'getMessageSource', summary: '读取原始 RFC 822 邮件', description: 'API Key 必须携带 address 且需要 messages:read；临时 Token 可省略 address。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'messages:read (仅 API Key)', parameters: [messageIdParameter, addressParameter], responses: { 200: response('原始信件', success({ type: 'object', required: ['id', 'data'], properties: { id: { type: 'string' }, data: { type: 'string' } } })), 400: response('地址或邮件 ID 无效', error), 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('邮件不存在或无权访问', error) } } },
		'/messages/{id}/attachments/{attachmentId}': { get: { tags: ['邮件'], operationId: 'downloadAttachment', summary: '下载邮件附件', description: 'API Key 需要 messages:read。临时 Token 可通过 Authorization header，或使用邮件详情中带 token 的 downloadUrl。', security: [{ ApiKey: [] }, { TempToken: [] }], 'x-required-scope': 'messages:read (仅 API Key)', parameters: [messageIdParameter, attachmentIdParameter], responses: { 200: { description: '附件二进制内容', content: { '*/*': { schema: { type: 'string', format: 'binary' } } } }, 401: response('认证失败', error), 403: response('scope 不足', error), 404: response('附件不存在或无权访问', error) } } }
	}
};

const errorCodes = [
	['api_disabled', 'API is disabled', 'API 功能未启用'],
	['token_invalid_or_expired', 'Invalid or expired token', 'API Key 或临时 Token 无效或已过期'],
	['scope_forbidden', 'API key scope is insufficient', 'API Key 权限范围不足'],
	['local_part_invalid', 'API inbox local part is invalid', '邮箱前缀格式无效'],
	['address_local_part_mismatch', 'Address and localPart do not match', 'address 与 localPart 不一致'],
	['address_domain_mismatch', 'Address domain does not match domain', 'address 与 domain 不一致'],
	['address_already_in_use', 'Address is already in use', '邮箱地址已被使用'],
	['domain_not_available', 'Domain is not available', '域名不可用或未启用'],
	['subdomain_invalid', 'Subdomain is invalid', '子域格式无效'],
	['address_required', 'Address is required', '缺少 address'],
	['address_invalid_or_missing', 'Address is invalid or unavailable', 'address 无效或不可用'],
	['account_not_found', 'Temporary account not found', '临时邮箱不存在、已过期或无权访问'],
	['message_not_found', 'Message not found', '邮件不存在或无权访问'],
	['attachment_not_found', 'Attachment not found', '附件不存在或无权访问'],
	['invalid_message_update', 'Message update is invalid', '邮件更新请求无效'],
	['invalid_message_query', 'Message query is invalid', '邮件查询参数无效'],
	['internal_error', 'Internal server error', '服务器内部错误']
].map(([code, en, zh]) => ({ code, en, zh }));

const llms = `# Cloud Mail 临时邮箱 API

- OpenAPI JSON：\`GET /v1/openapi.json\`
- OpenAPI YAML：\`GET /v1/openapi.yaml\`
- 错误码：\`GET /v1/error-codes\`
- Base URL：\`/v1\`

## 认证

所有业务接口要求先在 Cloud Mail 网页创建 API Key，且管理员已启用 API 功能。

- API Key：\`X-API-Key: AC-...\`。每个 API Key 只可访问它创建的临时邮箱，并需要对应 scope。
- 临时 Token：\`Authorization: Bearer <token>\`。由创建邮箱响应返回，只能访问绑定的单个邮箱；到期时间与邮箱相同。

API Key scopes：\`inboxes:read\`、\`inboxes:write\`、\`messages:read\`、\`messages:write\`。临时 Token 不检查 scope，但始终限制为自身邮箱。

## 统一响应
JSON 成功响应：\`{"success":true,"data":...}\`。JSON 失败响应：\`{"success":false,"error":"...","errorCode":"..."}\`。删除成功及“下一封未读邮件不存在”使用 HTTP 204，响应 body 为空，不得调用 JSON 解析。

## 典型流程


1. 使用有 \`inboxes:write\` 的 API Key 调用 \`POST /accounts\` 创建邮箱，保存返回的 \`id\`、\`address\` 与 \`token\`。
2. 使用 API Key 查询邮件时，调用 \`GET /messages?address=<address>\`；API Key 模式下 \`address\` 必填。
3. 或使用返回的临时 Token 查询同一邮箱，调用 \`GET /messages\`，此时 \`address\` 可省略。
4. 使用 \`GET /messages/{id}\` 获取正文和附件；附件下载 URL 已在详情响应中返回。
5. 到期、删除或无权访问的邮箱/邮件返回 404；邮箱在创建后 24 小时到期。

## 业务接口

### 账户

- \`POST /accounts\`：API Key + \`inboxes:write\`；创建固定地址。body 可含 \`localPart\`（省略时随机）和 \`domain\`（省略时使用第一个已启用域名）。成功返回邮箱和一次性显示的临时 \`token\`。
- \`POST /accounts/wildcard\`：API Key + \`inboxes:write\`；创建通配子域地址。body 可含 \`localPart\`、\`domain\`、\`subdomain\`；domain 必须是允许通配的已启用根域名。
- \`GET /accounts/me\`：临时 Token；返回该 Token 绑定邮箱。
- \`DELETE /accounts/{id}\`：API Key + \`inboxes:write\`，或该邮箱的临时 Token；删除邮箱、邮件、附件和 Token，成功 204。
- \`GET /inboxes/{id}\`：API Key + \`inboxes:read\`，或该邮箱的临时 Token；返回邮箱详情。
- \`POST /token\`：临时 Token；通过 query 或 JSON body 的 \`address\` 提供绑定邮箱地址，返回新 Token。

### 邮件

- \`GET /inboxes/{id}/messages\`：按邮箱 ID 列表。API Key 需要 \`messages:read\`；临时 Token 只能访问自身邮箱。
- \`GET /messages\`：按 \`address\` 列表；API Key 需要 \`messages:read\` 且 address 必填。
- \`GET /messages/next\`：读取并标记下一封未读邮件；API Key 需要 \`messages:write\`；无未读邮件返回 204。\`wait\` 仅接受 0–30 的整数。
- \`POST /messages/mark-read\`：将一个邮箱所有邮件标为已读；API Key 需要 \`messages:write\`。
- \`GET /messages/{id}\`：读取单封邮件；API Key 需要 \`messages:read\`。
- \`PATCH /messages/{id}\`：更新 \`seen\` 和/或 \`starred\` 布尔状态；API Key 需要 \`messages:write\`。
- \`DELETE /messages/{id}\`：删除单封邮件；API Key 需要 \`messages:write\`，成功 204。
- \`GET /sources/{id}\`：读取 RFC 822 原始信件；API Key 需要 \`messages:read\`。
- \`GET /messages/{id}/attachments/{attachmentId}\`：下载附件；API Key 需要 \`messages:read\`。临时 Token 可使用 Authorization header，或直接使用邮件详情给出的带 token downloadUrl。

邮件列表共用 query：\`limit\` 1–100（默认 50）、\`offset\`（默认 0）、\`seen=true|false\`、\`since=<ISO 8601>\`、\`q=<搜索词>\`、\`after_id=<邮件 ID>\`。当使用 after_id 时，它是游标且 offset 被忽略；有更多结果时响应给出 \`nextCursor\`。

## Python 最小示例

\`\`\`python
import requests

BASE = "https://mail.example.com/v1"
KEY = "AC_your_api_key"
headers = {"X-API-Key": KEY}

created = requests.post(
    f"{BASE}/accounts",
    headers={**headers, "Content-Type": "application/json"},
    json={"localPart": "demo", "domain": "example.com"},
    timeout=15,
)
created.raise_for_status()
payload = created.json()
if not payload["success"]:
    raise RuntimeError(payload["errorCode"])
account = payload["data"]

listed = requests.get(
    f"{BASE}/messages",
    headers=headers,
    params={"address": account["address"], "limit": 50},
    timeout=15,
)
listed.raise_for_status()
messages = listed.json()["data"]["messages"]
\`\`\`

不要调用 /api/tempInbox/*：它们是网页登录态管理接口，不属于对外 API。`;

function yamlScalar(value) {
	if (typeof value === 'string') return JSON.stringify(value);
	if (value === null) return 'null';
	return String(value);
}

function yaml(value, indent = 0) {
	const pad = ' '.repeat(indent);
	if (Array.isArray(value)) return value.map(item => {
		if (item && typeof item === 'object') return `${pad}-\n${yaml(item, indent + 2)}`;
		return `${pad}- ${yamlScalar(item)}`;
	}).join('\n');
	const entries = Object.entries(value);
	if (!entries.length) return `${pad}{}`;
	return entries.map(([key, item]) => {
		const yamlKey = JSON.stringify(key);
		if (item && typeof item === 'object') return `${pad}${yamlKey}:\n${yaml(item, indent + 2)}`;
		return `${pad}${yamlKey}: ${yamlScalar(item)}`;
	}).join('\n');
}

function apiError(c, caught) {
	if (caught instanceof BizError) {
		const codes = {
			'API is disabled': 'api_disabled',
			'API inbox local part is invalid': 'local_part_invalid',
			'API inbox address already exists': 'address_already_in_use',
			'API domain is not allowed': 'domain_not_available',
			'Wildcard API domain is not allowed': 'domain_not_available',
			'API inbox subdomain is invalid': 'subdomain_invalid',
			'Address and localPart do not match': 'address_local_part_mismatch',
			'Address domain does not match domain': 'address_domain_mismatch',
			'Inbox not found': 'account_not_found',
			'Message not found': 'message_not_found',
			'Attachment not found': 'attachment_not_found',
			'Message update is invalid': 'invalid_message_update',
			'Message limit is invalid': 'invalid_message_query',
			'Address is required': 'address_required',
			'Address is invalid or unavailable': 'address_invalid_or_missing'
		};
		return apiResponse.fail(c, caught.code, codes[caught.message] || (caught.code === 403 ? 'scope_forbidden' : 'invalid_request'), caught.message);
	}
	console.error(caught);
	return apiResponse.fail(c, 500, 'internal_error', 'Internal server error');
}

function principal(c) { return c.get('apiPrincipal'); }
function requireScope(c, scope) { return principal(c).kind === 'apiKey' && !principal(c).scopes.includes(scope) ? apiResponse.fail(c, 403, 'scope_forbidden', 'API key scope is insufficient') : null; }
function apiHandler(handler) { return async c => { try { const response = await handler(c); if (principal(c)?.kind === 'apiKey' && response.status < 400) await apiUsageService.recordSuccess(c, principal(c).apiKeyId); return response; } catch (caught) { return apiError(c, caught); } }; }
async function requestBody(c) { try { return await c.req.json(); } catch { return {}; } }

function domains(setting) {
	return {
		apiDomains: (setting.apiDomains || []).map(domain => domain.toLowerCase()),
		wildcardDomains: (setting.apiWildcardDomains || []).map(domain => domain.toLowerCase())
	};
}

async function requireInboxForPrincipal(c, address) {
	const actor = principal(c);
	if (actor.kind === 'tempToken') {
		if (address && address.toLowerCase() !== actor.inbox.address.toLowerCase()) throw new BizError('Inbox not found', 404);
		return await tempInboxService.requireActiveInbox(c, actor.inbox.tempInboxId);
	}
	if (!address) throw new BizError('Address is required', 400);
	if (!/^[^@\s]+@[^@\s]+$/.test(address)) throw new BizError('Address is invalid or unavailable', 400);
	const inbox = await orm(c).select().from(tempInbox).where(and(sql`${tempInbox.address} COLLATE NOCASE = ${address}`, eq(tempInbox.apiKeyId, actor.apiKeyId), isNull(tempInbox.deletedAt))).get();
	if (!inbox) throw new BizError('Inbox not found', 404);
	return await tempInboxService.requireActiveInbox(c, inbox.tempInboxId);
}

async function requireInboxId(c, id) {
	const inbox = await tempInboxService.requireActiveInbox(c, id);
	const actor = principal(c);
	if ((actor.kind === 'apiKey' && inbox.apiKeyId !== actor.apiKeyId) || (actor.kind === 'tempToken' && inbox.tempInboxId !== actor.inbox.tempInboxId)) throw new BizError('Inbox not found', 404);
	return inbox;
}

app.get('/v1/openapi.json', c => c.json(docs));
app.get('/v1/openapi.yaml', c => c.text(yaml(docs), 200, { 'Content-Type': 'application/yaml; charset=utf-8' }));
app.get('/v1/llms.txt', c => c.text(llms, 200, { 'Content-Type': 'text/markdown; charset=utf-8' }));
app.get('/v1/error-codes', c => c.json({ errorCodes }));

async function createAccount(c, forceWildcard = false) {
	const denied = requireScope(c, 'inboxes:write');
	if (denied) return denied;
	const setting = await settingService.query(c);
	const config = domains(setting);
	const inbox = await tempInboxService.createCompatible(c, principal(c), await requestBody(c), config.apiDomains, config.wildcardDomains, forceWildcard);
	return apiResponse.ok(c, { ...tempInboxService.toApiInbox(inbox), token: await tempTokenService.issue(c, inbox) }, 201);
}

app.post('/v1/accounts', apiHandler(c => createAccount(c)));
app.post('/v1/accounts/wildcard', apiHandler(c => createAccount(c, true)));
app.post('/v1/token', apiHandler(async c => {
	if (principal(c).kind !== 'tempToken') return apiResponse.fail(c, 401, 'token_invalid_or_expired', 'Invalid or expired token');
	const body = await requestBody(c);
	const data = await tempTokenService.refresh(c, principal(c), c.req.query('address') || body.address);
	if (!data) throw new BizError('Inbox not found', 404);
	return apiResponse.ok(c, data);
}));
app.get('/v1/accounts/me', apiHandler(async c => {
	if (principal(c).kind !== 'tempToken') return apiResponse.fail(c, 401, 'token_invalid_or_expired', 'Invalid or expired token');
	return apiResponse.ok(c, await tempInboxService.detail(c, await tempInboxService.requireActiveInbox(c, principal(c).inbox.tempInboxId)));
}));
app.delete('/v1/accounts/:id', apiHandler(async c => {
	const denied = requireScope(c, 'inboxes:write');
	if (denied) return denied;
	await tempInboxService.deleteInbox(c, await requireInboxId(c, c.req.param('id')));
	return apiResponse.noContent(c);
}));
app.get('/v1/inboxes/:id', apiHandler(async c => {
	const denied = requireScope(c, 'inboxes:read');
	if (denied) return denied;
	return apiResponse.ok(c, await tempInboxService.detail(c, await requireInboxId(c, c.req.param('id'))));
}));

async function listMessages(c, inbox) {
	const denied = requireScope(c, 'messages:read');
	if (denied) return denied;
	return apiResponse.ok(c, await tempMessageService.list(c, inbox, c.req.query()));
}

app.get('/v1/inboxes/:id/messages', apiHandler(async c => listMessages(c, await requireInboxId(c, c.req.param('id')))));
app.get('/v1/messages', apiHandler(async c => listMessages(c, await requireInboxForPrincipal(c, c.req.query('address')))));
app.get('/v1/messages/next', apiHandler(async c => {
	const denied = requireScope(c, 'messages:write');
	if (denied) return denied;
	const wait = Number(c.req.query('wait') || 0);
	if (!Number.isInteger(wait) || wait < 0 || wait > 30) throw new BizError('Message limit is invalid', 400);
	const inbox = await requireInboxForPrincipal(c, c.req.query('address'));
	const row = await tempMessageService.next(c, inbox);
	return row ? apiResponse.ok(c, { message: await tempMessageService.detail(c, row, principal(c).kind === 'tempToken' ? principal(c).token : null), inboxAddress: inbox.address }) : apiResponse.noContent(c);
}));
app.post('/v1/messages/mark-read', apiHandler(async c => {
	const denied = requireScope(c, 'messages:write');
	if (denied) return denied;
	return apiResponse.ok(c, await tempMessageService.markRead(c, await requireInboxForPrincipal(c, c.req.query('address'))));
}));

async function messageRow(c, scope) {
	const denied = requireScope(c, scope);
	if (denied) return [null, denied];
	const inbox = await requireInboxForPrincipal(c, c.req.query('address'));
	return [await tempMessageService.requireMessage(c, inbox, Number(c.req.param('id'))), null];
}

app.get('/v1/messages/:id', apiHandler(async c => {
	const [row, denied] = await messageRow(c, 'messages:read');
	return denied || apiResponse.ok(c, await tempMessageService.detail(c, row, principal(c).kind === 'tempToken' ? principal(c).token : null));
}));
app.patch('/v1/messages/:id', apiHandler(async c => {
	const [row, denied] = await messageRow(c, 'messages:write');
	return denied || apiResponse.ok(c, await tempMessageService.update(c, row, await requestBody(c)));
}));
app.delete('/v1/messages/:id', apiHandler(async c => {
	const [row, denied] = await messageRow(c, 'messages:write');
	if (denied) return denied;
	await tempMessageService.delete(c, row);
	return apiResponse.noContent(c);
}));
app.get('/v1/sources/:id', apiHandler(async c => {
	const [row, denied] = await messageRow(c, 'messages:read');
	return denied || apiResponse.ok(c, { id: String(row.message.tempMessageId), data: row.message.rawSource || '' });
}));
app.get('/v1/messages/:id/attachments/:attachmentId', apiHandler(async c => {
	const denied = requireScope(c, 'messages:read');
	if (denied) return denied;
	const row = await tempMessageService.requireForPrincipal(c, principal(c), Number(c.req.param('id')));
	const attachment = await tempMessageService.attachment(c, row, Number(c.req.param('attachmentId')));
	const object = await r2Service.getObj(c, attachment.key);
	if (!object?.body) return apiResponse.fail(c, 404, 'attachment_not_found', 'Attachment not found');
	return new Response(object.body, { headers: { 'Content-Type': attachment.mimeType || object.httpMetadata?.contentType || 'application/octet-stream', 'Content-Disposition': attachment.disposition || object.httpMetadata?.contentDisposition || `attachment;filename=${attachment.filename || ''}` } });
}));
