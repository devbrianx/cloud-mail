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
      <el-scrollbar class="guide-document" max-height="65vh">
        <p>{{ $t('apiGuideIntro') }}</p>
        <p><strong>{{ $t('apiGuideBaseUrl') }}:</strong> <code>{{ apiBase() }}</code></p>

        <h3>{{ $t('apiGuideAuthentication') }}</h3>
        <dl class="guide-auth">
          <div><dt>{{ $t('apiGuideApiKeyAuth') }}</dt><dd><code>X-API-Key: AC_your_api_key</code></dd></div>
          <div><dt>{{ $t('apiGuideTokenAuth') }}</dt><dd><code>Authorization: Bearer TEMP_TOKEN</code></dd></div>
        </dl>

        <h3>{{ $t('apiGuideScopes') }}</h3>
        <el-table :data="scopes" size="small" border>
          <el-table-column prop="value" :label="$t('apiGuideScopes')" min-width="170" />
          <el-table-column prop="label" :label="$t('apiScopes')" min-width="210" />
        </el-table>

        <h3>{{ $t('apiGuideCreateAccount') }}</h3>
        <p>{{ $t('apiGuideCreateAccountDesc') }}</p>
        <pre><code>{{ createAccountExample() }}</code></pre>
        <p class="guide-note">{{ $t('apiGuideCreateResponse') }}</p>

        <h3>{{ $t('apiGuideCurrentAccount') }}</h3>
        <p>{{ $t('apiGuideCurrentAccountDesc') }}</p>
        <pre><code>{{ currentAccountExample() }}</code></pre>

        <h3>{{ $t('apiGuideListMessages') }}</h3>
        <p>{{ $t('apiGuideListMessagesDesc') }}</p>
        <pre><code>{{ listMessagesExample() }}</code></pre>

        <h3>{{ $t('apiGuideRestrictions') }}</h3>
        <p>{{ $t('apiGuideRestrictionsDesc') }}</p>
      </el-scrollbar>
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

function apiBase() {
  return `${window.location.origin}/v1`;
}

function createAccountExample() {
  return `curl -X POST '${apiBase()}/accounts' \\
  -H 'X-API-Key: AC_your_api_key' \\
  -H 'Content-Type: application/json' \\
  -d '{"localPart":"demo","domain":"example.com"}'`;
}

function currentAccountExample() {
  return `curl '${apiBase()}/accounts/me' \\
  -H 'Authorization: Bearer TEMP_TOKEN'`;
}

function listMessagesExample() {
  return `curl '${apiBase()}/messages?address=demo@example.com&limit=50' \\
  -H 'X-API-Key: AC_your_api_key'`;
}

function buildGuide(origin) {
  const base = `${origin}/v1`;
  const create = createAccountExample().replace(apiBase(), base);
  const current = currentAccountExample().replace(apiBase(), base);
  const messages = listMessagesExample().replace(apiBase(), base);
  return locale.value === 'zh' ? `# Cloud Mail 临时邮箱 API 使用说明

Base URL: ${base}

使用 AC- API 密钥创建 24 小时有效的临时邮箱。创建成功返回仅绑定该邮箱的临时 Bearer token。

## 认证

- API 密钥操作：\`X-API-Key: AC_your_api_key\`
- 临时 token 操作：\`Authorization: Bearer TEMP_TOKEN\`

## 权限范围

- \`inboxes:read\`：查看临时邮箱。
- \`inboxes:write\`：创建和删除临时邮箱。
- \`messages:read\`：读取邮件、附件和原始信件。
- \`messages:write\`：修改邮件状态或删除邮件。

## 创建临时邮箱

需要 \`inboxes:write\`。成功响应的 \`data\` 包含 \`id\`、\`address\`、\`expiresAt\` 与仅创建时返回的 \`token\`。

\`\`\`bash
${create}
\`\`\`

## 查看当前临时邮箱

使用创建时返回的 token。该 token 只能访问绑定的临时邮箱。

\`\`\`bash
${current}
\`\`\`

## 查询邮件

需要 \`messages:read\`。使用 API 密钥查询时必须提供 \`address\`，且只能访问该密钥创建的邮箱。

\`\`\`bash
${messages}
\`\`\`

Webhooks、持久邮箱、邮件发送和 DNS 自动配置不属于此 API。` : `# Cloud Mail Temporary Inbox API Guide

Base URL: ${base}

Use an AC- API key to create temporary inboxes that expire after 24 hours. Creation returns a temporary Bearer token bound to that inbox.

## Authentication

- API-key operations: \`X-API-Key: AC_your_api_key\`
- Temporary-token operations: \`Authorization: Bearer TEMP_TOKEN\`

## Scopes

- \`inboxes:read\`: Read temporary inboxes.
- \`inboxes:write\`: Create and delete temporary inboxes.
- \`messages:read\`: Read messages, attachments, and raw sources.
- \`messages:write\`: Update message state or delete messages.

## Create a temporary inbox

Requires \`inboxes:write\`. The success \`data\` contains \`id\`, \`address\`, \`expiresAt\`, and the creation-only \`token\`.

\`\`\`bash
${create}
\`\`\`

## Read the current temporary inbox

Use the token returned at creation. A temporary token can access only its bound inbox.

\`\`\`bash
${current}
\`\`\`

## List messages

Requires \`messages:read\`. API-key message calls must include \`address\` and can access only inboxes created by that key.

\`\`\`bash
${messages}
\`\`\`

Webhooks, persistent mailboxes, message sending, and automatic DNS provisioning are outside this API.`;
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
.guide-document { padding-right: 12px; }
.guide-document h3 { margin: 24px 0 8px; }
.guide-document code { padding: 2px 5px; border-radius: 4px; background: var(--el-fill-color-light); }
.guide-document pre { margin: 12px 0; padding: 14px; overflow-x: auto; border-radius: 6px; background: var(--el-fill-color-light); }
.guide-document pre code { padding: 0; background: transparent; white-space: pre; }
.guide-auth { margin: 0; }
.guide-auth div { display: grid; grid-template-columns: 200px 1fr; gap: 12px; padding: 6px 0; }
.guide-auth dt, .guide-auth dd { margin: 0; }
.guide-note { font-size: 13px; }
@media (max-width: 767px) { .api-keys { padding: 20px; } .toolbar { align-items: flex-start; gap: 16px; } .toolbar-actions { flex-direction: column; } .guide-auth div { grid-template-columns: 1fr; gap: 4px; } }
</style>
