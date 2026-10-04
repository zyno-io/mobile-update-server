<template>
    <div id="apps">
        <div class="header">
            <div>
                <h1>Apps</h1>
                <p class="subtitle">Manage your mobile apps and release channels.</p>
            </div>
            <button class="btn primary" @click="showCreate = true">Add app</button>
        </div>

        <LoaderModal v-if="isLoading" />

        <div v-else class="app-list card">
            <div v-if="!apps?.length" class="empty">
                <i class="fa fa-mobile-screen" />
                <h2>No apps yet</h2>
                <p>Click "Add app" to register a GitLab project.</p>
            </div>
            <RouterLink v-for="app in apps" :key="app.id" class="app" :to="{ name: 'app', params: { appId: app.id } }">
                <div>
                    <div class="app-name">{{ app.name }}</div>
                    <div class="app-path">{{ app.projectPath }}</div>
                </div>
                <span class="role tag">{{ app.role }}</span>
            </RouterLink>
        </div>

        <VfModal v-if="showCreate" @close="closeCreate">
            <div class="create-form">
                <h2>Add app</h2>
                <form @submit.prevent="submitCreate">
                    <label>
                        VCS integration
                        <select class="select" v-model="form.vcsId" required>
                            <option value="" disabled>Select integration...</option>
                            <option v-for="vcs in vcsIntegrations" :key="vcs.id" :value="vcs.id">{{ vcs.name }}</option>
                        </select>
                    </label>
                    <label>
                        Search project
                        <input
                            class="input"
                            v-model="search"
                            type="text"
                            placeholder="Type project name..."
                            :disabled="!form.vcsId"
                            @input="onSearch"
                        />
                        <div v-if="searchResults.length" class="search-results">
                            <button v-for="p in searchResults" :key="p.id" type="button" class="result" @click="selectProject(p)">
                                <span class="result-name">{{ p.name }}</span>
                                <span class="result-path">{{ p.projectPath }}</span>
                            </button>
                        </div>
                        <div v-if="selected" class="selected">
                            <span>{{ selected.projectPath }}</span>
                            <button class="btn" type="button" @click="selected = undefined">Clear</button>
                        </div>
                    </label>
                    <label>
                        App name
                        <input class="input" v-model="form.name" type="text" required />
                    </label>
                    <div class="actions">
                        <button class="btn" type="button" @click="closeCreate">Cancel</button>
                        <button type="submit" class="btn primary" :disabled="isSubmitting || !selected">
                            {{ isSubmitting ? 'Creating...' : 'Create app' }}
                        </button>
                    </div>
                </form>
            </div>
        </VfModal>
    </div>
</template>

<script lang="ts" setup>
import { dataFromAsync } from '@zyno-io/openapi-client-codegen';
import { handleErrorAndAlert, VfModal } from '@zyno-io/vue-foundation';
import { debounce } from 'lodash';
import { onMounted, reactive, ref } from 'vue';

import { AppsApi, type IAppListResponse, type ISessionProvider, type IVcsProject, SessionApi } from '@/openapi-client-generated';
import LoaderModal from '@/shared/components/loader-modal.vue';

const apps = ref<IAppListResponse[]>();
const vcsIntegrations = ref<ISessionProvider[]>([]);
const isLoading = ref(true);
const showCreate = ref(false);
const isSubmitting = ref(false);

const form = reactive({ vcsId: '', name: '' });
const search = ref('');
const searchResults = ref<IVcsProject[]>([]);
const selected = ref<IVcsProject>();

async function load() {
    try {
        apps.value = await dataFromAsync(AppsApi.getAppsIndex());
        vcsIntegrations.value = await dataFromAsync(SessionApi.getSessionGetProviders());
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        isLoading.value = false;
    }
}

const onSearch = debounce(async () => {
    if (!form.vcsId || !search.value) {
        searchResults.value = [];
        return;
    }
    try {
        searchResults.value = await dataFromAsync(AppsApi.getAppsSearchVcsProjects({ query: { vcsId: form.vcsId, search: search.value } }));
    } catch (err) {
        handleErrorAndAlert(err);
    }
}, 300);

function selectProject(p: IVcsProject) {
    selected.value = p;
    searchResults.value = [];
    search.value = p.projectPath;
    if (!form.name) form.name = p.name;
}

async function submitCreate() {
    if (!selected.value) return;
    try {
        isSubmitting.value = true;
        await dataFromAsync(
            AppsApi.postAppsCreate({
                body: {
                    name: form.name,
                    vcsId: form.vcsId,
                    projectPath: selected.value.projectPath,
                    vcsProjectId: Number(selected.value.id)
                }
            })
        );
        closeCreate();
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        isSubmitting.value = false;
    }
}

function closeCreate() {
    showCreate.value = false;
    form.vcsId = '';
    form.name = '';
    search.value = '';
    selected.value = undefined;
    searchResults.value = [];
}

onMounted(load);
</script>

<style lang="scss" scoped>
#apps {
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.subtitle {
    margin-top: 4px;
    color: var(--text-3);
    font-size: 13px;
}
.app-list {
    overflow: hidden;
}
.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 56px 20px;
    color: var(--text-3);
    text-align: center;
    i {
        font-size: 28px;
    }
    h2 {
        color: var(--text);
    }
}
.app {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
    &:hover {
        background: var(--surface-hover);
    }
    &:last-child {
        border-bottom: 0;
    }
    > div {
        min-width: 0;
    }
    .app-name {
        font-weight: 600;
    }
    .app-path {
        color: var(--text-3);
        font-size: 12px;
        overflow-wrap: anywhere;
    }
    .role {
        flex-shrink: 0;
    }
}
.create-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 440px;
    max-width: 100%;
    form {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .search-results {
        border: 1px solid var(--border);
        border-radius: var(--radius);
        max-height: 240px;
        overflow: auto;
    }
    .result {
        display: flex;
        flex-direction: column;
        width: 100%;
        gap: 2px;
        padding: 8px 10px;
        border: 0;
        background: var(--surface);
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
        &:hover {
            background: var(--surface-hover);
        }
        .result-path {
            color: var(--text-3);
            font-size: 12px;
        }
    }
    .selected {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border-radius: var(--radius);
        background: var(--surface-2);
        overflow-wrap: anywhere;
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
    }
}
</style>
