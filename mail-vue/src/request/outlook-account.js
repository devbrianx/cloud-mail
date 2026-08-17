import http from '@/axios/index.js';

export const outlookAccountList = params => http.get('/outlookAccount/list', { params });
export const outlookOAuthStart = () => http.post('/outlookAccount/oauth/start');
export const outlookAccountImport = rows => http.post('/outlookAccount/import', { rows });
export const outlookAccountExport = outlookAccountIds => http.post('/outlookAccount/export', outlookAccountIds?.length ? { outlookAccountIds } : {});
export const outlookAccountSet = values => http.put('/outlookAccount/set', values);
export const outlookAccountDelete = outlookAccountId => http.delete('/outlookAccount/delete', { params: { outlookAccountId } });
export const outlookSyncRun = values => http.post('/outlookSync/run', values);
export const outlookAccountBatchSetGroup = values => http.put('/outlookAccount/batchSetGroup', values);
export const outlookAccountBatchDelete = outlookAccountIds => http.delete('/outlookAccount/batchDelete', { data: { outlookAccountIds } });
