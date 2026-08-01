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
        <template #default="{ row }">
          <el-tag v-for="scope in row.scopes" :key="scope" class="scope">{{ scopeLabel(scope) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createTime" :label="$t('date')" min-width="180" />
      <el-table-column :label="$t('action')" width="120">
        <template #default="{ row }">
          <el-tag v-if="row.revokedAt" type="info">{{ $t('apiKeyRevoked') }}</el-tag>
          <el-button v-else type="danger" link @click="revoke(row)">{{ $t('revokeApiKey') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="createVisible" :title="$t('createApiKey')" width="420" @closed="resetCreate">
      <el-form label-position="top">
        <el-form-item :label="$t('apiKeyName')" required>
          <el-input v-model="form.name" maxlength="64" />
        </el-form-item>
        <el-form-item :label="$t('apiScopes')" required>
          <el-checkbox-group v-model="form.scopes">
            <el-checkbox v-for="scope in scopes" :key="scope.value" :value="scope.value">{{ scope.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">{{ $t('cancel') }}</el-button>
        <el-button type="primary" :loading="creating" @click="create">{{ $t('createApiKey') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="secretVisible" :title="$t('apiKeys')" width="460" @closed="secret = ''">
      <el-alert :title="$t('apiKeySecretWarning')" type="warning" :closable="false" />
      <el-input class="secret" :model-value="secret" readonly>
        <template #append><el-button @click="copySecret">{{ $t('copy') }}</el-button></template>
      </el-input>
    </el-dialog>

    <el-dialog v-model="guideVisible" :title="$t('apiUsageGuide')" width="720">
      <el-input v-model="guide" type="textarea" :autosize="{ minRows: 18, maxRows: 26 }" readonly />
      <template #footer>
        <el-button type="primary" @click="copyGuide">{{ $t('apiUsageGuideCopy') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { apiKeyCreate, apiKeyList, apiKeyRevoke } from '@/request/api-key.js';
import { useI18n } from 'vue-i18n';

const { t, locale } = useI18n();
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
const guide = ref('');
const form = reactive({ name: '', scopes: [] });

function scopeLabel(value) {
  return scopes.value.find(scope => scope.value === value)?.label || value;
}

function buildGuide(origin) {
  const chinese = locale.value === 'zh';
  const labels = Object.fromEntries(scopes.value.map(scope => [scope.value, scope.label]));
  return chinese ? `# Cloud Mail 临时邮箱 API 使用说明

Base URL: ${origin}/v1

此 API 用于创建和管理仅 API 可见的临时邮箱；邮箱、邮件和附件将在创建 24 小时后删除。使用前，管理员必须在系统设置启用临时邮箱 API、配置可用域名，并在权限控制中为你的角色授予“API 密钥”。在网页“API 密钥”创建密钥后仅会显示一次，请安全保存。

## 认证
每个请求必须带：\nX-API-Key: cm_your_api_key
请仅将 cm_your_api_key 替换成你创建时复制的真实密钥；不要使用浏览器登录 Token。

## 权限范围
- inboxes:read：${labels['inboxes:read']}；查看本密钥创建的邮箱。
- inboxes:write：${labels['inboxes:write']}；创建、删除本密钥创建的邮箱。
- messages:read：${labels['messages:read']}；查看邮件及下载附件。
- messages:write：${labels['messages:write']}；标记已读状态和删除邮件。

## 接口
- POST /inboxes（inboxes:write）：创建邮箱。JSON: {"domain":"允许的域名","localPart":"可选小写前缀"}。domain 必须是管理员允许的域名；localPart 省略时服务器随机生成。
- GET /inboxes（inboxes:read）：列出本密钥创建且未过期的邮箱。
- GET /inboxes/{id}（inboxes:read）：查看邮箱及邮件数量。
- DELETE /inboxes/{id}（inboxes:write）：删除邮箱、其邮件与附件。
- GET /inboxes/{id}/messages?limit=50&seen=true&after_id=123（messages:read）：分页列出邮件。limit 为 1-100；seen 可为 true/false；after_id 为下一页游标。
- GET /messages/{id}（messages:read）：获取邮件正文和附件下载地址。
- PATCH /messages/{id}（messages:write）：JSON 必须为 {"seen":true}。
- DELETE /messages/{id}（messages:write）：删除邮件及附件。
- GET /messages/{id}/attachments/{attachmentId}（messages:read）：下载附件。

## 响应与访问边界
成功：{"success":true,"data":...}；失败：{"success":false,"error":"...","errorCode":"..."}。401 表示密钥无效或已撤销；403 表示 API 未启用或 scope 不足；404 表示资源不存在、已过期、已删除或不属于此密钥；409 表示邮箱地址冲突。一个密钥只能访问它自己创建的临时邮箱，即使另一个密钥属于同一用户也不能访问。

## curl 示例
\`\`\`bash
KEY='cm_your_api_key'
BASE='${origin}/v1'
# 创建邮箱
curl -X POST "$BASE/inboxes" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{"domain":"example.com","localPart":"demo"}'
# 列出邮件
curl "$BASE/inboxes/INBOX_ID/messages?limit=50" -H "X-API-Key: $KEY"
# 获取邮件
curl "$BASE/messages/MESSAGE_ID" -H "X-API-Key: $KEY"
# 标记已读
curl -X PATCH "$BASE/messages/MESSAGE_ID" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{"seen":true}'
# 删除邮件或邮箱
curl -X DELETE "$BASE/messages/MESSAGE_ID" -H "X-API-Key: $KEY"
curl -X DELETE "$BASE/inboxes/INBOX_ID" -H "X-API-Key: $KEY"
\`\`\`

不支持发件、匿名邮箱、Webhook、通配域、持久邮箱访问、原始邮件源码或速率限制配置。` : `# Cloud Mail Temporary Inbox API Guide

Base URL: ${origin}/v1

This API creates and manages API-only temporary inboxes. An inbox, its messages, and attachments are deleted 24 hours after creation. Before use, an administrator must enable Temporary Inbox API, configure allowed domains, and grant your role the API Keys permission. A key is shown only once at creation; store it securely.

## Authentication
Send this header on every request:\nX-API-Key: cm_your_api_key
Replace only cm_your_api_key with the key copied when it was created. Do not use a browser login token.

## Scopes
- inboxes:read: ${labels['inboxes:read']} — list and view inboxes created by this key.
- inboxes:write: ${labels['inboxes:write']} — create and delete inboxes created by this key.
- messages:read: ${labels['messages:read']} — list/view messages and download attachments.
- messages:write: ${labels['messages:write']} — update seen state and delete messages.

## Endpoints
- POST /inboxes (inboxes:write): create an inbox. JSON: {"domain":"allowed domain","localPart":"optional lowercase prefix"}. domain must be allowed by the administrator; omit localPart for a server-generated value.
- GET /inboxes (inboxes:read): list active inboxes created by this key.
- GET /inboxes/{id} (inboxes:read): get inbox and message count.
- DELETE /inboxes/{id} (inboxes:write): delete inbox, messages, and attachments.
- GET /inboxes/{id}/messages?limit=50&seen=true&after_id=123 (messages:read): list messages. limit is 1-100; seen is true/false; after_id is the next-page cursor.
- GET /messages/{id} (messages:read): get message body and attachment URLs.
- PATCH /messages/{id} (messages:write): JSON must be {"seen":true}.
- DELETE /messages/{id} (messages:write): delete a message and attachments.
- GET /messages/{id}/attachments/{attachmentId} (messages:read): download an attachment.

## Responses and ownership
Success: {"success":true,"data":...}. Error: {"success":false,"error":"...","errorCode":"..."}. 401 means invalid or revoked key; 403 means API disabled or missing scope; 404 means missing, expired, deleted, or another key's resource; 409 means address conflict. A key can access only inboxes it created, including when another key belongs to the same user.

## curl examples
\`\`\`bash
KEY='cm_your_api_key'
BASE='${origin}/v1'
# Create an inbox
curl -X POST "$BASE/inboxes" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{"domain":"example.com","localPart":"demo"}'
# List messages
curl "$BASE/inboxes/INBOX_ID/messages?limit=50" -H "X-API-Key: $KEY"
# Get a message
curl "$BASE/messages/MESSAGE_ID" -H "X-API-Key: $KEY"
# Mark seen
curl -X PATCH "$BASE/messages/MESSAGE_ID" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{"seen":true}'
# Delete a message or inbox
curl -X DELETE "$BASE/messages/MESSAGE_ID" -H "X-API-Key: $KEY"
curl -X DELETE "$BASE/inboxes/INBOX_ID" -H "X-API-Key: $KEY"
\`\`\`

This API does not support sending mail, anonymous inboxes, webhooks, wildcard domains, persistent mailbox access, raw email source, or rate-limit configuration.`;
}

async function load() {
  loading.value = true;
  try {
    keys.value = await apiKeyList();
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  createVisible.value = true;
}

function openGuide() {
  guide.value = buildGuide(window.location.origin);
  guideVisible.value = true;
}

function resetCreate() {
  form.name = '';
  form.scopes = [];
}

async function create() {
  if (!form.name.trim() || !form.scopes.length) {
    ElMessage({ type: 'error', message: t('reqFailErrorMsg') });
    return;
  }
  creating.value = true;
  try {
    const data = await apiKeyCreate({ name: form.name, scopes: form.scopes });
    createVisible.value = false;
    secret.value = data.secret;
    secretVisible.value = true;
    await load();
  } finally {
    creating.value = false;
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    ElMessage({ type: 'success', message: t('copySuccessMsg') });
  } catch {
    ElMessage({ type: 'error', message: t('copyFailMsg') });
  }
}

async function copySecret() {
  await copyText(secret.value);
}

async function copyGuide() {
  await copyText(guide.value);
}

function revoke(row) {
  ElMessageBox.confirm(t('delConfirm', { msg: row.name }), { type: 'warning' }).then(async () => {
    await apiKeyRevoke(row.apiKeyId);
    await load();
  });
}

onMounted(load);
</script>

<style scoped lang="scss">
.api-keys { padding: 28px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.toolbar-actions { display: flex; gap: 10px; }
h2 { margin: 0; }
p { color: var(--el-text-color-secondary); margin: 8px 0 0; }
.scope { margin: 2px; }
.secret { margin-top: 18px; }
.el-checkbox { display: flex; margin: 8px 0; }
@media (max-width: 767px) { .api-keys { padding: 20px; } .toolbar { align-items: flex-start; gap: 16px; } .toolbar-actions { flex-direction: column; } }
</style>
