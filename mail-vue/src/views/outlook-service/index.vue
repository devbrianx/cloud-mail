<template>
  <div class="outlook-service">
    <div class="service-body">
      <aside class="mailbox-rail" v-loading="accountsLoading">
        <div class="rail-header">
          <el-select v-model="selectedGroupId" class="group-selector" clearable :placeholder="$t('outlookGroup')" :disabled="accountsLoading || reloading" @change="changeGroup">
            <el-option :label="$t('all')" :value="null" />
            <el-option v-for="group in groups" :key="group.outlookGroupId" :label="group.name" :value="group.outlookGroupId" />
          </el-select>
          <Icon class="icon" icon="ion:reload" width="18" :class="{ disabled: accountsLoading || reloading }" @click="reloadService" />
        </div>
        <el-input v-model="accountSearch" clearable class="account-search" :placeholder="$t('outlookSearchAccount')" :disabled="accountsLoading || reloading" @input="searchAccounts"><template #prefix><Icon icon="solar:magnifer-outline" /></template></el-input>

        <el-scrollbar class="mailbox-scrollbar">
          <div v-if="accounts.length" v-infinite-scroll="loadNextAccounts" :infinite-scroll-distance="600" :infinite-scroll-immediate="false" class="mailbox-list">
            <button v-for="account in accounts" :key="account.outlookAccountId" class="mailbox-card" :class="{ selected: account.outlookAccountId === selectedAccount?.outlookAccountId, unavailable: account.accountId === null }" :disabled="account.accountId === null" type="button" @click="selectAccount(account)">
              <span class="mailbox-email-row"><span class="mailbox-email">{{ account.email }}</span><Icon class="copy-icon" icon="fluent-color:clipboard-24" width="22" height="22" @click.stop="copyAccount(account.email)" /></span>
              <span v-if="account.tagNames?.length" class="mailbox-tags"><el-tag v-for="tag in account.tagNames" :key="tag" size="small" effect="plain">{{ tag }}</el-tag></span>
              <span class="mailbox-status">
                <el-tag size="small" :type="statusType(account)">{{ statusLabel(account) }}</el-tag>
                <span v-if="account.lastSyncTime" class="last-sync">{{ $t('outlookLastSync') }}: {{ account.lastSyncTime }}</span>
              </span>
              <span v-if="account.syncError" class="sync-error">{{ account.syncError }}</span>
            </button>
            <el-skeleton v-if="loadingNext" animated><template #template><div class="mailbox-loading"><el-skeleton-item variant="p" style="width: 70%" /><el-skeleton-item variant="text" style="width: 45%" /></div></template></el-skeleton>
            <div v-else-if="accounts.length >= accountTotal" class="no-more">{{ $t('noMoreData') }}</div>
          </div>
          <el-empty v-else-if="!accountsLoading" :description="$t('outlookNoAccounts')" :image-size="100" />
        </el-scrollbar>
      </aside>

      <section class="message-pane">
        <EmailContent v-if="selectedEmail" :email="selectedEmail" del-type="logic" :show-star="true" :show-reply="true" :show-unread="true" @close="selectedEmail = null" @deleted="handleDeleted" />
        <emailScroll v-if="selectedAccount" v-show="!selectedEmail" :key="selectedAccount.outlookAccountId" ref="messageScroll" :cancel-success="cancelStar" :star-success="addStar" :get-email-list="getEmailList" :email-delete="emailDelete" :email-read="emailRead" :star-add="starAdd" :star-cancel="starCancel" :time-sort="params.timeSort" :show-unread="true" :show-account-icon="false" action-left="4px" :refresh-before="refreshBefore" refresh-on-mount @jump="jumpContent">
          <template #first>
            <el-radio-group v-model="params.outlookFolder" size="small" @change="changeFolder">
              <el-radio-button value="inbox">{{ $t('inbox') }}</el-radio-button>
              <el-radio-button value="junkemail">{{ $t('junkEmail') }}</el-radio-button>
            </el-radio-group>
            <Icon v-if="params.timeSort === 0" class="icon" icon="material-symbols-light:timer-arrow-down-outline" width="28" height="28" @click="changeTimeSort" />
            <Icon v-else class="icon" icon="material-symbols-light:timer-arrow-up-outline" width="28" height="28" @click="changeTimeSort" />
          </template>
        </emailScroll>
        <el-empty v-else :description="$t('noMessagesFound')" />
      </section>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import emailScroll from '@/components/email-scroll/index.vue';
import EmailContent from '@/components/email-content/index.vue';
import { emailDelete, emailList, emailRead } from '@/request/email.js';
import { starAdd, starCancel } from '@/request/star.js';
import { outlookAccountList, outlookSyncRun } from '@/request/outlook-account.js';
import { outlookGroupList } from '@/request/outlook-group.js';
import { useEmailStore } from '@/store/email.js';

defineOptions({ name: 'outlook-service' });

const { t } = useI18n();
const emailStore = useEmailStore();
const groups = ref([]);
const accounts = ref([]);
const accountTotal = ref(0);
const selectedGroupId = ref(null);
const accountSearch = ref('');
const selectedAccount = ref(null);
const selectedEmail = ref(null);
const accountsLoading = ref(false);
const loadingNext = ref(false);
const reloading = ref(false);
const messageScroll = ref(null);
const params = reactive({ timeSort: 0, outlookFolder: 'inbox' });
const refreshingAccountId = ref(null);
let accountSearchTimer = null;
const accountPageSize = 15;
let accountRequestVersion = 0;

function statusLabel(account) {
  if (account.accountId === null) return t('outlookError');
  if (refreshingAccountId.value === account.outlookAccountId || account.syncStatus === 'syncing') return t('outlookSyncing');
  return t(account.syncStatus === 'ready' ? 'outlookReady' : 'outlookError');
}

function statusType(account) {
  if (account.accountId === null) return 'danger';
  if (refreshingAccountId.value === account.outlookAccountId || account.syncStatus === 'syncing') return 'warning';
  return account.syncStatus === 'ready' ? 'success' : 'danger';
}

async function copyAccount(email) {
  try {
    await navigator.clipboard.writeText(email);
    ElMessage({ message: t('copySuccessMsg'), type: 'success', plain: true });
  } catch (error) {
    console.error(`${t('copyFailMsg')}:`, error);
    ElMessage({ message: t('copyFailMsg'), type: 'error', plain: true });
  }
}

async function loadGroups() {
  const data = await outlookGroupList();
  groups.value = data.list;
  return data.list;
}

function accountParams(groupId, offset, extra = {}) {
  return { ...(groupId === null ? {} : { groupId }), ...(accountSearch.value.trim() ? { q: accountSearch.value.trim() } : {}), limit: accountPageSize, offset, ...extra };
}

async function loadAccounts(groupId = selectedGroupId.value, preserveSelection = false) {
  const requestVersion = ++accountRequestVersion;
  const selectedId = preserveSelection ? selectedAccount.value?.outlookAccountId : null;
  accountsLoading.value = true;
  accounts.value = [];
  accountTotal.value = 0;
  try {
    const firstPage = await outlookAccountList(accountParams(groupId, 0));
    const selectedData = selectedId == null ? null : await outlookAccountList(accountParams(groupId, 0, { outlookAccountId: selectedId }));
    if (requestVersion !== accountRequestVersion || groupId !== selectedGroupId.value) return false;
    accounts.value = firstPage.list;
    accountTotal.value = firstPage.total;
    selectedAccount.value = selectedData?.list[0] || null;
    if (!selectedAccount.value) selectedEmail.value = null;
    return selectedAccount.value !== null;
  } finally {
    if (requestVersion === accountRequestVersion && groupId === selectedGroupId.value) accountsLoading.value = false;
  }
}

async function loadNextAccounts() {
  if (accountsLoading.value || loadingNext.value || reloading.value || accounts.value.length >= accountTotal.value) return;
  const requestVersion = accountRequestVersion;
  const groupId = selectedGroupId.value;
  loadingNext.value = true;
  try {
    const data = await outlookAccountList(accountParams(groupId, accounts.value.length));
    if (requestVersion !== accountRequestVersion || groupId !== selectedGroupId.value) return;
    accounts.value.push(...data.list);
    accountTotal.value = data.total;
  } finally {
    if (requestVersion === accountRequestVersion) loadingNext.value = false;
  }
}

async function changeGroup(value) {
  const groupId = value ?? null;
  selectedGroupId.value = groupId;
  selectedAccount.value = null;
  selectedEmail.value = null;
  await loadAccounts(groupId);
}

function searchAccounts() {
  if (accountSearchTimer) clearTimeout(accountSearchTimer);
  accountSearchTimer = setTimeout(async () => {
    selectedAccount.value = null;
    selectedEmail.value = null;
    await loadAccounts(selectedGroupId.value);
  }, 200);
}

function selectAccount(account) {
  if (account.accountId === null || reloading.value) return;
  if (selectedAccount.value?.outlookAccountId !== account.outlookAccountId) {
    params.timeSort = 0;
  }
  selectedEmail.value = null;
  selectedAccount.value = account;
}

function changeTimeSort() {
  params.timeSort = params.timeSort ? 0 : 1;
  messageScroll.value?.refreshList();
}

function getEmailList(emailId, size) {
  const accountId = selectedAccount.value?.accountId;
  if (accountId == null) return Promise.resolve({ list: [], total: 0, latestEmail: { emailId: 0 } });
  return emailList(accountId, 0, emailId, params.timeSort, size, 0, true, params.outlookFolder);
}

function changeFolder() {
  messageScroll.value?.refreshList();
}

function jumpContent(email) {
  selectedEmail.value = email;
}

function handleDeleted(emailId) {
  emailStore.deleteIds = [emailId];
  selectedEmail.value = null;
}

function addStar(email) {
  emailStore.starScroll?.addItem(email);
}

function cancelStar(email) {
  emailStore.starScroll?.deleteEmail([email.emailId]);
}

async function refreshBefore() {
  const outlookAccountId = selectedAccount.value?.outlookAccountId;
  if (!outlookAccountId) return false;
  refreshingAccountId.value = outlookAccountId;
  try {
    const result = await outlookSyncRun({ outlookAccountId });
    if (selectedAccount.value?.outlookAccountId !== outlookAccountId) return false;

    const listAccount = accounts.value.find(item => item.outlookAccountId === outlookAccountId);
    if (listAccount) {
      listAccount.syncStatus = 'ready';
      listAccount.syncError = '';
      if (result.lastSyncTime) listAccount.lastSyncTime = result.lastSyncTime;
    }
    selectedAccount.value.syncStatus = 'ready';
    selectedAccount.value.syncError = '';
    if (result.lastSyncTime) selectedAccount.value.lastSyncTime = result.lastSyncTime;
    return true;
  } catch (error) {
    console.error('Outlook synchronization failed', error);
    return false;
  } finally {
    if (refreshingAccountId.value === outlookAccountId) refreshingAccountId.value = null;
  }
}

async function reloadService() {
  if (reloading.value) return;
  reloading.value = true;
  try {
    const groupList = await loadGroups();
    if (selectedGroupId.value !== null && !groupList.some(group => group.outlookGroupId === selectedGroupId.value)) {
      selectedGroupId.value = null;
      selectedAccount.value = null;
      selectedEmail.value = null;
      accounts.value = [];
    }

    const retained = await loadAccounts(selectedGroupId.value, true);
    if (retained && !selectedEmail.value) {
      await nextTick();
      messageScroll.value?.refreshList();
    }

  } finally {
    reloading.value = false;
  }
}

onBeforeUnmount(() => {
  if (accountSearchTimer) clearTimeout(accountSearchTimer);
});

onMounted(async () => {
  await Promise.all([loadGroups(), loadAccounts()]);
});
</script>

<style scoped lang="scss">
.outlook-service { display: grid; grid-template-rows: minmax(0, 1fr); height: 100%; overflow: hidden; }
.service-body { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; }
.mailbox-rail { display: grid; grid-template-rows: auto auto minmax(0, 1fr); min-height: 0; border-right: 1px solid var(--el-border-color); background: var(--el-bg-color); }
.rail-header { display: flex; align-items: center; justify-content: space-between; min-height: 38px; gap: 8px; padding: 8px 10px; box-shadow: var(--header-actions-border); }
.group-selector { min-width: 0; flex: 1; }
.icon { cursor: pointer; }
.icon.disabled { cursor: not-allowed; opacity: 0.5; }
.mailbox-scrollbar { min-height: 0; }
.account-search { width: 100%; padding: 8px 10px; box-sizing: border-box; }
.mailbox-loading { display: grid; gap: 8px; min-height: 58px; padding: 12px 10px; }
.no-more { padding: 12px; color: var(--secondary-text-color); font-size: 12px; text-align: center; }
.mailbox-list { padding: 10px; }
.mailbox-card { display: flex; width: 100%; flex-direction: column; gap: 7px; margin-bottom: 10px; padding: 12px 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-bg-color); color: var(--el-text-color-primary); text-align: left; cursor: pointer; }
.mailbox-card:hover:not(:disabled), .mailbox-card.selected { background: var(--choose-account-background); }
.mailbox-card.unavailable, .mailbox-card:disabled { cursor: not-allowed; opacity: 0.7; }
.mailbox-email-row { display: flex; min-width: 0; align-items: center; gap: 6px; }
.mailbox-email { min-width: 0; flex: 1; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.copy-icon { flex: none; cursor: pointer; }
.mailbox-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.mailbox-status { display: flex; min-width: 0; align-items: center; gap: 6px; }
.last-sync, .sync-error { overflow: hidden; color: var(--secondary-text-color); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.sync-error { color: var(--el-color-danger); }
.message-pane { min-width: 0; min-height: 0; overflow: hidden; }
@media (max-width: 767px) { .service-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(220px, 40%) minmax(0, 1fr); } .mailbox-rail { border-right: 0; border-bottom: 1px solid var(--el-border-color); } }
</style>
