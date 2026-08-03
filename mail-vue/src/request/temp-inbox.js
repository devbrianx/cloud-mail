import http from '@/axios/index.js';

export function tempInboxList(params) {
  return http.get('/tempInbox/list', { params });
}

export function tempInboxCreate(form) {
  return http.post('/tempInbox', form);
}

export function tempInboxMessages(inboxId, params) {
  return http.get(`/tempInbox/${encodeURIComponent(inboxId)}/messages`, { params });
}

export function tempInboxMessage(inboxId, messageId) {
  return http.get(`/tempInbox/${encodeURIComponent(inboxId)}/messages/${messageId}`);
}

export function tempInboxDelete(inboxIds) {
  return http.delete('/tempInbox', { data: { inboxIds } });
}
