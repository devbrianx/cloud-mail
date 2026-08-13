<template>
  <div class="outlook-page">
    <div class="toolbar">
      <div><h2>{{ $t('outlookAccountPool') }}</h2></div>
      <div class="actions">
        <el-button type="primary" :loading="authorizing" @click="authorize">{{ $t('outlookAuthorize') }}</el-button>
        <el-button @click="importVisible = true">{{ $t('outlookImport') }}</el-button>
        <el-button @click="load"><Icon icon="ion:reload" /></el-button>
      </div>
    </div>
    <div v-if="selectedIds.length" class="batch-actions">
      <span>{{ $t('outlookSelectedCount', { count: selectedIds.length }) }}</span>
      <el-button size="small" @click="openBatchGroup">{{ $t('outlookBatchSetGroup') }}</el-button>
      <el-button size="small" type="danger" @click="batchRemove">{{ $t('outlookBatchDelete') }}</el-button>
    </div>
    <el-table :data="accounts" v-loading="loading" @selection-change="changeSelection">
      <el-table-column type="selection" width="48" />
      <el-table-column prop="email" :label="$t('emailAccount')" min-width="190" />
      <el-table-column prop="groupName" :label="$t('outlookGroup')" min-width="130" />
      <el-table-column :label="$t('outlookTags')" min-width="180"><template #default="{ row }"><el-tag v-for="tag in row.tagNames" :key="tag" class="tag">{{ tag }}</el-tag></template></el-table-column>
      <el-table-column :label="$t('action')" width="150"><template #default="{ row }"><el-button size="small" @click="openOrganization(row)">{{ $t('change') }}</el-button><el-button size="small" type="danger" @click="remove(row)">{{ $t('delete') }}</el-button></template></el-table-column>
    </el-table>
    <div v-if="total > pageSize" class="account-pagination"><el-pagination background layout="prev, pager, next" :page-size="pageSize" :total="total" :current-page="page + 1" @current-change="changePage" /></div>

    <el-dialog v-model="importVisible" :title="$t('outlookImport')" width="640" @closed="resetImport">
      <el-alert :title="$t('outlookGraphImportHint')" type="info" :closable="false" class="import-hint" />
      <el-input v-model="importRows" type="textarea" :rows="8" :placeholder="$t('outlookImportRows')" />
      <el-table v-if="importResult" :data="[...importResult.imported, ...importResult.failed]" class="result-table"><el-table-column prop="line" label="#" width="60" /><el-table-column prop="email" :label="$t('emailAccount')" /><el-table-column prop="reason" :label="$t('outlookImportResult')" /></el-table>
      <template #footer><el-button @click="importVisible = false">{{ $t('cancel') }}</el-button><el-button type="primary" :loading="importing" @click="importAccounts">{{ $t('outlookImport') }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="organizationVisible" :title="$t('change')" width="460" @closed="selected = null">
      <el-form v-if="selected" label-position="top"><el-form-item :label="$t('outlookGroup')"><el-select v-model="organization.groupId" clearable><el-option v-for="group in groups" :key="group.outlookGroupId" :label="group.name" :value="group.outlookGroupId" /></el-select></el-form-item><el-form-item :label="$t('outlookTags')"><el-select v-model="organization.tagIds" multiple><el-option v-for="tag in tags" :key="tag.outlookTagId" :label="tag.name" :value="tag.outlookTagId" /></el-select></el-form-item></el-form>
      <template #footer><el-button @click="organizationVisible = false">{{ $t('cancel') }}</el-button><el-button type="primary" :loading="saving" @click="saveOrganization">{{ $t('save') }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="batchGroupVisible" :title="$t('outlookBatchSetGroup')" width="420" @closed="batchGroupId = null">
      <el-form label-position="top"><el-form-item :label="$t('outlookGroup')"><el-select v-model="batchGroupId" clearable><el-option v-for="group in groups" :key="group.outlookGroupId" :label="group.name" :value="group.outlookGroupId" /></el-select></el-form-item></el-form>
      <template #footer><el-button @click="batchGroupVisible = false">{{ $t('cancel') }}</el-button><el-button type="primary" :loading="saving" @click="saveBatchGroup">{{ $t('save') }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { outlookAccountBatchDelete, outlookAccountBatchSetGroup, outlookAccountDelete, outlookAccountImport, outlookAccountList, outlookAccountSet, outlookOAuthStart } from '@/request/outlook-account.js';
import { outlookGroupList } from '@/request/outlook-group.js';
import { outlookTagList } from '@/request/outlook-tag.js';
import { useAccountStore } from '@/store/account.js';

defineOptions({ name: 'outlook-accounts' });

const { t } = useI18n();
const accountStore = useAccountStore();
const pageSize = 15;
const page = ref(0);
const total = ref(0);
const accounts = ref([]);
const groups = ref([]);
const tags = ref([]);
const selectedIds = ref([]);
const loading = ref(false);
const importVisible = ref(false);
const organizationVisible = ref(false);
const batchGroupVisible = ref(false);
const authorizing = ref(false);
const importing = ref(false);
const saving = ref(false);
const selected = ref(null);
const importRows = ref('');
const importResult = ref(null);
const batchGroupId = ref(null);
const organization = reactive({ groupId: null, tagIds: [] });
let oauthPopup = null;
let oauthPopupTimer = null;

async function load() {
  loading.value = true;
  try {
    const [accountData, groupData, tagData] = await Promise.all([outlookAccountList({ limit: pageSize, offset: page.value * pageSize }), outlookGroupList(), outlookTagList()]);
    accounts.value = accountData.list;
    total.value = accountData.total;
    selectedIds.value = [];
    groups.value = groupData.list;
    tags.value = tagData.list;
    if (!accounts.value.length && page.value > 0) {
      page.value--;
      await load();
    }
  } finally {
    loading.value = false;
  }
}

function changeSelection(rows) {
  selectedIds.value = rows.map(row => row.outlookAccountId);
}

function changePage(value) {
  page.value = value - 1;
  selectedIds.value = [];
  load();
}

function openBatchGroup() {
  batchGroupId.value = null;
  batchGroupVisible.value = true;
}

async function saveBatchGroup() {
  saving.value = true;
  try {
    await outlookAccountBatchSetGroup({ outlookAccountIds: selectedIds.value, groupId: batchGroupId.value });
    batchGroupVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function batchRemove() {
  await ElMessageBox.confirm(t('outlookBatchDeleteConfirm', { count: selectedIds.value.length }), { type: 'warning' });
  await outlookAccountBatchDelete(selectedIds.value);
  await load();
}

function clearOAuthPopup() {
  if (oauthPopupTimer) {
    clearInterval(oauthPopupTimer);
    oauthPopupTimer = null;
  }
  if (oauthPopup && !oauthPopup.closed) oauthPopup.close();
  oauthPopup = null;
}

async function finishOAuth(success) {
  clearOAuthPopup();
  authorizing.value = false;
  ElMessage[success ? 'success' : 'error'](t(success ? 'outlookOauthSuccess' : 'outlookOauthError'));
  if (success) {
    accountStore.refreshAccounts();
    await load();
  }
}

function handleOAuthMessage(event) {
  if (event.origin !== window.location.origin || event.data?.type !== 'outlook-oauth-result') return;
  finishOAuth(event.data.success === true);
}

async function authorize() {
  if (authorizing.value) return;
  const popup = window.open('', 'outlook-oauth', 'popup,width=520,height=720');
  if (!popup) {
    ElMessage.error(t('outlookOauthPopupBlocked'));
    return;
  }

  oauthPopup = popup;
  authorizing.value = true;
  oauthPopupTimer = setInterval(() => {
    if (oauthPopup?.closed) {
      clearOAuthPopup();
      authorizing.value = false;
    }
  }, 250);

  try {
    popup.location.href = (await outlookOAuthStart()).authorizationUrl;
  } catch {
    clearOAuthPopup();
    authorizing.value = false;
  }
}

async function importAccounts() {
  importing.value = true;
  try {
    importResult.value = await outlookAccountImport(importRows.value);
    if (importResult.value.imported.length) {
      accountStore.refreshAccounts();
      await load();
    }
  } finally {
    importing.value = false;
  }
}

function resetImport() {
  importRows.value = '';
  importResult.value = null;
}

function openOrganization(account) {
  selected.value = account;
  organization.groupId = account.groupId;
  organization.tagIds = [...account.tagIds];
  organizationVisible.value = true;
}

async function saveOrganization() {
  saving.value = true;
  try {
    await outlookAccountSet({ outlookAccountId: selected.value.outlookAccountId, groupId: organization.groupId || null, tagIds: organization.tagIds });
    organizationVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}
async function remove(account) {
  await ElMessageBox.confirm(t('delConfirm', { msg: account.email }), { type: 'warning' });
  await outlookAccountDelete(account.outlookAccountId);
  await load();
}

onMounted(async () => {
  window.addEventListener('message', handleOAuthMessage);
  await load();
});

onBeforeUnmount(() => {
  window.removeEventListener('message', handleOAuthMessage);
  clearOAuthPopup();
});
</script>

<style scoped lang="scss">
.outlook-page { padding: 28px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.toolbar h2 { margin: 0; }
.actions { display: flex; gap: 8px; }
.batch-actions { display: flex; align-items: center; gap: 8px; margin: -12px 0 12px; }
.account-pagination { display: flex; justify-content: flex-end; margin-top: 20px; }
.tag { margin: 2px; }
.result-table { margin-top: 18px; }
.import-hint { margin-bottom: 14px; }
.el-select { width: 100%; }
@media (max-width: 700px) {
  .outlook-page { padding: 16px; }
  .toolbar { align-items: flex-start; gap: 12px; flex-direction: column; }
}
</style>
