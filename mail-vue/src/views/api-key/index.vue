<template>
  <div class="api-keys">
    <div class="toolbar">
      <div>
        <h2>{{ $t('apiKeys') }}</h2>
        <p>{{ $t('apiKeySecretWarning') }}</p>
      </div>
      <div class="toolbar-actions">
        <el-button @click="openGuide">{{ $t('apiUsageGuide') }}</el-button>
        <el-button type="primary" @click="openCreate">{{ $t('createApiKey') }}</el-button>
      </div>
    </div>

    <el-table :data="keys" v-loading="loading" empty-text="No API keys">
      <el-table-column prop="name" :label="$t('apiKeyName')" min-width="160" />
      <el-table-column prop="prefix" label="Prefix" min-width="110" />
      <el-table-column :label="$t('apiScopes')" min-width="260">
        <template #default="{ row }"><el-tag v-for="scope in row.scopes" :key="scope" class="scope">{{ scopeLabel(scope) }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="createTime" :label="$t('date')" min-width="180" />
      <el-table-column prop="todayCalls" :label="$t('apiKeyTodayCalls')" width="110" />
      <el-table-column prop="last30DaysCalls" :label="$t('apiKeyLast30DaysCalls')" width="130" />
      <el-table-column :label="$t('action')" width="92"><template #default="{ row }"><div class="table-actions"><el-tooltip :content="$t('copy')" placement="top"><el-button link @click="copyKeyPrefix(row)"><Icon icon="fluent:copy-20-regular" width="18" height="18" /></el-button></el-tooltip><el-tooltip :content="$t('deleteApiKey')" placement="top"><el-button type="danger" link @click="deleteKey(row)"><Icon icon="uiw:delete" width="16" height="18" /></el-button></el-tooltip></div></template></el-table-column>
    </el-table>

    <el-dialog v-model="createVisible" :title="$t('createApiKey')" width="420" @closed="resetCreate">
      <el-form label-position="top">
        <el-form-item :label="$t('apiKeyName')" required><el-input v-model="form.name" maxlength="64" /></el-form-item>
        <el-form-item :label="$t('apiScopes')" required><el-checkbox-group v-model="form.scopes"><el-checkbox v-for="scope in scopes" :key="scope.value" :value="scope.value">{{ scope.label }}</el-checkbox></el-checkbox-group></el-form-item>
      </el-form>
      <template #footer><el-button @click="createVisible = false">{{ $t('cancel') }}</el-button><el-button type="primary" :loading="creating" @click="create">{{ $t('createApiKey') }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="secretVisible" :title="$t('apiKeys')" width="460" @closed="secret = ''">
      <el-alert :title="$t('apiKeySecretWarning')" type="warning" :closable="false" />
      <el-input class="secret" :model-value="secret" readonly><template #append><el-button :disabled="!secret" @click="copySecret">{{ $t('copy') }}</el-button></template></el-input>
    </el-dialog>

    <el-dialog v-model="guideVisible" :title="$t('apiUsageGuide')" width="960" class="guide-dialog">
      <el-scrollbar class="guide-document" max-height="65vh">
        <article class="guide-shell">
          <header class="guide-hero">
            <h1>API Documentation</h1>
            <div class="guide-badges"><span class="guide-badge sections">5 sections</span><span class="guide-badge updated">Last updated: 2026-08-03</span><span class="guide-badge copy">Static preview</span></div>
            <p class="guide-lead">Cloud Mail 提供用于临时邮箱自动化的 RESTful API。本页按五个主题组织可用接口；所有业务接口均以 <code>/v1</code> 为前缀。此页面仅为静态文档预览，不会修改现有 API 行为。</p>
          </header>

          <div class="guide-layout">
            <aside class="guide-sidebar"><div class="contents-title">Contents</div><nav><a href="#quick-start">快速开始</a><a href="#temporary-inbox">临时邮箱</a><a href="#messages">消息管理</a><a href="#ai-llm">AI / LLM</a><a href="#errors">错误处理</a></nav></aside>
            <main>
              <section id="quick-start">
                <div class="section-title"><span class="number">1</span><h2>快速开始</h2></div>
                <div class="section-body">
                  <p>管理员需先启用临时邮箱 API 并配置 API 域名。随后在 Cloud Mail 网页创建 API Key，并在每个请求中提供相应认证信息。</p>
                  <h3>Quick Start</h3><ol><li>在网页 API Key 管理中创建带所需 scope 的 API Key。</li><li>使用 <code>POST /v1/accounts</code> 创建临时邮箱并保存返回的 <code>id</code>、<code>address</code> 与 <code>token</code>。</li><li>用 API Key 加 <code>address</code>，或用该邮箱的临时 Token，读取邮件。</li></ol>
                  <div class="label">示例</div><div class="code-box has-dots" data-language="bash"><span class="dots"><i></i><i></i><i></i></span><pre>{{ quickStartExample }}</pre></div>
                  <h3>Base URL</h3><div class="code-box has-dots" data-language="text"><span class="dots"><i></i><i></i><i></i></span><pre>{{ apiBase() }}</pre></div>
                  <h3>认证方式</h3><table class="spec-table"><thead><tr><th>方式</th><th>请求头</th><th>范围</th></tr></thead><tbody><tr><td>API Key</td><td><code>X-API-Key: AC-...</code></td><td>仅可访问该 Key 创建的邮箱，且受 scope 限制。</td></tr><tr><td>临时 Token</td><td><code>Authorization: Bearer &lt;token&gt;</code></td><td>仅可操作绑定邮箱，到期时间与邮箱相同。</td></tr></tbody></table>
                </div>
              </section>

              <section v-for="(section, sectionIndex) in guideSections" :id="section.id" :key="section.id">
                <div class="section-title"><span class="number">{{ sectionIndex + 2 }}</span><h2>{{ section.title }}</h2></div>
                <div class="section-body">
                  <p>{{ section.intro }}</p>
                  <article v-for="endpoint in section.endpoints" :key="`${endpoint.method} ${endpoint.path}`" class="endpoint">
                    <div class="endpoint-head"><span class="method" :class="endpoint.method.toLowerCase()">{{ endpoint.method }}</span><span class="path">{{ endpoint.path }}</span></div>
                    <p>{{ endpoint.description }}</p>
                    <div class="label">请求参数</div>
                    <table v-if="endpoint.parameters" class="spec-table"><thead><tr><th>位置</th><th>参数</th><th>必填</th><th>说明</th></tr></thead><tbody><tr v-for="parameter in endpoint.parameters" :key="`${parameter.location}-${parameter.name}`"><td>{{ parameter.location }}</td><td><code>{{ parameter.name }}</code></td><td>{{ parameter.required }}</td><td>{{ parameter.description }}</td></tr></tbody></table>
                    <div v-else class="note">{{ endpoint.parameterNote }}</div>
                    <div class="label">响应 · {{ endpoint.response.status }}</div>
                    <div v-if="endpoint.response.body" class="code-box" :data-language="endpoint.response.language"><pre>{{ endpoint.response.body }}</pre></div>
                    <div v-else class="note">{{ endpoint.response.note }}</div>
                    <div v-if="endpoint.response.note && endpoint.response.body" class="note">{{ endpoint.response.note }}</div>
                    <div class="label">示例</div><div class="code-box has-dots" data-language="bash"><span class="dots"><i></i><i></i><i></i></span><pre>{{ endpoint.example }}</pre></div>
                  </article>
                </div>
              </section>

              <section id="errors">
                <div class="section-title"><span class="number">5</span><h2>错误处理</h2></div>
                <div class="section-body">
                  <p>成功 JSON 响应是 <code>{ "success": true, "data": ... }</code>。失败时使用统一 JSON 格式；删除成功和没有未读邮件时则返回空的 HTTP 204。</p>
                  <div class="label">错误响应</div><div class="code-box" data-language="json"><pre>{{ errorResponse }}</pre></div>
                  <h3>常见错误码</h3><table class="spec-table"><thead><tr><th>错误码</th><th>含义</th></tr></thead><tbody><tr><td><code>token_invalid_or_expired</code></td><td>API Key 或临时 Token 无效、已过期。</td></tr><tr><td><code>scope_forbidden</code></td><td>API Key 缺少接口所需 scope。</td></tr><tr><td><code>domain_not_available</code></td><td>域名未启用或不允许使用。</td></tr><tr><td><code>address_required</code></td><td>API Key 调用按地址的邮件接口时未提供 address。</td></tr><tr><td><code>account_not_found</code></td><td>邮箱不存在、已过期、已删除或无权访问。</td></tr><tr><td><code>message_not_found</code></td><td>邮件不存在或无权访问。</td></tr></tbody></table>
                  <div class="note">完整机器可读错误码列表：<code>GET /v1/error-codes</code>。</div>
                </div>
              </section>
            </main>
          </div>
        </article>
      </el-scrollbar>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { apiKeyCreate, apiKeyList, apiKeyDelete } from '@/request/api-key.js';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const scopes = computed(() => [
  { value: 'inboxes:read', label: t('apiScopeInboxesRead') },
  { value: 'inboxes:write', label: t('apiScopeInboxesWrite') },
  { value: 'messages:read', label: t('apiScopeMessagesRead') },
  { value: 'messages:write', label: t('apiScopeMessagesWrite') }
]);
const keys = ref([]);
const loading = ref(false);
const creating = ref(false);
const createVisible = ref(false);
const secretVisible = ref(false);
const guideVisible = ref(false);
const secret = ref('');
const form = reactive({ name: '', scopes: [] });

function apiBase() { return `${window.location.origin}/v1`; }
function scopeLabel(value) { return scopes.value.find(scope => scope.value === value)?.label || value; }
const quickStartExample = computed(() => `curl ${apiBase()}/accounts \\
  -X POST \\
  -H "X-API-Key: AC-your-key" \\
  -H "Content-Type: application/json" \\
  -d '{"localPart":"my-prefix","domain":"public.example.com"}'`);
const errorResponse = `{
  "success": false,
  "error": "Address is required",
  "errorCode": "address_required"
}`;

const guideSections = computed(() => [
  {
    id: 'temporary-inbox', title: '临时邮箱', intro: '每个接口均明确列出请求参数、成功响应和可直接运行的调用示例。所有响应均以 { "success": true, "data": ... } 包装，除非另有说明。', endpoints: [
      { method: 'POST', path: '/v1/accounts', description: '创建固定地址临时邮箱；API Key 需要 inboxes:write。', parameters: [{ location: 'Header', name: 'X-API-Key', required: '是', description: '具有 inboxes:write 的 API Key。' }, { location: 'Body', name: 'localPart', required: '否', description: '邮箱前缀；省略时随机生成。' }, { location: 'Body', name: 'domain', required: '否', description: '已启用 API 根域名；省略时使用第一个可用域名。' }], parameterNote: null, response: { status: '201', language: 'json', body: `{
  "success": true,
  "data": {
    "id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "address": "my-prefix@public.example.com",
    "mode": "fixed",
    "domain": "public.example.com",
    "subdomain": "",
    "inboxType": "temp",
    "source": "api",
    "expiresAt": "2026-08-04T12:00:00.000Z",
    "isActive": true,
    "createdAt": "2026-08-03T12:00:00.000Z",
    "token": "temporary-token"
  }
}`, note: null }, example: `curl ${apiBase()}/accounts \\
  -X POST -H "X-API-Key: AC-your-key" -H "Content-Type: application/json" \\
  -d '{"localPart":"my-prefix","domain":"public.example.com"}'` },
      { method: 'POST', path: '/v1/accounts/wildcard', description: '在启用的通配根域名下创建真实子域邮箱；API Key 需要 inboxes:write。', parameters: [{ location: 'Header', name: 'X-API-Key', required: '是', description: '具有 inboxes:write 的 API Key。' }, { location: 'Body', name: 'localPart', required: '否', description: '邮箱前缀；省略时随机生成。' }, { location: 'Body', name: 'domain', required: '否', description: '已启用且允许通配子域的根域名。' }, { location: 'Body', name: 'subdomain', required: '否', description: '子域标签；省略时随机生成。' }], parameterNote: null, response: { status: '201', language: 'json', body: `{
  "success": true,
  "data": {
    "id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "address": "my-prefix@team-a.public.example.com",
    "mode": "wildcard",
    "domain": "team-a.public.example.com",
    "subdomain": "team-a",
    "inboxType": "temp",
    "source": "api",
    "expiresAt": "2026-08-04T12:00:00.000Z",
    "isActive": true,
    "createdAt": "2026-08-03T12:00:00.000Z",
    "token": "temporary-token"
  }
}`, note: null }, example: `curl ${apiBase()}/accounts/wildcard \\
  -X POST -H "X-API-Key: AC-your-key" -H "Content-Type: application/json" \\
  -d '{"localPart":"my-prefix","domain":"public.example.com","subdomain":"team-a"}'` },
      { method: 'POST', path: '/v1/token', description: '用临时 Token 刷新同一邮箱的凭证。', parameters: [{ location: 'Header', name: 'Authorization', required: '是', description: 'Bearer <temporary-token>。' }, { location: 'Body 或 Query', name: 'address', required: '是', description: '必须是当前 Token 绑定的邮箱地址。' }], parameterNote: null, response: { status: '200', language: 'json', body: `{
  "success": true,
  "data": {
    "id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "address": "my-prefix@public.example.com",
    "token": "new-temporary-token"
  }
}`, note: null }, example: `curl ${apiBase()}/token -X POST \\
  -H "Authorization: Bearer temporary-token" -H "Content-Type: application/json" \\
  -d '{"address":"my-prefix@public.example.com"}'` },
      { method: 'GET', path: '/v1/accounts/me', description: '读取当前临时 Token 绑定邮箱及邮件数量。', parameters: null, parameterNote: '无 path、query 或 body 参数。请求头必须为 Authorization: Bearer <temporary-token>。', response: { status: '200', language: 'json', body: `{
  "success": true,
  "data": {
    "id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "address": "my-prefix@public.example.com",
    "mode": "fixed",
    "messageCount": 2,
    "expiresAt": "2026-08-04T12:00:00.000Z",
    "isActive": true
  }
}`, note: null }, example: `curl ${apiBase()}/accounts/me \\
  -H "Authorization: Bearer temporary-token"` },
      { method: 'GET', path: '/v1/inboxes/:id', description: '按 ID 读取邮箱。API Key 需要 inboxes:read；临时 Token 仅能读取自身。', parameters: [{ location: 'Path', name: 'id', required: '是', description: '32 位十六进制临时邮箱 ID。' }, { location: 'Header', name: 'X-API-Key 或 Authorization', required: '是', description: 'API Key 需要 inboxes:read；也可使用临时 Token。' }], parameterNote: null, response: { status: '200', language: 'json', body: `{
  "success": true,
  "data": {
    "id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "address": "my-prefix@public.example.com",
    "mode": "fixed",
    "messageCount": 2,
    "expiresAt": "2026-08-04T12:00:00.000Z",
    "isActive": true
  }
}`, note: null }, example: `curl ${apiBase()}/inboxes/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4 \\
  -H "X-API-Key: AC-your-key"` },
      { method: 'DELETE', path: '/v1/accounts/:id', description: '删除邮箱、邮件、附件和临时 Token。', parameters: [{ location: 'Path', name: 'id', required: '是', description: '32 位十六进制临时邮箱 ID。' }, { location: 'Header', name: 'X-API-Key 或 Authorization', required: '是', description: 'API Key 需要 inboxes:write；临时 Token 仅能删除自身。' }], parameterNote: null, response: { status: '204', language: 'text', body: null, note: '成功时没有响应 body；客户端不得调用 JSON 解析。' }, example: `curl ${apiBase()}/accounts/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4 \\
  -X DELETE -H "Authorization: Bearer temporary-token"` }
    ]
  },
  {
    id: 'messages', title: '消息管理', intro: 'API Key 调用需要在 query 中传 address 的接口会明确标注；临时 Token 可省略它，且始终仅操作绑定邮箱。', endpoints: [
      { method: 'GET', path: '/v1/inboxes/:id/messages', description: '按邮箱 ID 列出邮件。', parameters: [{ location: 'Path', name: 'id', required: '是', description: '临时邮箱 ID。' }, { location: 'Query', name: 'limit、offset', required: '否', description: 'limit 为 1–100，默认 50；offset 默认 0。' }, { location: 'Query', name: 'seen、since、q、after_id', required: '否', description: '已读、时间、搜索和游标筛选；after_id 会忽略 offset。' }], parameterNote: null, response: { status: '200', language: 'json', body: `{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "123",
        "inboxId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        "from": { "name": "Sender", "address": "sender@example.net" },
        "to": [{ "name": "my-prefix", "address": "my-prefix@public.example.com" }],
        "subject": "Verification code",
        "seen": false,
        "starred": false,
        "hasAttachments": false,
        "size": 1024,
        "createdAt": "2026-08-03T12:00:00.000Z"
      }
    ],
    "total": 1,
    "unreadCount": 1
  }
}`, note: null }, example: `curl '${apiBase()}/inboxes/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4/messages?seen=false&limit=20' \\
  -H 'Authorization: Bearer temporary-token'` },
      { method: 'GET', path: '/v1/messages', description: '按邮箱地址列出邮件。', parameters: [{ location: 'Query', name: 'address', required: 'API Key 是', description: '目标邮箱地址；临时 Token 可省略。' }, { location: 'Query', name: 'limit、offset、seen、since、q、after_id', required: '否', description: '与按 ID 列表相同的分页与筛选参数。' }], parameterNote: null, response: { status: '200', language: 'json', body: `{
  "success": true,
  "data": {
    "messages": [{ "id": "123", "subject": "Verification code", "seen": false, "starred": false }],
    "total": 1,
    "unreadCount": 1,
    "nextCursor": "123"
  }
}`, note: null }, example: `curl '${apiBase()}/messages?address=my-prefix@public.example.com&limit=50' \\
  -H 'X-API-Key: AC-your-key'` },
      { method: 'GET', path: '/v1/messages/next', description: '读取并标记最早的一封未读邮件。', parameters: [{ location: 'Query', name: 'address', required: 'API Key 是', description: '目标邮箱地址；临时 Token 可省略。' }, { location: 'Query', name: 'wait', required: '否', description: '0–30 的整数，默认 0；当前为保留参数。' }], parameterNote: null, response: { status: '200 / 204', language: 'json', body: `{
  "success": true,
  "data": {
    "inboxAddress": "my-prefix@public.example.com",
    "message": {
      "id": "123",
      "subject": "Verification code",
      "seen": true,
      "text": "Your code is 123456",
      "verificationCode": "123456",
      "attachments": []
    }
  }
}`, note: '没有未读邮件时返回 204 No Content，没有响应 body。' }, example: `curl '${apiBase()}/messages/next?address=my-prefix@public.example.com&wait=0' \\
  -H 'X-API-Key: AC-your-key'` },
      { method: 'POST', path: '/v1/messages/mark-read', description: '将目标邮箱内全部邮件标为已读。', parameters: [{ location: 'Query', name: 'address', required: 'API Key 是', description: '目标邮箱地址；临时 Token 可省略。' }, { location: 'Body', name: '无', required: '否', description: '此接口没有请求 body。' }], parameterNote: null, response: { status: '200', language: 'json', body: `{
  "success": true,
  "data": {
    "mailbox": "my-prefix@public.example.com",
    "updated": 2,
    "alreadySeen": 1,
    "total": 3
  }
}`, note: null }, example: `curl '${apiBase()}/messages/mark-read?address=my-prefix@public.example.com' \\
  -X POST -H 'X-API-Key: AC-your-key'` },
      { method: 'GET', path: '/v1/messages/:id', description: '读取单封邮件正文、验证码和附件元数据。', parameters: [{ location: 'Path', name: 'id', required: '是', description: '正整数邮件 ID。' }, { location: 'Query', name: 'address', required: 'API Key 是', description: '目标邮箱地址；临时 Token 可省略。' }], parameterNote: null, response: { status: '200', language: 'json', body: `{
  "success": true,
  "data": {
    "id": "123",
    "subject": "Verification code",
    "seen": false,
    "starred": false,
    "text": "Your code is 123456",
    "html": ["<p>Your code is 123456</p>"],
    "verificationCode": "123456",
    "attachments": [{ "id": "7", "filename": "proof.txt", "contentType": "text/plain", "size": 5, "downloadUrl": "/v1/messages/123/attachments/7" }]
  }
}`, note: null }, example: `curl '${apiBase()}/messages/123?address=my-prefix@public.example.com' \\
  -H 'X-API-Key: AC-your-key'` },
      { method: 'PATCH', path: '/v1/messages/:id', description: '更新邮件已读和／或星标状态。', parameters: [{ location: 'Path', name: 'id', required: '是', description: '正整数邮件 ID。' }, { location: 'Query', name: 'address', required: 'API Key 是', description: '目标邮箱地址；临时 Token 可省略。' }, { location: 'Body', name: 'seen、starred', required: '至少一项', description: '布尔值。' }], parameterNote: null, response: { status: '200', language: 'json', body: `{
  "success": true,
  "data": {
    "id": "123",
    "seen": true,
    "starred": false
  }
}`, note: null }, example: `curl '${apiBase()}/messages/123?address=my-prefix@public.example.com' \\
  -X PATCH -H 'X-API-Key: AC-your-key' -H 'Content-Type: application/json' \\
  -d '{"seen":true,"starred":false}'` },
      { method: 'DELETE', path: '/v1/messages/:id', description: '删除一封邮件。', parameters: [{ location: 'Path', name: 'id', required: '是', description: '正整数邮件 ID。' }, { location: 'Query', name: 'address', required: 'API Key 是', description: '目标邮箱地址；临时 Token 可省略。' }], parameterNote: null, response: { status: '204', language: 'text', body: null, note: '成功时没有响应 body；客户端不得调用 JSON 解析。' }, example: `curl '${apiBase()}/messages/123?address=my-prefix@public.example.com' \\
  -X DELETE -H 'X-API-Key: AC-your-key'` },
      { method: 'GET', path: '/v1/sources/:id', description: '读取完整原始 RFC 822 邮件内容。', parameters: [{ location: 'Path', name: 'id', required: '是', description: '正整数邮件 ID。' }, { location: 'Query', name: 'address', required: 'API Key 是', description: '目标邮箱地址；临时 Token 可省略。' }], parameterNote: null, response: { status: '200', language: 'json', body: `{
  "success": true,
  "data": {
    "id": "123",
    "data": "From: Sender <sender@example.net>\\r\\nTo: my-prefix@public.example.com\\r\\nSubject: Verification code\\r\\n\\r\\nYour code is 123456"
  }
}`, note: null }, example: `curl '${apiBase()}/sources/123?address=my-prefix@public.example.com' \\
  -H 'X-API-Key: AC-your-key'` },
      { method: 'GET', path: '/v1/messages/:id/attachments/:attachmentId', description: '下载附件二进制内容。', parameters: [{ location: 'Path', name: 'id', required: '是', description: '正整数邮件 ID。' }, { location: 'Path', name: 'attachmentId', required: '是', description: '正整数附件 ID。' }, { location: 'Header', name: 'X-API-Key 或 Authorization', required: '是', description: 'API Key 需要 messages:read；详情中的临时 Token 下载 URL 可直接使用。' }], parameterNote: null, response: { status: '200', language: 'text', body: null, note: '响应 body 是附件二进制内容，不使用 JSON；响应头含 Content-Type 与 Content-Disposition。' }, example: `curl ${apiBase()}/messages/123/attachments/7 \\
  -H 'Authorization: Bearer temporary-token' --output proof.txt` }
    ]
  },
  {
    id: 'ai-llm', title: 'AI / LLM', intro: '面向 AI 助手与自动化工具的公开机器可读文档。', endpoints: [
      { method: 'GET', path: '/v1/llms.txt', description: '返回中文 Markdown 摘要与 Python 最小示例。', parameters: null, parameterNote: '无认证、path、query 或 body 参数。', response: { status: '200', language: 'text', body: `# Cloud Mail 临时邮箱 API

## 认证
- API Key: X-API-Key: AC-...
- 临时 Token: Authorization: Bearer <token>`, note: null }, example: `curl ${apiBase()}/llms.txt` },
      { method: 'GET', path: '/v1/openapi.json', description: '返回完整 OpenAPI 3.1 JSON。', parameters: null, parameterNote: '无认证、path、query 或 body 参数。', response: { status: '200', language: 'json', body: `{
  "openapi": "3.1.0",
  "info": {
    "title": "Cloud Mail Temporary Inbox API",
    "version": "2.0.0"
  },
  "servers": [{ "url": "/v1" }]
}`, note: null }, example: `curl ${apiBase()}/openapi.json` },
      { method: 'GET', path: '/v1/openapi.yaml', description: '返回与 JSON 等价的 OpenAPI YAML。', parameters: null, parameterNote: '无认证、path、query 或 body 参数。', response: { status: '200', language: 'yaml', body: `"openapi": "3.1.0"
"info":
  "title": "Cloud Mail Temporary Inbox API"
  "version": "2.0.0"`, note: null }, example: `curl ${apiBase()}/openapi.yaml` },
      { method: 'GET', path: '/v1/error-codes', description: '返回中英文机器可读错误码表。', parameters: null, parameterNote: '无认证、path、query 或 body 参数。', response: { status: '200', language: 'json', body: `{
  "errorCodes": [
    { "code": "address_required", "en": "Address is required", "zh": "缺少 address" }
  ]
}`, note: null }, example: `curl ${apiBase()}/error-codes` }
    ]
  }
]);

async function load() { loading.value = true; try { keys.value = await apiKeyList(); } finally { loading.value = false; } }
function openCreate() { createVisible.value = true; }
function openGuide() { guideVisible.value = true; }
function resetCreate() { form.name = ''; form.scopes = []; }
async function create() { if (!form.name.trim() || !form.scopes.length) { ElMessage({ type: 'error', message: t('reqFailErrorMsg') }); return; } creating.value = true; try { const data = await apiKeyCreate({ name: form.name, scopes: form.scopes }); createVisible.value = false; secret.value = data.secret; secretVisible.value = true; await load(); } finally { creating.value = false; } }
async function copyText(value) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Copy failed');
  }
  ElMessage({ type: 'success', message: t('copySuccessMsg') });
}

async function copyKeyPrefix(row) {
  try {
    await copyText(row.prefix);
  } catch {
    ElMessage({ type: 'error', message: t('copyFailMsg') });
  }
}
async function copySecret() {
  try {
    await copyText(secret.value);
  } catch {
    ElMessage({ type: 'error', message: t('copyFailMsg') });
  }
}
function deleteKey(row) { ElMessageBox.confirm(t('deleteApiKeyWarning', { msg: row.name }), { type: 'warning' }).then(async () => { await apiKeyDelete(row.apiKeyId); await load(); }); }
onMounted(load);
</script>

<style scoped lang="scss">
.api-keys { padding: 28px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.toolbar-actions { display: flex; gap: 10px; }
.table-actions { display: flex; align-items: center; gap: 8px; }
.table-actions .el-button { margin: 0; }
h2 { margin: 0; }
.api-keys > p, .toolbar p { color: var(--el-text-color-secondary); margin: 8px 0 0; }
.scope { margin: 2px; }
.secret { margin-top: 18px; }
.el-checkbox { display: flex; margin: 8px 0; }
:deep(.guide-dialog .el-dialog__body) { padding: 0; overflow: hidden; }
.guide-document { max-width: 100%; color: #363636; font: 14px/1.62 "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
.guide-shell { width: min(100% - 64px, 1280px); margin: 0 auto; padding: 38px 0 68px; }
.guide-hero { padding: 29px 0 42px; }
.guide-hero h1, .guide-shell h2, .guide-shell h3 { color: #101010; }
.guide-hero h1 { margin: 0; font: 800 clamp(38px, 5vw, 50px)/1.1 Arial, "Noto Sans SC", sans-serif; letter-spacing: -2.5px; }
.guide-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
.guide-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 7px; background: #f5f5f4; color: #777; font-size: 12px; }
.guide-badge.sections::before { content: "▧"; }.guide-badge.updated::before { content: "◷"; }.guide-badge.copy::before { content: "□"; }
.guide-lead { margin: 32px 0 0; padding: 22px; border: 1px solid #f0f0ef; border-radius: 12px; background: #fbfbfa; color: #666; font-size: 15px; line-height: 1.65; }
.guide-layout { display: grid; grid-template-columns: 214px minmax(0, 1fr); gap: 30px; align-items: start; }
.guide-sidebar { position: sticky; top: 24px; padding: 0 10px; }.contents-title { margin: 0 0 11px; color: #1e1e1e; font-size: 13px; font-weight: 700; }.guide-sidebar nav { display: grid; gap: 4px; }.guide-sidebar a { position: relative; padding: 8px 11px; border-radius: 7px; color: #7a7a7a; text-decoration: none; font-size: 13px; }.guide-sidebar a:hover, .guide-sidebar a:focus { color: #111; background: #f1f1f0; outline: none; }.guide-sidebar a:first-child { color: #111; background: #ececeb; font-weight: 600; }.guide-sidebar a:first-child::after { content: "•"; position: absolute; right: 13px; color: #111; font-size: 20px; line-height: 15px; }
.guide-layout main { min-width: 0; }.guide-layout section { position: relative; margin: 0 0 70px; scroll-margin-top: 24px; }.section-title { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 16px; min-height: 58px; margin-bottom: 18px; background: #fffc; border-bottom: 1px solid #eeeeed; backdrop-filter: blur(10px); }.number { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; background: #f5f5f4; color: #8b8b8b; font-size: 13px; box-shadow: 0 2px 8px #00000008; }.section-title h2 { margin: 0; font: 700 22px/1.2 Arial, "Noto Sans SC", sans-serif; letter-spacing: -1px; }.section-body { margin-left: 44px; padding-left: 26px; border-left: 1px solid #e9e9e9; }.section-body p { margin: 0 0 18px; color: #666; }.section-body h3 { margin: 28px 0 9px; font-size: 15px; line-height: 1.35; }.section-body ol { margin: 8px 0 0; padding-left: 19px; color: #666; }.section-body li + li { margin-top: 5px; }.guide-shell code { padding: 1px 4px; border-radius: 3px; background: #f1f1f0; color: #444; font: 12px "SFMono-Regular", Consolas, monospace; }
.endpoint { margin: 25px 0 31px; }.endpoint-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }.method { min-width: 48px; padding: 2px 6px; border-radius: 4px; text-align: center; font: 700 11px/1.5 Consolas, monospace; }.get { color: #0d6ea8; background: #e5f3fb; }.post { color: #0a7859; background: #e3f6ee; }.patch { color: #6945ae; background: #eee8fa; }.delete { color: #aa3131; background: #fbeaea; }.path { color: #111; font: 700 15px Consolas, "SFMono-Regular", monospace; }.label { margin: 17px 0 6px; color: #777; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
.code-box { position: relative; overflow: auto; padding: 29px 16px 15px; border: 1px solid #efefee; border-radius: 11px; background: #f7f7f6; color: #262626; font: 12px/1.65 Consolas, "SFMono-Regular", monospace; white-space: pre; }.code-box::before { content: attr(data-language); position: absolute; top: 9px; left: 15px; color: #888; font: 11px Arial, sans-serif; }.code-box pre { margin: 0; font: inherit; white-space: inherit; }.dots { position: absolute; top: 11px; left: 15px; display: none; }.code-box.has-dots::before { left: 68px; }.code-box.has-dots .dots { display: flex; gap: 6px; }.dots i { display: block; width: 8px; height: 8px; border-radius: 50%; background: #f16b60; }.dots i:nth-child(2) { background: #f6be4f; }.dots i:nth-child(3) { background: #61c454; }
.spec-table { width: 100%; border-collapse: collapse; margin: 15px 0 0; font-size: 13px; }.spec-table th, .spec-table td { padding: 10px 11px; border-bottom: 1px solid #e9e9e9; text-align: left; vertical-align: top; }.spec-table th { color: #555; background: #fafafa; font-weight: 650; }.spec-table td { color: #666; }.spec-table code { white-space: nowrap; }.note { margin-top: 15px; padding: 13px 15px; border: 1px solid #eeeeed; border-radius: 8px; background: #fafafa; color: #686868; font-size: 13px; }
@media (max-width: 800px) { .guide-shell { width: min(100% - 32px, 1280px); padding-top: 22px; }.guide-hero { padding-bottom: 28px; }.guide-lead { margin-top: 24px; }.guide-layout { display: block; }.guide-sidebar { display: none; }.section-body { margin-left: 0; padding-left: 18px; }.guide-layout section { margin-bottom: 48px; }.guide-hero h1 { letter-spacing: -1.7px; }.spec-table { table-layout: fixed; }.spec-table code, .path { white-space: normal; overflow-wrap: anywhere; }.guide-document { overflow-x: hidden; }.code-box { overflow-x: auto; } }
</style>
