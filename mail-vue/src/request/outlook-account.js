import http from '@/axios/index.js';

export const outlookAccountList = params => http.get('/outlookAccount/list', { params });
export const outlookOAuthStart = values => http.post('/outlookAccount/oauth/start', values);
export const outlookAccountImport = rows => http.post('/outlookAccount/import', { rows });
export const outlookAccountSet = values => http.put('/outlookAccount/set', values);
export const outlookAccountDelete = outlookAccountId => http.delete('/outlookAccount/delete', { params: { outlookAccountId } });
export const outlookSyncRun = values => http.post('/outlookSync/run', values);
export const outlookSyncStatus = outlookAccountId => http.get('/outlookSync/status', { params: { outlookAccountId } });
