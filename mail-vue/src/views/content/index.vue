<template>
  <EmailContent
    v-if="email"
    :email="email"
    :del-type="emailStore.contentData.delType"
    :show-star="emailStore.contentData.showStar"
    :show-reply="emailStore.contentData.showReply"
    :show-unread="emailStore.contentData.showUnread"
    @close="router.back()"
    @deleted="handleDeleted"
  />
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useEmailStore } from '@/store/email.js';
import EmailContent from '@/components/email-content/index.vue';

const router = useRouter();
const emailStore = useEmailStore();
const email = emailStore.contentData.email;

onMounted(() => {
  if (!email) router.back();
});

onUnmounted(() => {
  emailStore.contentData.showUnread = false;
});

function handleDeleted(emailId) {
  emailStore.deleteIds = [emailId];
  router.back();
}
</script>
