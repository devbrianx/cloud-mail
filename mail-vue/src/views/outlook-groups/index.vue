<template>
  <div class="outlook-page">
    <div class="toolbar">
      <div><h2>{{ $t('outlookGroupManagement') }}</h2><p>{{ $t('outlookAccounts') }} / {{ $t('outlookTags') }}</p></div>
      <div class="actions">
        <el-button type="primary" @click="openGroup()">{{ $t('outlookNewGroup') }}</el-button>
        <el-button @click="tagVisible = true">{{ $t('outlookManageTags') }}</el-button>
        <el-button @click="load"><Icon icon="ion:reload" /></el-button>
      </div>
    </div>

    <el-table :data="groups" v-loading="loading">
      <el-table-column prop="name" :label="$t('outlookName')" min-width="180" />
      <el-table-column prop="sort" :label="$t('outlookGroupOrder')" width="120" />
      <el-table-column prop="accountCount" :label="$t('outlookAccounts')" width="130" />
      <el-table-column prop="createTime" :label="$t('date')" min-width="180" />
      <el-table-column :label="$t('action')" width="240">
        <template #default="{ row }">
          <el-button size="small" @click="openMembers(row)">{{ $t('outlookManageMembers') }}</el-button>
          <el-button size="small" @click="openGroup(row)">{{ $t('change') }}</el-button>
          <el-button size="small" type="danger" @click="deleteGroup(row)">{{ $t('delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="groupVisible" :title="editingGroup ? $t('change') : $t('outlookNewGroup')" width="420" @closed="groupName = ''; groupSort = 0">
      <el-form label-position="top"><el-form-item :label="$t('outlookName')"><el-input v-model="groupName" :placeholder="$t('outlookName')" /></el-form-item><el-form-item :label="$t('outlookGroupOrder')"><el-input-number v-model="groupSort" :min="0" :max="9999" controls-position="right" /></el-form-item></el-form>
      <template #footer>
        <el-button @click="groupVisible = false">{{ $t('cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveGroup">{{ $t('save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="memberVisible" :title="$t('outlookManageMembers')" width="560">
      <el-checkbox v-for="account in accounts" :key="account.outlookAccountId" :model-value="memberIds.includes(account.outlookAccountId)" class="member" @update:model-value="setMember(account.outlookAccountId, $event)">{{ account.email }}</el-checkbox>
      <el-empty v-if="!memberLoading && !accounts.length" :description="$t('outlookNoAccounts')" />
      <el-pagination v-if="memberTotal > memberPageSize" background layout="prev, pager, next" :page-size="memberPageSize" :total="memberTotal" :current-page="memberPage + 1" @current-change="changeMemberPage" />
      <template #footer>
        <el-button @click="memberVisible = false">{{ $t('cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveMembers">{{ $t('save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="tagVisible" :title="$t('outlookManageTags')" width="560" @closed="resetTagDialog">
      <div class="tag-add">
        <el-input v-model="tagName" :placeholder="$t('outlookTagNamePlaceholder')" :disabled="tagAdding" @keyup.enter="createTag" />
        <el-button type="primary" :loading="tagAdding" :disabled="tagAdding" @click="createTag">{{ $t('outlookAddTag') }}</el-button>
      </div>
      <el-table :data="tags" class="tag-table">
        <el-table-column :label="$t('outlookTags')">
          <template #default="{ row }">
            <template v-if="editingTagId === row.outlookTagId">
              <div class="tag-edit">
                <el-input v-model="editingTagName" size="small" :disabled="tagSavingId === row.outlookTagId" @keyup.enter="saveTag(row)" @keyup.esc="cancelTagEdit" />
                <el-button size="small" type="primary" :loading="tagSavingId === row.outlookTagId" @click="saveTag(row)">{{ $t('outlookSaveTag') }}</el-button>
                <el-button size="small" :disabled="tagSavingId === row.outlookTagId" @click="cancelTagEdit">{{ $t('outlookCancelEdit') }}</el-button>
              </div>
            </template>
            <span v-else>{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="accountCount" :label="$t('outlookAccounts')" width="110" />
        <el-table-column :label="$t('action')" width="160">
          <template #default="{ row }">
            <el-button size="small" :disabled="tagSavingId === row.outlookTagId" @click="startTagEdit(row)">{{ $t('change') }}</el-button>
            <el-button size="small" type="danger" :disabled="tagSavingId === row.outlookTagId" @click="deleteTag(row)">{{ $t('delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer><el-button @click="tagVisible = false">{{ $t('cancel') }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { ElMessageBox } from 'element-plus';
import { outlookGroupAdd, outlookGroupDelete, outlookGroupList, outlookGroupMemberIds, outlookGroupSet } from '@/request/outlook-group.js';
import { outlookTagAdd, outlookTagDelete, outlookTagList, outlookTagSet } from '@/request/outlook-tag.js';
import { outlookAccountBatchSetGroup, outlookAccountList } from '@/request/outlook-account.js';

defineOptions({ name: 'outlook-groups' });

const groups = ref([]);
const tags = ref([]);
const accounts = ref([]);
const loading = ref(false);
const saving = ref(false);
const memberLoading = ref(false);
const groupVisible = ref(false);
const memberVisible = ref(false);
const tagVisible = ref(false);
const editingGroup = ref(null);
const selectedGroup = ref(null);
const groupName = ref('');
const groupSort = ref(0);
const memberIds = ref([]);
const initialMemberIds = ref([]);
const memberPageSize = 15;
const memberPage = ref(0);
const memberTotal = ref(0);
const tagName = ref('');
const tagAdding = ref(false);
const editingTagId = ref(null);
const editingTagName = ref('');
const tagSavingId = ref(null);

async function load() {
  loading.value = true;
  try {
    const [groupData, tagData] = await Promise.all([outlookGroupList(), outlookTagList()]);
    groups.value = groupData.list;
    tags.value = tagData.list;
  } finally {
    loading.value = false;
  }
}

function openGroup(group = null) {
  editingGroup.value = group;
  groupName.value = group?.name || '';
  groupSort.value = group?.sort ?? (groups.value.length ? Math.min(9999, Math.max(...groups.value.map(item => item.sort)) + 1) : 0);
  groupVisible.value = true;
}

async function saveGroup() {
  saving.value = true;
  try {
    if (editingGroup.value) await outlookGroupSet(editingGroup.value.outlookGroupId, groupName.value, groupSort.value);
    else await outlookGroupAdd(groupName.value, groupSort.value);
    groupVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function deleteGroup(group) {
  await ElMessageBox.confirm(group.name, { type: 'warning' });
  await outlookGroupDelete(group.outlookGroupId);
  await load();
}

async function loadMemberAccounts() {
  memberLoading.value = true;
  try {
    const data = await outlookAccountList({ limit: memberPageSize, offset: memberPage.value * memberPageSize });
    accounts.value = data.list;
    memberTotal.value = data.total;
  } finally {
    memberLoading.value = false;
  }
}

async function openMembers(group) {
  selectedGroup.value = group;
  memberPage.value = 0;
  const data = await outlookGroupMemberIds(group.outlookGroupId);
  initialMemberIds.value = data.outlookAccountIds;
  memberIds.value = [...data.outlookAccountIds];
  await loadMemberAccounts();
  memberVisible.value = true;
}

function setMember(accountId, checked) {
  memberIds.value = checked ? [...new Set([...memberIds.value, accountId])] : memberIds.value.filter(id => id !== accountId);
}

async function changeMemberPage(value) {
  memberPage.value = value - 1;
  await loadMemberAccounts();
}

async function setGroupInBatches(outlookAccountIds, groupId) {
  for (let offset = 0; offset < outlookAccountIds.length; offset += 100) await outlookAccountBatchSetGroup({ outlookAccountIds: outlookAccountIds.slice(offset, offset + 100), groupId });
}

async function saveMembers() {
  saving.value = true;
  try {
    const initial = new Set(initialMemberIds.value);
    const assigned = new Set(memberIds.value);
    const addedIds = [...assigned].filter(id => !initial.has(id));
    const removedIds = [...initial].filter(id => !assigned.has(id));
    await setGroupInBatches(addedIds, selectedGroup.value.outlookGroupId);
    await setGroupInBatches(removedIds, null);
    memberVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function createTag() {
  const name = tagName.value.trim();
  if (!name || tagAdding.value) return;

  tagAdding.value = true;
  try {
    await outlookTagAdd(name);
    tagName.value = '';
    await load();
  } finally {
    tagAdding.value = false;
  }
}

function startTagEdit(tag) {
  if (tagSavingId.value !== null) return;
  editingTagId.value = tag.outlookTagId;
  editingTagName.value = tag.name;
}

function cancelTagEdit() {
  editingTagId.value = null;
  editingTagName.value = '';
}

async function saveTag(tag) {
  const name = editingTagName.value.trim();
  if (!name || name === tag.name) {
    cancelTagEdit();
    return;
  }
  if (tagSavingId.value !== null) return;

  tagSavingId.value = tag.outlookTagId;
  try {
    await outlookTagSet(tag.outlookTagId, name);
    cancelTagEdit();
    await load();
  } finally {
    tagSavingId.value = null;
  }
}

async function deleteTag(tag) {
  await ElMessageBox.confirm(tag.name, { type: 'warning' });
  if (editingTagId.value === tag.outlookTagId) cancelTagEdit();
  await outlookTagDelete(tag.outlookTagId);
  await load();
}

function resetTagDialog() {
  tagName.value = '';
  cancelTagEdit();
}

onMounted(load);
</script>

<style scoped lang="scss">
.outlook-page { padding: 28px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.toolbar h2 { margin: 0; }
.toolbar p { margin: 8px 0 0; color: var(--el-text-color-secondary); }
.actions { display: flex; gap: 8px; }
.member { display: flex; margin: 0 0 12px; }
.tag-add { display: flex; gap: 8px; }
.tag-table { margin-top: 18px; }
.tag-edit { display: flex; align-items: center; gap: 6px; }
@media (max-width: 700px) {
  .outlook-page { padding: 16px; }
  .toolbar { align-items: flex-start; gap: 12px; flex-direction: column; }
}
</style>
