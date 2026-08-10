import http from '@/axios/index.js';

export const outlookGroupList = () => http.get('/outlookGroup/list');
export const outlookGroupAdd = (name, sort) => http.post('/outlookGroup/add', { name, sort });
export const outlookGroupSet = (outlookGroupId, name, sort) => http.put('/outlookGroup/set', { outlookGroupId, name, sort });
export const outlookGroupMemberIds = outlookGroupId => http.get('/outlookGroup/memberIds', { params: { outlookGroupId } });
export const outlookGroupDelete = outlookGroupId => http.delete('/outlookGroup/delete', { params: { outlookGroupId } });
