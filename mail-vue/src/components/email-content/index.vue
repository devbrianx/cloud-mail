<template>
  <div class="box">
    <div class="header-actions">
      <Icon class="icon" icon="material-symbols-light:arrow-back-ios-new" width="20" @click="emit('close')" />
      <Icon v-perm="'email:delete'" class="icon" icon="uiw:delete" width="16" @click="handleDelete" />
      <span v-if="showStar" class="star">
        <Icon v-if="email.isStar" class="icon" icon="fluent-color:star-16" width="20" @click="changeStar" />
        <Icon v-else class="icon" icon="solar:star-line-duotone" width="18" @click="changeStar" />
      </span>
      <Icon v-if="showReply" v-perm="'email:send'" class="icon" icon="la:reply" width="21" @click="openReply" />
      <Icon v-if="showReply" v-perm="'email:send'" class="icon" icon="iconoir:arrow-up-right" width="20" @click="openForward" />
    </div>
    <el-scrollbar class="scrollbar">
      <div class="container">
        <div class="email-title">{{ email.subject }}</div>
        <div class="content">
          <div class="email-info">
            <div class="send"><span class="source">{{ $t('from') }}</span><div class="send-name"><span class="send-name-title">{{ email.name }}</span><span>&lt;{{ email.sendEmail }}&gt;</span></div></div>
            <div class="receive"><span class="source">{{ $t('recipient') }}</span><span class="receive-email">{{ formatReceive(email.recipient) }}</span></div>
            <div class="date">{{ formatDetailDate(email.createTime) }}</div>
            <el-alert v-if="email.status === 3" :closable="false" :title="toMessage(email.message)" class="email-msg" type="error" show-icon />
            <el-alert v-if="email.status === 4" :closable="false" :title="$t('complained')" class="email-msg" type="warning" show-icon />
            <el-alert v-if="email.status === 5" :closable="false" :title="$t('delayed')" class="email-msg" type="warning" show-icon />
          </div>
          <el-scrollbar class="html-scrollbar" :class="email.attList.length === 0 ? 'bottom-distance' : ''">
            <ShadowHtml v-if="email.content" class="shadow-html" :html="formatImage(email.content)" />
            <pre v-else class="email-text">{{ email.text }}</pre>
          </el-scrollbar>
          <div v-if="email.attList.length > 0" class="att">
            <div class="att-title"><span>{{ $t('attachments') }}</span><span>{{ $t('attCount', { total: email.attList.length }) }}</span></div>
            <div class="att-box">
              <div v-for="att in email.attList" :key="att.attId" class="att-item">
                <div class="att-icon" @click="showImage(att.key)"><Icon v-bind="getIconByName(att.filename)" /></div>
                <div class="att-name" @click="showImage(att.key)">{{ att.filename }}</div>
                <div class="att-size">{{ formatBytes(att.size) }}</div>
                <div class="opt-icon att-icon"><Icon v-if="isImage(att.filename)" icon="hugeicons:view" width="22" height="22" @click="showImage(att.key)" /><a :href="cvtR2Url(att.key)" download><Icon icon="system-uicons:push-down" width="22" height="22" /></a></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-scrollbar>
    <el-image-viewer v-if="showPreview" :url-list="srcList" show-progress @close="showPreview = false" />
  </div>
</template>

<script setup>
import ShadowHtml from '@/components/shadow-html/index.vue';
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { emailDelete, emailRead } from '@/request/email.js';
import { Icon } from '@iconify/vue';
import { useEmailStore } from '@/store/email.js';
import { formatDetailDate } from '@/utils/day.js';
import { starAdd, starCancel } from '@/request/star.js';
import { getExtName, formatBytes } from '@/utils/file-utils.js';
import { cvtR2Url, toOssDomain } from '@/utils/convert.js';
import { getIconByName } from '@/utils/icon-utils.js';
import { useSettingStore } from '@/store/setting.js';
import { allEmailDelete } from '@/request/all-email.js';
import { useUiStore } from '@/store/ui.js';
import { useI18n } from 'vue-i18n';
import { EmailUnreadEnum } from '@/enums/email-enum.js';

const props = defineProps({
  email: { type: Object, required: true },
  delType: { type: String, required: true },
  showStar: { type: Boolean, default: true },
  showReply: { type: Boolean, default: true },
  showUnread: { type: Boolean, default: false }
});
const emit = defineEmits(['close', 'deleted']);
const emailStore = useEmailStore();
const settingStore = useSettingStore();
const uiStore = useUiStore();
const { t } = useI18n();
const showPreview = ref(false);
const srcList = reactive([]);
function toMessage(message) { try { return message ? JSON.parse(message).message : ''; } catch { return ''; } }
onMounted(() => {
  if (props.showUnread && props.email.unread === EmailUnreadEnum.UNREAD) {
    props.email.unread = EmailUnreadEnum.READ;
    emailRead([props.email.emailId]);
  }
});

function openReply() { uiStore.writerRef.openReply(props.email); }
function openForward() { uiStore.writerRef.openForward(props.email); }
function formatImage(content) { return (content || '').replace(/{{domain}}/g, `${toOssDomain(settingStore.settings.r2Domain)}/`); }
function isImage(filename) { return ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'jfif'].includes(getExtName(filename)); }
function showImage(key) { if (!isImage(key)) return; srcList.length = 0; srcList.push(cvtR2Url(key)); showPreview.value = true; }
function formatReceive(recipient) { try { return JSON.parse(recipient).map(item => item.address).join(', '); } catch { return ''; } }

function changeStar() {
  const email = props.email;
  if (email.isStar) {
    email.isStar = 0;
    starCancel(email.emailId).then(() => { emailStore.cancelStarEmailId = email.emailId; setTimeout(() => emailStore.cancelStarEmailId = 0); emailStore.starScroll?.deleteEmail([email.emailId]); }).catch(error => { console.error(error); email.isStar = 1; });
  } else {
    email.isStar = 1;
    starAdd(email.emailId).then(() => { emailStore.addStarEmailId = email.emailId; setTimeout(() => emailStore.addStarEmailId = 0); emailStore.starScroll?.addItem(email); }).catch(error => { console.error(error); email.isStar = 0; });
  }
}

function handleDelete() {
  ElMessageBox.confirm(t('delEmailConfirm'), { confirmButtonText: t('confirm'), cancelButtonText: t('cancel'), type: 'warning' }).then(async () => {
    if (props.delType === 'logic') await emailDelete(props.email.emailId);
    else await allEmailDelete(props.email.emailId);
    ElMessage({ message: t('delSuccessMsg'), type: 'success', plain: true });
    emit('deleted', props.email.emailId);
  });
}
</script>

<style scoped lang="scss">
.box { height: 100%; overflow: hidden; }
.header-actions { padding: 9px 15px 8px; display: flex; align-items: center; gap: 20px; box-shadow: var(--header-actions-border); font-size: 18px; }
.header-actions .icon { cursor: pointer; }
.star { display: flex; align-items: center; justify-content: center; min-width: 21px; }
.scrollbar { height: calc(100% - 38px); width: 100%; }
.container { padding: 10px 20px; font-size: 14px; }
.email-title { margin-bottom: 10px; font-size: 20px; font-weight: bold; }
.content { display: flex; flex-direction: column; }
.email-info { margin-bottom: 20px; padding-bottom: 8px; border-bottom: 1px solid var(--light-border-color); }
.send, .receive { display: flex; margin-bottom: 6px; }
.source { padding-right: 10px; white-space: nowrap; font-weight: bold; }
.send-name, .receive-email { color: var(--regular-text-color); word-break: break-word; }
.send-name-title { padding-right: 5px; }
.date, .att-size { color: var(--regular-text-color); }
.email-msg { width: fit-content; max-width: 400px; margin-bottom: 15px; }
.att { align-self: flex-start; width: fit-content; margin: 30px 0; padding: 14px; border: 1px solid var(--light-border-color); border-radius: 6px; }
.att-title { display: flex; justify-content: space-between; margin-bottom: 8px; }
.att-box { display: grid; min-width: min(410px, calc(100vw - 60px)); max-width: 600px; gap: 12px; }
.att-item { display: grid; grid-template-columns: auto 1fr auto auto; align-self: start; padding: 5px 7px; border-radius: 4px; background: var(--light-ill); cursor: pointer; }
.att-item > div { align-self: center; }
.att-icon { display: grid; }
.att-name { overflow: hidden; margin: 0 8px; text-overflow: ellipsis; white-space: nowrap; word-break: break-all; }
.opt-icon { display: flex; align-items: center; gap: 8px; padding-left: 10px; color: var(--secondary-text-color); }
.opt-icon a { display: flex; align-items: center; color: inherit; }
.shadow-html::after { position: absolute; inset: 0; content: ''; pointer-events: none; background: var(--message-block-color); }
.email-text { margin: 0; font-family: inherit; white-space: pre-wrap; word-break: break-word; }
.bottom-distance { margin-bottom: 30px; }
@media (max-width: 1023px) { .container { padding-right: 15px; padding-left: 15px; } }
</style>
