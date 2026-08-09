import http from '@/axios/index.js';

export function temporaryIdentityList(params) {
  return http.get('/temporaryIdentity/list', { params });
}

export function temporaryIdentityDetail(rowkey) {
  return http.get(`/temporaryIdentity/detail/${encodeURIComponent(rowkey)}`);
}

export function temporaryIdentityAdd(record) {
  return http.post('/temporaryIdentity/add', record);
}

export function temporaryIdentityImport(records) {
  return http.post('/temporaryIdentity/import', { records });
}

export function temporaryIdentitySet(rowkey, record) {
  return http.put(`/temporaryIdentity/set/${encodeURIComponent(rowkey)}`, record);
}

export function temporaryIdentityDelete(rowkeys) {
  return http.delete('/temporaryIdentity/delete', { data: { rowkeys } });
}
