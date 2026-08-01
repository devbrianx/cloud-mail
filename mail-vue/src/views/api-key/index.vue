<template>
  <div class="api-keys">
    <div class="toolbar">
      <div>
        <h2>{{ $t('apiKeys') }}</h2>
        <p>{{ $t('apiKeySecretWarning') }}</p>
      </div>
      <el-button type="primary" @click="openCreate">{{ $t('createApiKey') }}</el-button>
    </div>

    <el-table :data="keys" v-loading="loading" empty-text="No API keys">
      <el-table-column prop="name" :label="$t('apiKeyName')" min-width="160" />
      <el-table-column prop="prefix" label="Prefix" min-width="110" />
      <el-table-column :label="$t('apiScopes')" min-width="260">
        <template #default="{ row }">
          <el-tag v-for="scope in row.scopes" :key="scope" class="scope">{{ scope }}</el-tag>
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
            <el-checkbox v-for="scope in scopes" :key="scope" :value="scope">{{ scope }}</el-checkbox>
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
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { apiKeyCreate, apiKeyList, apiKeyRevoke } from '@/request/api-key.js';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const scopes = ['inboxes:read', 'inboxes:write', 'messages:read', 'messages:write'];
const keys = ref([]);
const loading = ref(false);
const creating = ref(false);
const createVisible = ref(false);
const secretVisible = ref(false);
const secret = ref('');
const form = reactive({ name: '', scopes: [] });

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

async function copySecret() {
  await navigator.clipboard.writeText(secret.value);
  ElMessage({ type: 'success', message: t('copySuccessMsg') });
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
h2 { margin: 0; }
p { color: var(--el-text-color-secondary); margin: 8px 0 0; }
.scope { margin: 2px; }
.secret { margin-top: 18px; }
.el-checkbox { display: flex; margin: 8px 0; }
@media (max-width: 767px) { .api-keys { padding: 20px; } .toolbar { align-items: flex-start; gap: 16px; } }
</style>
