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
      <el-table-column prop="todayCalls" :label="$t('apiKeyTodayCalls')" width="110" />
      <el-table-column prop="last30DaysCalls" :label="$t('apiKeyLast30DaysCalls')" width="130" />
      <el-table-column :label="$t('action')" width="150">
        <template #default="{ row }">
          <el-button type="danger" link @click="deleteKey(row)">{{ $t('deleteApiKey') }}</el-button>
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
import { apiKeyCreate, apiKeyList, apiKeyDelete } from '@/request/api-key.js';
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

使用 AC- API 密钥创建临时邮箱。创建成功会返回仅属于该邮箱的临时 Bearer token；临时 token 可用于后续读取同一邮箱、刷新 token、读取邮件、更新状态、删除及下载附件。管理员必须先启用 API、配置 API 域名，并可额外标记已经配置 Cloudflare Email Routing 通配 MX 的通配域。

## 认证
创建或 API 密钥操作：\nX-API-Key: AC_your_api_key
临时 token 操作：\nAuthorization: Bearer TEMP_TOKEN

## 接口
- POST /accounts（inboxes:write）：创建固定临时邮箱，JSON 支持 localPart、address、domain。
- POST /accounts/wildcard（inboxes:write）：创建通配子域邮箱，JSON 支持 domain、subdomain、localPart。域必须已启用通配能力。
- POST /inboxes：兼容别名，已弃用；使用 /accounts。
- GET /accounts/me、POST /token：仅临时 token；刷新时提供 address。
- GET /inboxes/{id}；GET/DELETE /accounts/{id}（后者为兼容别名）。
- GET /messages?address=邮箱，或 GET /inboxes/{id}/messages；支持 limit、offset、seen、since、q、after_id。
- GET /messages/next?address=邮箱；POST /messages/mark-read?address=邮箱。
- GET/PATCH/DELETE /messages/{id}?address=邮箱；PATCH 支持 seen、starred。
- GET /sources/{id}?address=邮箱返回原始 RFC 822；附件 URL 为 /messages/{id}/attachments/{attachmentId}。

API 密钥调用必须附带 address 以限制在该密钥创建的邮箱。Webhooks、持久邮箱、发件、DNS 自动配置及其他非临时邮箱服务不属于此 API。` : `# Cloud Mail Temporary Inbox API Guide

Base URL: ${origin}/v1

Create temporary accounts with an AC- API key. Successful creation returns a Bearer token bound to that inbox; it can read, update, delete, refresh, and download attachments for that same inbox. Administrators configure API domains and may mark roots whose wildcard Email Routing MX already exists.

## Authentication
API-key operations:\nX-API-Key: AC_your_api_key
Temporary-token operations:\nAuthorization: Bearer TEMP_TOKEN

## Endpoints
- POST /accounts creates a fixed account; accepts localPart, address, and domain.
- POST /accounts/wildcard creates a wildcard account; accepts domain, subdomain, and localPart.
- POST /inboxes is the deprecated creation alias.
- GET /accounts/me and POST /token require the temporary token.
- GET /inboxes/{id}; GET/DELETE /accounts/{id} (the latter is a compatible alias).
- GET /messages?address=... or GET /inboxes/{id}/messages supports limit, offset, seen, since, q, and after_id.
- GET /messages/next?address=...; POST /messages/mark-read?address=....
- GET/PATCH/DELETE /messages/{id}?address=...; PATCH supports seen and starred.
- GET /sources/{id}?address=... returns the original RFC 822 source; attachment URLs use /messages/{id}/attachments/{attachmentId}.

API-key message calls must include address and are restricted to accounts created with that key. Webhooks, persistent mailboxes, sending, DNS provisioning, and other non-temporary services are excluded.`;
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

function deleteKey(row) {
  ElMessageBox.confirm(t('deleteApiKeyWarning', { msg: row.name }), { type: 'warning' }).then(async () => {
    await apiKeyDelete(row.apiKeyId);
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
