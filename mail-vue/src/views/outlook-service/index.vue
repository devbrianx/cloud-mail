<template>
  <div class="outlook-page">
    <div class="toolbar"><div><h2>{{ $t('outlookMailService') }}</h2><p>{{ $t('outlookAccountPool') }}</p></div><div class="actions"><el-button :disabled="!selected" type="primary" :loading="syncing" @click="syncSelected">{{ $t('outlookSync') }}</el-button><el-button @click="load"><Icon icon="ion:reload" /></el-button></div></div>
    <el-table :data="accounts" v-loading="loading" highlight-current-row @current-change="select"><el-table-column prop="email" :label="$t('emailAccount')" min-width="240" /><el-table-column :label="$t('outlookSyncStatus')" width="140"><template #default="{ row }"><el-tag :type="statusType(row.syncStatus)">{{ statusLabel(row.syncStatus) }}</el-tag></template></el-table-column><el-table-column prop="syncError" :label="$t('outlookSyncError')" min-width="210" /><el-table-column prop="lastSyncTime" :label="$t('outlookLastSync')" min-width="180" /><el-table-column :label="$t('outlookReceivedCount')" width="150"><template #default="{ row }">{{ row.receivedCount ?? 0 }}</template></el-table-column><el-table-column :label="$t('action')" width="130"><template #default="{ row }"><el-button size="small" type="primary" :loading="syncingId === row.outlookAccountId" @click="sync(row)">{{ $t('outlookSync') }}</el-button></template></el-table-column></el-table>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { outlookAccountList, outlookSyncRun, outlookSyncStatus } from '@/request/outlook-account.js';

defineOptions({ name: 'outlook-service' });
const { t } = useI18n(); const accounts = ref([]), loading = ref(false), selected = ref(null), syncing = ref(false), syncingId = ref(null);
function statusLabel(status) { return t(status === 'ready' ? 'outlookReady' : status === 'syncing' ? 'outlookSyncing' : 'outlookError'); }
function statusType(status) { return status === 'ready' ? 'success' : status === 'syncing' ? 'warning' : 'danger'; }
async function load() { loading.value = true; try { const data = await outlookAccountList(); accounts.value = await Promise.all(data.list.map(async account => ({ ...account, ...(await outlookSyncStatus(account.outlookAccountId)) }))); } finally { loading.value = false; } }
function select(row) { selected.value = row; }
async function sync(account) { syncingId.value = account.outlookAccountId; if (selected.value?.outlookAccountId === account.outlookAccountId) syncing.value = true; try { await outlookSyncRun({ outlookAccountId: account.outlookAccountId }); ElMessage.success(t('setSuccess')); await load(); } finally { syncingId.value = null; syncing.value = false; } }
function syncSelected() { return sync(selected.value); }
onMounted(load);
</script>

<style scoped lang="scss">.outlook-page{padding:28px}.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.toolbar h2{margin:0}.toolbar p{margin:8px 0 0;color:var(--el-text-color-secondary)}.actions{display:flex;gap:8px}@media(max-width:700px){.outlook-page{padding:16px}.toolbar{align-items:flex-start;gap:12px;flex-direction:column}}</style>
