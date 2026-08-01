import http from '@/axios/index.js';

export function apiKeyList() {
  return http.get('/apiKey/list');
}

export function apiKeyCreate(form) {
  return http.post('/apiKey/create', form);
}

export function apiKeyDelete(apiKeyId) {
  return http.delete(`/apiKey/${apiKeyId}`);
}
