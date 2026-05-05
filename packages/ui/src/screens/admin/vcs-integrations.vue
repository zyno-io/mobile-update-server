<template>
    <div id="vcs-integrations">
        <h1>VCS integrations</h1>

        <LoaderModal v-if="isLoading" />

        <template v-else>
            <div class="list">
                <div v-for="i in integrations" :key="i.id" class="row">
                    <div>
                        <div class="name">{{ i.name }}</div>
                        <div class="meta">{{ i.platform }}</div>
                    </div>
                    <button @click="remove(i.id)">Delete</button>
                </div>
                <div v-if="!integrations?.length" class="empty">No integrations yet.</div>
            </div>

            <h2>Add integration</h2>
            <form @submit.prevent="submit" class="form">
                <label>Name<input v-model="form.name" required /></label>
                <label>GitLab URL<input v-model="form.url" type="url" required /></label>
                <label>Client ID<input v-model="form.clientId" required /></label>
                <label>Client Secret<input v-model="form.clientSecret" type="password" autocomplete="new-password" required /></label>
                <button type="submit" class="primary" :disabled="submitting">
                    {{ submitting ? 'Saving...' : 'Add' }}
                </button>
            </form>
        </template>
    </div>
</template>

<script lang="ts" setup>
import { dataFromAsync } from '@zyno-io/openapi-client-codegen';
import { handleErrorAndAlert, showConfirmDestroy } from '@zyno-io/vue-foundation';
import { onMounted, reactive, ref } from 'vue';

import { type IVcsIntegrationListResponse, VcsIntegrationsApi } from '@/openapi-client-generated';
import LoaderModal from '@/shared/components/loader-modal.vue';

const integrations = ref<IVcsIntegrationListResponse[]>();
const isLoading = ref(true);
const submitting = ref(false);
const form = reactive({ name: '', url: '', clientId: '', clientSecret: '' });

async function load() {
    try {
        isLoading.value = true;
        integrations.value = await dataFromAsync(VcsIntegrationsApi.getVcsIntegrationsIndex());
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        isLoading.value = false;
    }
}

async function submit() {
    try {
        submitting.value = true;
        await dataFromAsync(
            VcsIntegrationsApi.postVcsIntegrationsCreate({
                body: {
                    name: form.name,
                    platform: 'gitlab',
                    config: {
                        url: form.url.replace(/\/$/, ''),
                        clientId: form.clientId,
                        clientSecret: form.clientSecret
                    }
                }
            })
        );
        Object.assign(form, { name: '', url: '', clientId: '', clientSecret: '' });
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        submitting.value = false;
    }
}

async function remove(id: string) {
    const ok = await showConfirmDestroy('Delete integration', 'Delete this integration? Existing apps tied to it will lose access.');
    if (!ok) return;
    try {
        await dataFromAsync(VcsIntegrationsApi.deleteVcsIntegrationsDelete({ path: { id } }));
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    }
}

onMounted(load);
</script>

<style lang="scss" scoped>
@reference "tailwindcss";

#vcs-integrations {
    @apply flex flex-col gap-4;
}

.list {
    @apply flex flex-col gap-2;
}

.row {
    @apply flex items-center justify-between p-3 border border-neutral-500/25 rounded-md;
    .name {
        @apply font-semibold;
    }
    .meta {
        @apply text-xs text-neutral-500;
    }
}

.empty {
    @apply text-neutral-500 text-sm py-4 text-center;
}

.form {
    @apply flex flex-col gap-3 max-w-md;
}
</style>
