<template>
  <div class="temporary-inboxes">
    <section class="mailbox-panel">
      <div class="panel-header">
        <h2>{{ $t('temporaryInboxes') }}</h2>
        <div class="panel-actions">
          <el-button :disabled="!selectedInboxIds.length" type="danger" :loading="deleting" @click="deleteSelected">{{ $t('delete') }}</el-button>
          <el-button @click="loadInboxes">{{ $t('refresh') }}</el-button>
        </div>
      </div>
      <div v-if="inboxes.length" class="select-all">
        <el-checkbox :model-value="allSelected" :indeterminate="someSelected" @update:model-value="toggleAll">{{ $t('select') }}</el-checkbox>
      </div>
      <el-scrollbar v-loading="loadingInboxes" class="inbox-list">
        <article v-for="inbox in inboxes" :key="inbox.id" class="inbox-card" :class="{ selected: selectedInbox?.id === inbox.id }" @click="selectInbox(inbox)">
          <el-checkbox :model-value="selectedInboxIds.includes(inbox.id)" @click.stop @update:model-value="toggleInbox(inbox.id, $event)" />
          <div class="inbox-card-content">
            <strong>{{ inbox.address }}</strong>
            <span>{{ $t('messageCount') }}: {{ inbox.messageCount }}</span>
            <span>{{ $t('expiresAt') }}: {{ formatDetailDate(inbox.expiresAt) }}</span>
          </div>
        </article>
      </el-scrollbar>
      <el-pagination v-if="total > pageSize" background layout="prev, pager, next" :page-size="pageSize" :total="total" :current-page="page + 1" @current-change="changePage" />
      <el-empty v-if="!loadingInboxes && !inboxes.length" :description="$t('temporaryInboxesEmpty')" />
    </section>

    <section v-if="selectedInbox" class="message-panel" v-loading="loadingMessage">
      <template v-if="message">
        <div class="panel-header">
          <el-button link @click="closeMessage">{{ $t('back') }}</el-button>
          <h2>{{ message.subject || $t('noSubject') }}</h2>
        </div>
        <p><strong>{{ $t('sender') }}:</strong> {{ message.from.name || message.from.address }} &lt;{{ message.from.address }}&gt;</p>
        <p><strong>{{ $t('recipient') }}:</strong> {{ recipients }}</p>
        <p><strong>{{ $t('date') }}:</strong> {{ formatDetailDate(message.createdAt) }}</p>
        <p v-if="message.verificationCode"><strong>{{ $t('codeLabel') }}</strong>{{ message.verificationCode }}</p>
        <ShadowHtml v-if="message.html?.[0]" :html="message.html[0]" class="message-content" />
        <pre v-else class="message-content">{{ message.text }}</pre>
        <section v-if="message.attachments?.length" class="attachments">
          <h3>{{ $t('attachments') }}</h3>
          <div v-for="attachment in message.attachments" :key="attachment.id" class="attachment">{{ attachment.filename }} · {{ attachment.contentType }} · {{ formatBytes(attachment.size) }}</div>
        </section>
      </template>
      <template v-else>
        <div class="panel-header"><h2>{{ selectedInbox.address }}</h2></div>
        <el-table :data="messages" v-loading="loadingMessages" @row-click="openMessage">
          <el-table-column prop="from.name" :label="$t('sender')" min-width="180">
            <template #default="{ row }">{{ row.from.name || row.from.address }}</template>
          </el-table-column>
          <el-table-column prop="subject" :label="$t('subject')" min-width="220" />
          <el-table-column :label="$t('date')" width="140">
            <template #default="{ row }">{{ fromNow(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loadingMessages && !messages.length" :description="$t('noMessagesFound')" />
      </template>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute } from 'vue-router';
import ShadowHtml from '@/components/shadow-html/index.vue';
import { tempInboxDelete, tempInboxList, tempInboxMessage, tempInboxMessages } from '@/request/temp-inbox.js';
import { formatDetailDate, fromNow } from '@/utils/day.js';
import { formatBytes } from '@/utils/file-utils.js';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'temp-inbox' });

const { t } = useI18n();
const route = useRoute();
const pageSize = 50;
const page = ref(0);
const total = ref(0);
const inboxes = ref([]);
const messages = ref([]);
const selectedInbox = ref(null);
const selectedInboxIds = ref([]);
const selectedMessageId = ref(null);
const message = ref(null);
const loadingInboxes = ref(false);
const loadingMessages = ref(false);
const loadingMessage = ref(false);
const deleting = ref(false);
const recipients = computed(() => (message.value?.to || []).map(item => item.address).join(', '));
const allSelected = computed(() => inboxes.value.length > 0 && inboxes.value.every(inbox => selectedInboxIds.value.includes(inbox.id)));
const someSelected = computed(() => selectedInboxIds.value.length > 0 && !allSelected.value);

function clearSelection() {
  selectedInbox.value = null;
  selectedMessageId.value = null;
  messages.value = [];
  message.value = null;
}

function toggleInbox(inboxId, selected) {
  selectedInboxIds.value = selected ? [...new Set([...selectedInboxIds.value, inboxId])] : selectedInboxIds.value.filter(id => id !== inboxId);
}

function toggleAll(selected) {
  selectedInboxIds.value = selected ? inboxes.value.map(inbox => inbox.id) : [];
}

async function loadInboxes() {
  loadingInboxes.value = true;
  try {
    const data = await tempInboxList({ limit: pageSize, offset: page.value * pageSize });
    inboxes.value = data.list;
    total.value = data.total;
    selectedInboxIds.value = selectedInboxIds.value.filter(id => data.list.some(inbox => inbox.id === id));
    if (!data.list.length && page.value > 0) {
      page.value--;
      await loadInboxes();
      return;
    }
    const requestedInbox = typeof route.query.inbox === 'string' ? route.query.inbox : null;
    const inbox = data.list.find(item => item.id === selectedInbox.value?.id)
      || data.list.find(item => item.id === requestedInbox)
      || data.list[0];
    if (inbox) await selectInbox(inbox);
    else clearSelection();
  } finally {
    loadingInboxes.value = false;
  }
}

async function selectInbox(inbox) {
  if (selectedInbox.value?.id === inbox.id && messages.value.length) return;
  selectedInbox.value = inbox;
  selectedMessageId.value = null;
  message.value = null;
  messages.value = [];
  await loadMessages(inbox);
}

async function loadMessages(inbox) {
  loadingMessages.value = true;
  try {
    const data = await tempInboxMessages(inbox.id, { limit: 100, offset: 0 });
    if (selectedInbox.value?.id === inbox.id) messages.value = data.messages;
  } catch (error) {
    if (error?.code === 404 && selectedInbox.value?.id === inbox.id) {
      clearSelection();
      await loadInboxes();
    }
  } finally {
    if (selectedInbox.value?.id === inbox.id) loadingMessages.value = false;
  }
}

async function openMessage(row) {
  const inboxId = selectedInbox.value?.id;
  if (!inboxId) return;
  selectedMessageId.value = row.id;
  loadingMessage.value = true;
  try {
    const data = await tempInboxMessage(inboxId, row.id);
    if (selectedInbox.value?.id === inboxId && selectedMessageId.value === row.id) message.value = data;
  } catch (error) {
    if (error?.code === 404 && selectedInbox.value?.id === inboxId && selectedMessageId.value === row.id) {
      closeMessage();
      await loadMessages(selectedInbox.value);
    }
  } finally {
    if (selectedInbox.value?.id === inboxId && selectedMessageId.value === row.id) loadingMessage.value = false;
  }
}

function closeMessage() {
  selectedMessageId.value = null;
  message.value = null;
}

async function deleteSelected() {
  await ElMessageBox.confirm(t('deleteTemporaryInboxesWarning'), { type: 'warning', confirmButtonText: t('confirm'), cancelButtonText: t('cancel') });
  const inboxIds = [...selectedInboxIds.value];
  deleting.value = true;
  try {
    await tempInboxDelete(inboxIds);
    ElMessage({ type: 'success', message: t('delSuccessMsg') });
    selectedInboxIds.value = [];
    if (selectedInbox.value && inboxIds.includes(selectedInbox.value.id)) clearSelection();
    await loadInboxes();
  } finally {
    deleting.value = false;
  }
}

function changePage(value) {
  page.value = value - 1;
  clearSelection();
  loadInboxes();
}

watch(() => route.query.inbox, () => {
  const requestedInbox = typeof route.query.inbox === 'string' ? route.query.inbox : null;
  const inbox = inboxes.value.find(item => item.id === requestedInbox);
  if (inbox && inbox.id !== selectedInbox.value?.id) selectInbox(inbox);
});

loadInboxes();
</script>

<style scoped lang="scss">
.temporary-inboxes { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); height: 100%; overflow: hidden; }
.mailbox-panel, .message-panel { min-width: 0; padding: 20px; overflow: auto; border-right: 1px solid var(--el-border-color-lighter); }
.message-panel { border-right: 0; }
.panel-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
.panel-header h2 { margin: 0; font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-actions { display: flex; gap: 8px; }
.select-all { margin-bottom: 10px; }
.inbox-list { max-height: calc(100% - 124px); }
.inbox-card { display: flex; gap: 10px; align-items: flex-start; padding: 12px; margin-bottom: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; cursor: pointer; }
.inbox-card.selected { background: var(--choose-account-background); }
.inbox-card-content { display: grid; gap: 6px; min-width: 0; color: var(--el-text-color-secondary); font-size: 13px; }
.inbox-card-content strong { overflow: hidden; color: var(--el-text-color-primary); text-overflow: ellipsis; white-space: nowrap; }
.message-content { min-height: 240px; margin: 20px 0; white-space: pre-wrap; word-break: break-word; }
.attachments { border-top: 1px solid var(--el-border-color-lighter); padding-top: 16px; }
.attachments h3 { margin-top: 0; }
.attachment { padding: 8px 0; word-break: break-word; }
@media (max-width: 767px) { .temporary-inboxes { grid-template-columns: 1fr; overflow: auto; } .mailbox-panel, .message-panel { min-height: 280px; border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); } }
</style>
