<template>
  <div class="outlook-page">
    <div class="toolbar"><div><h2>{{ $t('outlookGroupManagement') }}</h2><p>{{ $t('outlookAccounts') }} / {{ $t('outlookTags') }}</p></div><div class="actions"><el-button v-perm="'outlook-group:add'" type="primary" @click="openGroup()">{{ $t('outlookNewGroup') }}</el-button><el-button v-perm="'outlook-tag:add'" @click="tagVisible = true">{{ $t('outlookManageTags') }}</el-button><el-button @click="load"><Icon icon="ion:reload" /></el-button></div></div>
    <el-table :data="groups" v-loading="loading"><el-table-column prop="name" :label="$t('outlookName')" min-width="180" /><el-table-column prop="accountCount" :label="$t('outlookAccounts')" width="130" /><el-table-column prop="createTime" :label="$t('date')" min-width="180" /><el-table-column :label="$t('action')" width="240"><template #default="{ row }"><el-button v-perm="'outlook-group:set'" size="small" @click="openMembers(row)">{{ $t('outlookManageMembers') }}</el-button><el-button v-perm="'outlook-group:set'" size="small" @click="openGroup(row)">{{ $t('change') }}</el-button><el-button v-perm="'outlook-group:delete'" size="small" type="danger" @click="deleteGroup(row)">{{ $t('delete') }}</el-button></template></el-table-column></el-table>

    <el-dialog v-model="groupVisible" :title="editingGroup ? $t('change') : $t('outlookNewGroup')" width="420" @closed="groupName = ''"><el-input v-model="groupName" :placeholder="$t('outlookName')" /><template #footer><el-button @click="groupVisible = false">{{ $t('cancel') }}</el-button><el-button type="primary" :loading="saving" @click="saveGroup">{{ $t('save') }}</el-button></template></el-dialog>
    <el-dialog v-model="memberVisible" :title="$t('outlookManageMembers')" width="560"><el-checkbox-group v-model="memberIds" class="members"><el-checkbox v-for="account in accounts" :key="account.outlookAccountId" :value="account.outlookAccountId">{{ account.email }}</el-checkbox></el-checkbox-group><template #footer><el-button @click="memberVisible = false">{{ $t('cancel') }}</el-button><el-button type="primary" :loading="saving" @click="saveMembers">{{ $t('save') }}</el-button></template></el-dialog>
    <el-dialog v-model="tagVisible" :title="$t('outlookManageTags')" width="560" @closed="newTags = []"><el-input-tag v-model="newTags" :placeholder="$t('outlookNewTag')" @add-tag="normalizeTags" /><el-table :data="tags" class="tag-table"><el-table-column prop="name" :label="$t('outlookTags')" /><el-table-column prop="accountCount" :label="$t('outlookAccounts')" width="110" /><el-table-column :label="$t('action')" width="160"><template #default="{ row }"><el-button v-perm="'outlook-tag:set'" size="small" @click="renameTag(row)">{{ $t('change') }}</el-button><el-button v-perm="'outlook-tag:delete'" size="small" type="danger" @click="deleteTag(row)">{{ $t('delete') }}</el-button></template></el-table-column></el-table><template #footer><el-button @click="tagVisible = false">{{ $t('cancel') }}</el-button><el-button v-perm="'outlook-tag:add'" type="primary" :loading="saving" @click="createTags">{{ $t('save') }}</el-button></template></el-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { ElMessageBox } from 'element-plus';
import { outlookGroupAdd, outlookGroupDelete, outlookGroupList, outlookGroupSet } from '@/request/outlook-group.js';
import { outlookTagAdd, outlookTagDelete, outlookTagList, outlookTagSet } from '@/request/outlook-tag.js';
import { outlookAccountList, outlookAccountSet } from '@/request/outlook-account.js';

defineOptions({ name: 'outlook-groups' });
const groups = ref([]), tags = ref([]), accounts = ref([]), loading = ref(false), saving = ref(false), groupVisible = ref(false), memberVisible = ref(false), tagVisible = ref(false), editingGroup = ref(null), selectedGroup = ref(null), groupName = ref(''), memberIds = ref([]), newTags = ref([]);
async function load() { loading.value = true; try { const [g, t, a] = await Promise.all([outlookGroupList(), outlookTagList(), outlookAccountList()]); groups.value = g.list; tags.value = t.list; accounts.value = a.list; } finally { loading.value = false; } }
function openGroup(group = null) { editingGroup.value = group; groupName.value = group?.name || ''; groupVisible.value = true; }
async function saveGroup() { saving.value = true; try { if (editingGroup.value) await outlookGroupSet(editingGroup.value.outlookGroupId, groupName.value); else await outlookGroupAdd(groupName.value); groupVisible.value = false; await load(); } finally { saving.value = false; } }
async function deleteGroup(group) { await ElMessageBox.confirm(group.name, { type: 'warning' }); await outlookGroupDelete(group.outlookGroupId); await load(); }
function openMembers(group) { selectedGroup.value = group; memberIds.value = accounts.value.filter(account => account.groupId === group.outlookGroupId).map(account => account.outlookAccountId); memberVisible.value = true; }
async function saveMembers() { saving.value = true; try { const assigned = new Set(memberIds.value); const affected = accounts.value.filter(account => account.groupId === selectedGroup.value.outlookGroupId || assigned.has(account.outlookAccountId)); await Promise.all(affected.map(account => outlookAccountSet({ outlookAccountId: account.outlookAccountId, groupId: assigned.has(account.outlookAccountId) ? selectedGroup.value.outlookGroupId : null, tagIds: account.tagIds }))); memberVisible.value = false; await load(); } finally { saving.value = false; } }
function normalizeTags(value) { const names = value.split(/[,，]/).map(item => item.trim()).filter(Boolean); newTags.value.splice(newTags.value.length - 1, 1); for (const name of names) if (Array.from(name).length <= 32 && !newTags.value.includes(name) && !tags.value.some(tag => tag.name.toLowerCase() === name.toLowerCase())) newTags.value.push(name); }
async function createTags() { saving.value = true; try { await Promise.all(newTags.value.map(name => outlookTagAdd(name))); newTags.value = []; await load(); } finally { saving.value = false; } }
async function renameTag(tag) { const { value } = await ElMessageBox.prompt(tag.name, ''); await outlookTagSet(tag.outlookTagId, value); await load(); }
async function deleteTag(tag) { await ElMessageBox.confirm(tag.name, { type: 'warning' }); await outlookTagDelete(tag.outlookTagId); await load(); }
onMounted(load);
</script>

<style scoped lang="scss">.outlook-page{padding:28px}.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.toolbar h2{margin:0}.toolbar p{margin:8px 0 0;color:var(--el-text-color-secondary)}.actions{display:flex;gap:8px}.members{display:grid;gap:12px}.tag-table{margin-top:18px}.el-input-tag{width:100%}@media(max-width:700px){.outlook-page{padding:16px}.toolbar{align-items:flex-start;gap:12px;flex-direction:column}}</style>
