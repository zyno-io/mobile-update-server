<template>
    <div id="apps">
        <div class="header">
            <h1>Apps</h1>
            <button class="primary" @click="showCreate = true">Add app</button>
        </div>

        <LoaderModal v-if="isLoading" />

        <div v-else class="app-list">
            <div v-if="!apps?.length" class="empty">
                <i class="fa fa-mobile-screen" />
                <h2>No apps yet</h2>
                <p>Click "Add app" to register a GitLab project.</p>
            </div>
            <div v-for="app in apps" :key="app.id" class="app" @click="$router.push({ name: 'app', params: { appId: app.id } })">
                <div>
                    <div class="app-name">{{ app.name }}</div>
                    <div class="app-path">{{ app.projectPath }}</div>
                </div>
                <span class="role">{{ app.role }}</span>
            </div>
        </div>

        <VfModal v-if="showCreate" @close="closeCreate">
            <div class="create-form">
                <h2>Add app</h2>
                <form @submit.prevent="submitCreate">
                    <label>
                        VCS integration
                        <select v-model="form.vcsId" required>
                            <option value="" disabled>Select integration...</option>
                            <option v-for="vcs in vcsIntegrations" :key="vcs.id" :value="vcs.id">{{ vcs.name }}</option>
                        </select>
                    </label>
                    <label>
                        Search project
                        <input v-model="search" type="text" placeholder="Type project name..." :disabled="!form.vcsId" @input="onSearch" />
                        <div v-if="searchResults.length" class="search-results">
                            <div v-for="p in searchResults" :key="p.id" class="result" @click="selectProject(p)">
                                <span class="result-name">{{ p.name }}</span>
                                <span class="result-path">{{ p.projectPath }}</span>
                            </div>
                        </div>
                        <div v-if="selected" class="selected">
                            <span>{{ selected.projectPath }}</span>
                            <button type="button" @click="selected = undefined">Clear</button>
                        </div>
                    </label>
                    <label>
                        App name
                        <input v-model="form.name" type="text" required />
                    </label>
                    <div class="actions">
                        <button type="button" @click="closeCreate">Cancel</button>
                        <button type="submit" class="primary" :disabled="isSubmitting || !selected">
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
@reference "tailwindcss";

#apps {
    @apply flex flex-col gap-4;
}

.header {
    @apply flex items-center justify-between;
}

.app-list {
    @apply flex flex-col gap-2;
}

.empty {
    @apply flex flex-col items-center gap-2 py-12 text-neutral-500;
    i {
        @apply text-3xl;
    }
}

.app {
    @apply flex justify-between items-center p-4 border border-neutral-500/25 rounded-lg cursor-pointer hover:bg-neutral-100;

    .app-name {
        @apply font-semibold;
    }
    .app-path {
        @apply text-xs text-neutral-500;
    }
    .role {
        @apply text-xs uppercase tracking-wide text-neutral-500;
    }
}

html.dark .app:hover {
    @apply bg-neutral-800;
}

.create-form {
    @apply flex flex-col gap-3 p-4 w-[480px];

    form {
        @apply flex flex-col gap-3 mt-2;
    }

    .search-results {
        @apply mt-1 border border-neutral-500/25 rounded-md max-h-60 overflow-auto;

        .result {
            @apply flex flex-col gap-0 px-3 py-2 cursor-pointer hover:bg-neutral-100;
            .result-name {
                @apply text-sm;
            }
            .result-path {
                @apply text-xs text-neutral-500;
            }
        }
    }

    .selected {
        @apply mt-1 flex items-center justify-between gap-2 px-3 py-2 bg-neutral-100 rounded-md text-sm;
    }

    .actions {
        @apply flex justify-end gap-2 mt-2;
    }
}

html.dark .create-form .selected,
html.dark .create-form .search-results .result:hover {
    @apply bg-neutral-800;
}
</style>
