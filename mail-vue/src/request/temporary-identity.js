import http from '@/axios/index.js';

export function temporaryIdentityCountries() {
  return http.get('/temporaryIdentity/countries');
}

export function temporaryIdentityCountryAdd(country) {
  return http.post('/temporaryIdentity/country/add', { country });
}

export function temporaryIdentityCountrySet(country, nextCountry) {
  return http.put(`/temporaryIdentity/country/set/${encodeURIComponent(country)}`, { country: nextCountry });
}

export function temporaryIdentityCountryDelete(country) {
  return http.delete(`/temporaryIdentity/country/delete/${encodeURIComponent(country)}`);
}

export function temporaryIdentityList(params) {
  return http.get('/temporaryIdentity/list', { params });
}

export function temporaryIdentityDetail(rowkey) {
  return http.get(`/temporaryIdentity/detail/${encodeURIComponent(rowkey)}`);
}

export function temporaryIdentityAdd(country, data) {
  return http.post('/temporaryIdentity/add', { country, data });
}

export function temporaryIdentitySet(rowkey, data) {
  return http.put(`/temporaryIdentity/set/${encodeURIComponent(rowkey)}`, { data });
}

export function temporaryIdentityDelete(rowkeys) {
  return http.delete('/temporaryIdentity/delete', { data: { rowkeys } });
}
