<template>
  <div class="temporary-message" v-loading="loading">
    <div class="header-actions">
      <Icon class="icon" icon="material-symbols-light:arrow-back-ios-new" width="20" height="20" @click="goBack" />
    </div>
    <el-scrollbar class="scrollbar">
      <article v-if="message" class="container">
        <h1>{{ message.subject || $t('noSubject') }}</h1>
        <div class="metadata">
          <p><strong>{{ $t('sender') }}:</strong> {{ message.from.name || message.from.address }} &lt;{{ message.from.address }}&gt;</p>
          <p><strong>{{ $t('recipient') }}:</strong> {{ recipients }}</p>
          <p><strong>{{ $t('date') }}:</strong> {{ formatDetailDate(message.createdAt) }}</p>
          <p v-if="message.verificationCode"><strong>{{ $t('codeLabel') }}</strong>{{ message.verificationCode }}</p>
        </div>
        <div class="message-content">
          <ShadowHtml v-if="message.html?.[0]" :html="message.html[0]" />
          <pre v-else>{{ message.text }}</pre>
        </div>
        <section v-if="message.attachments?.length" class="attachments">
          <h2>{{ $t('attachments') }}</h2>
          <div v-for="attachment in message.attachments" :key="attachment.id" class="attachment">
            <span>{{ attachment.filename }}</span>
            <span>{{ attachment.contentType }}</span>
            <span>{{ formatBytes(attachment.size) }}</span>
          </div>
        </section>
      </article>
    </el-scrollbar>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import ShadowHtml from '@/components/shadow-html/index.vue';
import { tempInboxMessage } from '@/request/temp-inbox.js';
import { formatDetailDate } from '@/utils/day.js';
import { formatBytes } from '@/utils/file-utils.js';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'temp-inbox-message' });

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const loading = ref(false);
const message = ref(null);
const recipients = computed(() => (message.value?.to || []).map(item => item.address).join(', '));

function inboxId() {
  return String(route.params.inboxId);
}

function messageId() {
  return String(route.params.messageId);
}

function goBack() {
  router.push({ name: 'temp-inbox', query: { inbox: inboxId() } });
}

async function load() {
  const requestInboxId = inboxId();
  const requestMessageId = messageId();
  loading.value = true;
  try {
    const data = await tempInboxMessage(requestInboxId, requestMessageId);
    if (inboxId() === requestInboxId && messageId() === requestMessageId) message.value = data;
  } catch (error) {
    if (error?.code === 404) router.replace({ name: 'temp-inbox', query: { inbox: requestInboxId } });
  } finally {
    if (inboxId() === requestInboxId && messageId() === requestMessageId) loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped lang="scss">
.temporary-message { height: 100%; }
.header-actions { height: 44px; display: flex; align-items: center; padding: 0 20px; border-bottom: 1px solid var(--el-border-color-lighter); }
.icon { cursor: pointer; }
.scrollbar { height: calc(100% - 44px); }
.container { max-width: 960px; padding: 28px; margin: 0 auto; }
h1 { margin: 0 0 20px; font-size: 24px; word-break: break-word; }
.metadata { padding-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); color: var(--el-text-color-secondary); }
.metadata p { margin: 8px 0; word-break: break-word; }
.message-content { min-height: 240px; padding: 24px 0; }
.message-content pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
.attachments { border-top: 1px solid var(--el-border-color-lighter); padding-top: 20px; }
.attachments h2 { margin: 0 0 12px; font-size: 18px; }
.attachment { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, auto) auto; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); word-break: break-word; }
@media (max-width: 767px) { .container { padding: 20px; } .attachment { grid-template-columns: 1fr; gap: 4px; } }
</style>
