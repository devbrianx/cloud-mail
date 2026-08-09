import http from '@/axios/index.js';

export const outlookTagList = () => http.get('/outlookTag/list');
export const outlookTagAdd = name => http.post('/outlookTag/add', { name });
export const outlookTagSet = (outlookTagId, name) => http.put('/outlookTag/set', { outlookTagId, name });
export const outlookTagDelete = outlookTagId => http.delete('/outlookTag/delete', { params: { outlookTagId } });
