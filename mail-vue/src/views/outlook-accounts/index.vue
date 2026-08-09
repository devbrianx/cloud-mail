<template>
  <div class="outlook-page">
    <div class="toolbar">
      <div><h2>{{ $t('outlookAccountPool') }}</h2><p>{{ $t('outlookMailService') }}</p></div>
      <div class="actions">
        <el-button v-perm="'outlook-account:add'" type="primary" @click="oauthVisible = true">{{ $t('outlookAuthorize') }}</el-button>
        <el-button v-perm="'outlook-account:add'" @click="importVisible = true">{{ $t('outlookImport') }}</el-button>
        <el-button @click="load"><Icon icon="ion:reload" /></el-button>
      </div>
    </div>
    <el-table :data="accounts" v-loading="loading">
      <el-table-column prop="email" :label="$t('emailAccount')" min-width="220" />
      <el-table-column prop="groupName" :label="$t('outlookGroup')" min-width="130" />
      <el-table-column :label="$t('outlookTags')" min-width="180"><template #default="{ row }"><el-tag v-for="tag in row.tagNames" :key="tag" class="tag">{{ tag }}</el-tag></template></el-table-column>
      <el-table-column :label="$t('outlookSyncStatus')" width="120"><template #default="{ row }"><el-tag :type="statusType(row.syncStatus)">{{ statusLabel(row.syncStatus) }}</el-tag></template></el-table-column>
      <el-table-column prop="lastSyncTime" :label="$t('outlookLastSync')" min-width="170" />
      <el-table-column :label="$t('action')" width="210"><template #default="{ row }"><el-button v-perm="'outlook-account:set'" size="small" @click="openOrganization(row)">{{ $t('change') }}</el-button><el-button v-perm="'outlook-sync:run'" size="small" type="primary" :loading="syncingId === row.outlookAccountId" @click="sync(row)">{{ $t('outlookSync') }}</el-button><el-button v-perm="'outlook-account:delete'" size="small" type="danger" @click="remove(row)">{{ $t('delete') }}</el-button></template></el-table-column>
    </el-table>

    <el-dialog v-model="oauthVisible" :title="$t('outlookAuthorize')" width="440" @closed="resetOAuth">
      <el-form label-position="top"><el-form-item :label="$t('outlookClientId')"><el-input v-model="oauth.clientId" /></el-form-item><el-form-item :label="$t('outlookClientSecret')"><el-input v-model="oauth.clientSecret" show-password /></el-form-item></el-form>
      <template #footer><el-button @click="oauthVisible = false">{{ $t('cancel') }}</el-button><el-button type="primary" :loading="authorizing" @click="authorize">{{ $t('outlookAuthorize') }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="importVisible" :title="$t('outlookImport')" width="640" @closed="resetImport">
      <el-input v-model="importRows" type="textarea" :rows="8" :placeholder="$t('outlookImportRows')" />
      <el-table v-if="importResult" :data="[...importResult.imported, ...importResult.failed]" class="result-table"><el-table-column prop="line" label="#" width="60" /><el-table-column prop="email" :label="$t('emailAccount')" /><el-table-column prop="reason" :label="$t('outlookImportResult')" /></el-table>
      <template #footer><el-button @click="importVisible = false">{{ $t('cancel') }}</el-button><el-button type="primary" :loading="importing" @click="importAccounts">{{ $t('outlookImport') }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="organizationVisible" :title="$t('change')" width="460" @closed="selected = null">
      <el-form v-if="selected" label-position="top"><el-form-item :label="$t('outlookGroup')"><el-select v-model="organization.groupId" clearable><el-option v-for="group in groups" :key="group.outlookGroupId" :label="group.name" :value="group.outlookGroupId" /></el-select></el-form-item><el-form-item :label="$t('outlookTags')"><el-select v-model="organization.tagIds" multiple><el-option v-for="tag in tags" :key="tag.outlookTagId" :label="tag.name" :value="tag.outlookTagId" /></el-select></el-form-item></el-form>
      <template #footer><el-button @click="organizationVisible = false">{{ $t('cancel') }}</el-button><el-button type="primary" :loading="saving" @click="saveOrganization">{{ $t('save') }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { outlookAccountDelete, outlookAccountImport, outlookAccountList, outlookAccountSet, outlookOAuthStart, outlookSyncRun } from '@/request/outlook-account.js';
import { outlookGroupList } from '@/request/outlook-group.js';
import { outlookTagList } from '@/request/outlook-tag.js';
import { useAccountStore } from '@/store/account.js';

defineOptions({ name: 'outlook-accounts' });
const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const accountStore = useAccountStore();
const accounts = ref([]), groups = ref([]), tags = ref([]), loading = ref(false), syncingId = ref(null), oauthVisible = ref(false), importVisible = ref(false), organizationVisible = ref(false), authorizing = ref(false), importing = ref(false), saving = ref(false), selected = ref(null), importRows = ref(''), importResult = ref(null);
const oauth = reactive({ clientId: '', clientSecret: '' }); const organization = reactive({ groupId: null, tagIds: [] });
async function load() { loading.value = true; try { const [accountData, groupData, tagData] = await Promise.all([outlookAccountList(), outlookGroupList(), outlookTagList()]); accounts.value = accountData.list; groups.value = groupData.list; tags.value = tagData.list; } finally { loading.value = false; } }
function statusLabel(status) { return t(status === 'ready' ? 'outlookReady' : status === 'syncing' ? 'outlookSyncing' : 'outlookError'); }
function statusType(status) { return status === 'ready' ? 'success' : status === 'syncing' ? 'warning' : 'danger'; }
async function authorize() { authorizing.value = true; try { window.location.href = (await outlookOAuthStart(oauth)).authorizationUrl; } finally { authorizing.value = false; } }
function resetOAuth() { oauth.clientId = ''; oauth.clientSecret = ''; }
async function importAccounts() { importing.value = true; try { importResult.value = await outlookAccountImport(importRows.value); if (importResult.value.imported.length) { accountStore.refreshAccounts(); await load(); } } finally { importing.value = false; } }
function resetImport() { importRows.value = ''; importResult.value = null; }
function openOrganization(account) { selected.value = account; organization.groupId = account.groupId; organization.tagIds = [...account.tagIds]; organizationVisible.value = true; }
async function saveOrganization() { saving.value = true; try { await outlookAccountSet({ outlookAccountId: selected.value.outlookAccountId, groupId: organization.groupId || null, tagIds: organization.tagIds }); organizationVisible.value = false; await load(); } finally { saving.value = false; } }
async function sync(account) { syncingId.value = account.outlookAccountId; try { await outlookSyncRun({ outlookAccountId: account.outlookAccountId }); ElMessage.success(t('setSuccess')); await load(); } finally { syncingId.value = null; } }
async function remove(account) { await ElMessageBox.confirm(t('delConfirm', { msg: account.email }), { type: 'warning' }); await outlookAccountDelete(account.outlookAccountId); await load(); }
onMounted(async () => { if (route.query.oauth) { ElMessage[route.query.oauth === 'success' ? 'success' : 'error'](t(route.query.oauth === 'success' ? 'outlookOauthSuccess' : 'outlookOauthError')); if (route.query.oauth === 'success') accountStore.refreshAccounts(); await router.replace({ query: {} }); } await load(); });
</script>

<style scoped lang="scss">.outlook-page{padding:28px}.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.toolbar h2{margin:0}.toolbar p{margin:8px 0 0;color:var(--el-text-color-secondary)}.actions{display:flex;gap:8px}.tag{margin:2px}.result-table{margin-top:18px}.el-select{width:100%}@media(max-width:700px){.outlook-page{padding:16px}.toolbar{align-items:flex-start;gap:12px;flex-direction:column}}</style>
