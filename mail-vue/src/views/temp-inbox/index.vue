<template>
  <div class="temporary-inboxes">
    <section class="mailbox-panel">
      <div class="panel-header">
        <h2>{{ $t('temporaryInboxes') }}</h2>
        <div class="panel-actions">
          <el-button :disabled="!selectedInboxIds.length" type="danger" :loading="deleting" @click="deleteSelected">
            {{ $t('delete') }}
          </el-button>
          <el-button @click="loadInboxes">{{ $t('refresh') }}</el-button>
        </div>
      </div>
      <el-table ref="inboxTable" :data="inboxes" v-loading="loadingInboxes" @selection-change="selectedInboxIds = $event.map(item => item.id)" @row-click="selectInbox">
        <el-table-column type="selection" width="44" />
        <el-table-column prop="address" :label="$t('emailAccount')" min-width="190" />
        <el-table-column prop="messageCount" :label="$t('messageCount')" width="98" />
        <el-table-column :label="$t('expiresAt')" min-width="165">
          <template #default="{ row }">{{ formatDetailDate(row.expiresAt) }}</template>
        </el-table-column>
      </el-table>
      <el-pagination v-if="total > pageSize" background layout="prev, pager, next" :page-size="pageSize" :total="total" :current-page="page + 1" @current-change="changePage" />
      <el-empty v-if="!loadingInboxes && !inboxes.length" :description="$t('temporaryInboxesEmpty')" />
    </section>

    <section class="message-panel">
      <div class="panel-header"><h2>{{ selectedInbox?.address || $t('selectTemporaryInbox') }}</h2></div>
      <el-table :data="messages" v-loading="loadingMessages" @row-click="selectMessage">
        <el-table-column prop="from.name" :label="$t('sender')" min-width="140">
          <template #default="{ row }">{{ row.from.name || row.from.address }}</template>
        </el-table-column>
        <el-table-column prop="subject" :label="$t('subject')" min-width="180" />
        <el-table-column :label="$t('date')" width="120">
          <template #default="{ row }">{{ fromNow(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="selectedInbox && !loadingMessages && !messages.length" :description="$t('noMessagesFound')" />
      <el-empty v-if="!selectedInbox" :description="$t('selectTemporaryInbox')" />
    </section>

    <section class="content-panel" v-loading="loadingMessage">
      <template v-if="message">
        <h2>{{ message.subject || $t('noSubject') }}</h2>
        <p><strong>{{ $t('sender') }}:</strong> {{ message.from.name || message.from.address }} &lt;{{ message.from.address }}&gt;</p>
        <p><strong>{{ $t('recipient') }}:</strong> {{ recipients }}</p>
        <p><strong>{{ $t('date') }}:</strong> {{ formatDetailDate(message.createdAt) }}</p>
        <p v-if="message.verificationCode"><strong>{{ $t('codeLabel') }}</strong>{{ message.verificationCode }}</p>
        <ShadowHtml v-if="message.html?.[0]" :html="message.html[0]" />
        <pre v-else>{{ message.text }}</pre>
        <div v-if="message.attachments?.length" class="attachments">
          <h3>{{ $t('attachments') }}</h3>
          <div v-for="attachment in message.attachments" :key="attachment.id">{{ attachment.filename }} · {{ attachment.contentType }} · {{ formatBytes(attachment.size) }}</div>
        </div>
      </template>
      <el-empty v-else :description="$t('selectTemporaryMessage')" />
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import ShadowHtml from '@/components/shadow-html/index.vue';
import { tempInboxDelete, tempInboxList, tempInboxMessage, tempInboxMessages } from '@/request/temp-inbox.js';
import { formatDetailDate, fromNow } from '@/utils/day.js';
import { formatBytes } from '@/utils/file-utils.js';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'temp-inbox' });

const { t } = useI18n();
const pageSize = 50;
const page = ref(0);
const total = ref(0);
const inboxes = ref([]);
const messages = ref([]);
const selectedInbox = ref(null);
const message = ref(null);
const selectedInboxIds = ref([]);
const selectedMessageId = ref(null);
const loadingInboxes = ref(false);
const loadingMessages = ref(false);
const loadingMessage = ref(false);
const deleting = ref(false);
const recipients = computed(() => (message.value?.to || []).map(item => item.address).join(', '));

async function loadInboxes() {
  loadingInboxes.value = true;
  try {
    const data = await tempInboxList({ limit: pageSize, offset: page.value * pageSize });
    inboxes.value = data.list;
    total.value = data.total;
    if (selectedInbox.value && !inboxes.value.some(item => item.id === selectedInbox.value.id)) clearSelection();
    if (!inboxes.value.length && page.value > 0) {
      page.value--;
      await loadInboxes();
    }
  } finally {
    loadingInboxes.value = false;
  }
}

function clearSelection() {
  selectedInbox.value = null;
  selectedMessageId.value = null;
  messages.value = [];
  message.value = null;
}

async function selectInbox(inbox) {
  if (selectedInbox.value?.id === inbox.id) return;
  selectedInbox.value = inbox;
  selectedMessageId.value = null;
  message.value = null;
  await loadMessages(inbox);
}

async function loadMessages(inbox) {
  loadingMessages.value = true;
  try {
    const data = await tempInboxMessages(inbox.id, { limit: 100, offset: 0 });
    if (selectedInbox.value?.id === inbox.id) messages.value = data.messages;
  } catch (error) {
    if (error?.code === 404) await loadInboxes();
  } finally {
    if (selectedInbox.value?.id === inbox.id) loadingMessages.value = false;
  }
}

async function selectMessage(row) {
  const inboxId = selectedInbox.value?.id;
  if (!inboxId) return;
  selectedMessageId.value = row.id;
  loadingMessage.value = true;
  try {
    const data = await tempInboxMessage(inboxId, row.id);
    if (selectedInbox.value?.id === inboxId && selectedMessageId.value === row.id) message.value = data;
  } catch (error) {
    if (error?.code === 404 && selectedInbox.value?.id === inboxId && selectedMessageId.value === row.id) {
      message.value = null;
      await loadMessages(selectedInbox.value);
    }
  } finally {
    if (selectedInbox.value?.id === inboxId && selectedMessageId.value === row.id) loadingMessage.value = false;
  }
}

async function deleteSelected() {
  await ElMessageBox.confirm(t('deleteTemporaryInboxesWarning'), { type: 'warning', confirmButtonText: t('confirm'), cancelButtonText: t('cancel') });
  const inboxIds = [...selectedInboxIds.value];
  deleting.value = true;
  try {
    const { deleted } = await tempInboxDelete(inboxIds);
    ElMessage({ type: 'success', message: t('delSuccessMsg') });
    selectedInboxIds.value = [];
    if (selectedInbox.value && inboxIds.includes(selectedInbox.value.id)) clearSelection();
    if (!deleted) clearSelection();
    await loadInboxes();
  } finally {
    deleting.value = false;
  }
}

function changePage(value) {
  page.value = value - 1;
  loadInboxes();
}

loadInboxes();
</script>

<style scoped lang="scss">
.temporary-inboxes { display: grid; grid-template-columns: minmax(280px, .9fr) minmax(320px, 1fr) minmax(360px, 1.3fr); height: 100%; overflow: hidden; }
.mailbox-panel, .message-panel, .content-panel { min-width: 0; padding: 20px; overflow: auto; border-right: 1px solid var(--el-border-color-lighter); }
.content-panel { border-right: 0; }
.panel-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
.panel-header h2, .content-panel h2 { margin: 0; font-size: 18px; }
.panel-actions { display: flex; gap: 8px; }
.content-panel p { margin: 8px 0; word-break: break-word; }
.content-panel pre { white-space: pre-wrap; word-break: break-word; }
.attachments { margin-top: 20px; }
@media (max-width: 1100px) { .temporary-inboxes { grid-template-columns: 1fr; overflow: auto; } .mailbox-panel, .message-panel, .content-panel { min-height: 280px; border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); } }
</style>
