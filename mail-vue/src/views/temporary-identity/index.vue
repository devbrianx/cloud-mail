<template>
  <div class="temporary-identities">
    <section class="identity-list-panel">
      <div class="panel-header">
        <h2>{{ $t('temporaryIdentities') }}</h2>
        <div class="panel-actions">
          <el-tooltip :content="$t('refresh')"><el-button link @click="loadList"><Icon icon="ion:reload" width="18" /></el-button></el-tooltip>
          <el-tooltip v-if="hasAdd" :content="$t('importTemporaryIdentities')"><el-button link @click="fileInput.click()"><Icon icon="solar:import-outline" width="19" /></el-button></el-tooltip>
          <el-tooltip v-if="hasAdd" :content="$t('newTemporaryIdentity')"><el-button type="primary" link @click="openCreate"><Icon icon="ion:add-outline" width="22" /></el-button></el-tooltip>
          <input ref="fileInput" class="file-input" type="file" accept="application/json,.json" @change="importFile" />
        </div>
      </div>
      <el-input v-model="search" clearable :placeholder="$t('searchTemporaryIdentities')" @input="searchIdentities">
        <template #prefix><Icon icon="solar:magnifer-outline" /></template>
      </el-input>
      <el-scrollbar v-loading="loading" class="identity-scrollbar">
        <button v-for="identity in identities" :key="identity.rowkey" class="identity-card" :class="{ selected: identity.rowkey === selectedRowkey }" @click="selectIdentity(identity.rowkey)">
          <strong>{{ identity.fullName || identity.username || identity.rowkey }}</strong>
          <span v-if="identity.gender">{{ identity.gender }}</span>
          <span>{{ identity.temporaryMail || identity.username }}</span>
          <small>{{ identity.address }}</small>
        </button>
        <el-empty v-if="!loading && !identities.length" :description="$t('temporaryIdentitiesEmpty')" />
      </el-scrollbar>
      <el-pagination v-if="total > pageSize" background layout="prev, pager, next" :page-size="pageSize" :total="total" :current-page="page + 1" @current-change="changePage" />
    </section>

    <section class="identity-detail-panel" v-loading="detailLoading">
      <template v-if="detail">
        <div class="panel-header">
          <div><h2>{{ detail.Full_Name || detail.Username || detail.rowkey }}</h2><span class="rowkey">{{ detail.rowkey }}</span></div>
          <div class="panel-actions">
            <el-button v-if="hasSet" link @click="openEdit"><Icon icon="solar:pen-outline" width="19" /></el-button>
            <el-button v-if="hasDelete" type="danger" link @click="deleteSelected"><Icon icon="uiw:delete" width="17" /></el-button>
          </div>
        </div>
        <section v-for="section in detailSections" :key="section.title" class="detail-section">
          <h3>{{ section.title }}</h3>
          <div v-if="section.addresses" class="address-cards">
            <article v-for="item in section.items" :key="item.key" class="address-card"><FieldValue :item="item" @copy="copyValue" /></article>
          </div>
          <div v-else class="field-grid"><FieldValue v-for="item in section.items" :key="item.key" :item="item" @copy="copyValue" /></div>
        </section>
      </template>
      <el-empty v-else :description="$t('temporaryIdentitiesEmpty')" />
    </section>

    <el-dialog v-model="formVisible" :title="editing ? $t('editTemporaryIdentity') : $t('newTemporaryIdentity')" width="min(880px, calc(100% - 32px))" @closed="resetForm">
      <el-scrollbar max-height="65vh">
        <section v-for="section in formSections" :key="section.title" class="form-section">
          <h3>{{ section.title }}</h3>
          <el-form label-position="top" class="form-grid"><el-form-item v-for="key in section.keys" :key="key" :label="key"><el-input v-model="form[key]" :readonly="key === 'rowkey'" /></el-form-item></el-form>
        </section>
      </el-scrollbar>
      <template #footer><el-tooltip :content="$t('cancel')"><el-button circle @click="formVisible = false"><Icon icon="material-symbols:close-rounded" width="20" /></el-button></el-tooltip><el-tooltip :content="$t('save')"><el-button circle type="primary" :loading="saving" @click="saveIdentity"><Icon icon="material-symbols:check-rounded" width="20" /></el-button></el-tooltip></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import { hasPerm } from '@/perm/perm.js';
import { temporaryIdentityAdd, temporaryIdentityDelete, temporaryIdentityDetail, temporaryIdentityImport, temporaryIdentityList, temporaryIdentitySet } from '@/request/temporary-identity.js';

const knownGroups = [
  { title: 'Profile', keys: ['Full_Name', 'Full_Name_Tran', 'Gender', 'Title', 'Birthday', 'Username', 'Password'] },
  { title: 'Contact', keys: ['Telephone', 'Fax', 'City', 'State', 'State_Full', 'Zip_Code', 'Temporary_mail', 'Website'] },
  { title: 'Addresses', keys: ['Address', 'Address_Alias', 'Trans_Address', 'Trans_Cn_Address'] },
  { title: 'Financial', keys: ['Credit_Card_Type', 'Credit_Card_Number', 'Expires', 'CVV2', 'Social_Security_Number', 'Employment_Status', 'Monthly_Salary'] },
  { title: 'Additional', keys: ['Height', 'Weight', 'System', 'GUID', 'Blood_Type', 'Educational_Background', 'Hair_Color', 'Occupation', 'Security_Question', 'Security_Answer'] }
];
const knownKeys = new Set(knownGroups.flatMap(group => group.keys).concat('rowkey'));
const identities = ref([]); const total = ref(0); const page = ref(0); const pageSize = 50; const search = ref(''); const loading = ref(false);
const selectedRowkey = ref(''); const detail = ref(null); const detailLoading = ref(false); const formVisible = ref(false); const editing = ref(false); const saving = ref(false); const fileInput = ref();
const form = reactive({});
const hasAdd = hasPerm('temporary-identity:add'); const hasSet = hasPerm('temporary-identity:set'); const hasDelete = hasPerm('temporary-identity:delete');
const { t } = useI18n();
const formSections = computed(() => editing.value ? [{ title: 'Identifier', keys: ['rowkey'] }, ...knownGroups] : knownGroups);
const detailSections = computed(() => {
  if (!detail.value) return [];
  const item = key => ({ key, value: detail.value[key] });
  const addresses = Object.keys(detail.value).filter(key => key.includes('Address') && detail.value[key]).map(item);
  const groups = knownGroups.filter(group => group.title !== 'Addresses').map(group => ({ title: group.title, items: group.keys.filter(key => detail.value[key] !== undefined && detail.value[key] !== '').map(item) }));
  groups.splice(2, 0, { title: 'Contact & Addresses', addresses: true, items: addresses });
  const extras = Object.keys(detail.value).filter(key => !knownKeys.has(key) && detail.value[key] !== '').map(item);
  if (extras.length) groups.push({ title: 'Additional data', items: extras });
  return groups.filter(group => group.items.length);
});
const FieldValue = defineComponent({ props: { item: { type: Object, required: true } }, emits: ['copy'], setup(props, { emit }) { return () => h('div', { class: 'field-value' }, [h('span', { class: 'field-key' }, props.item.key), h('div', { class: 'field-content' }, [h('span', String(props.item.value)), h(Icon, { icon: 'fluent:copy-20-regular', width: '17', class: 'copy-icon', onClick: () => emit('copy', props.item.value) })])]); } });

function blankRecord() { return Object.fromEntries(knownGroups.flatMap(group => group.keys).map(key => [key, ''])); }
async function loadList() { loading.value = true; try { const data = await temporaryIdentityList({ q: search.value, limit: pageSize, offset: page.value * pageSize }); identities.value = data.list; total.value = data.total; if (selectedRowkey.value && !identities.value.some(item => item.rowkey === selectedRowkey.value)) { selectedRowkey.value = ''; detail.value = null; } } finally { loading.value = false; } }
async function selectIdentity(rowkey) { selectedRowkey.value = rowkey; detailLoading.value = true; try { detail.value = await temporaryIdentityDetail(rowkey); } finally { detailLoading.value = false; } }
function searchIdentities() { page.value = 0; loadList(); }
function changePage(value) { page.value = value - 1; loadList(); }
function openCreate() { editing.value = false; Object.assign(form, blankRecord()); formVisible.value = true; }
function openEdit() { editing.value = true; Object.assign(form, JSON.parse(JSON.stringify(detail.value))); formVisible.value = true; }
function resetForm() { Object.keys(form).forEach(key => delete form[key]); }
async function saveIdentity() { saving.value = true; try { const saved = editing.value ? await temporaryIdentitySet(detail.value.rowkey, form) : await temporaryIdentityAdd(form); formVisible.value = false; await loadList(); await selectIdentity(saved.rowkey); } finally { saving.value = false; } }
async function deleteSelected() { await ElMessageBox.confirm(t('deleteTemporaryIdentities'), { type: 'warning', confirmButtonText: t('confirm'), cancelButtonText: t('cancel') }); await temporaryIdentityDelete([selectedRowkey.value]); selectedRowkey.value = ''; detail.value = null; await loadList(); }
async function importFile(event) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { const value = JSON.parse(await file.text()); const records = Array.isArray(value) ? value : [value]; const result = await temporaryIdentityImport(records); await loadList(); if (result.rowkeys[0]) await selectIdentity(result.rowkeys[0]); } catch { ElMessage({ type: 'error', message: t('reqFailErrorMsg') }); } }
async function copyValue(value) { try { await navigator.clipboard.writeText(String(value)); ElMessage({ type: 'success', message: t('copySuccessMsg') }); } catch { ElMessage({ type: 'error', message: t('copyFailMsg') }); } }
onMounted(loadList);
</script>

<style scoped lang="scss">
.temporary-identities { display: grid; grid-template-columns: minmax(320px, 360px) minmax(0, 1fr); height: 100%; overflow: hidden; }
.identity-list-panel, .identity-detail-panel { min-width: 0; padding: 20px; overflow: auto; border-right: 1px solid var(--el-border-color-lighter); }
.identity-detail-panel { border-right: 0; }.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }.panel-header h2 { margin: 0; }.panel-actions { display: flex; gap: 4px; }.identity-scrollbar { height: calc(100% - 115px); margin-top: 12px; }.identity-card { display: flex; width: 100%; flex-direction: column; gap: 5px; padding: 12px; text-align: left; color: inherit; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: transparent; cursor: pointer; margin-bottom: 8px; }.identity-card:hover, .identity-card.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }.identity-card span, .identity-card small, .rowkey { color: var(--el-text-color-secondary); overflow-wrap: anywhere; }.detail-section, .form-section { margin-bottom: 24px; }.detail-section h3, .form-section h3 { margin: 0 0 12px; font-size: 15px; }.field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }.field-value, .address-card { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px; }.field-key { display: block; margin-bottom: 6px; font-size: 12px; color: var(--el-text-color-secondary); }.field-content { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; overflow-wrap: anywhere; white-space: pre-wrap; }.copy-icon { flex: none; cursor: pointer; color: var(--el-text-color-secondary); }.address-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 12px; }.file-input { display: none; } @media (max-width: 767px) { .temporary-identities { grid-template-columns: 1fr; overflow: auto; }.identity-list-panel, .identity-detail-panel { min-height: 360px; border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); }.identity-scrollbar { height: 280px; } }
</style>
