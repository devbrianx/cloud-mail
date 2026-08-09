import http from '@/axios/index.js';

export const outlookGroupList = () => http.get('/outlookGroup/list');
export const outlookGroupAdd = name => http.post('/outlookGroup/add', { name });
export const outlookGroupSet = (outlookGroupId, name) => http.put('/outlookGroup/set', { outlookGroupId, name });
export const outlookGroupDelete = outlookGroupId => http.delete('/outlookGroup/delete', { params: { outlookGroupId } });
