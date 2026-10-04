<template>
    <div id="vcs-integrations">
        <h1>VCS integrations</h1>

        <LoaderModal v-if="isLoading" />

        <template v-else>
            <div class="list card">
                <div v-for="i in integrations" :key="i.id" class="row">
                    <div>
                        <div class="name">{{ i.name }}</div>
                        <div class="meta">{{ i.platform }}</div>
                    </div>
                    <button class="btn danger sm" @click="remove(i.id)">Delete</button>
                </div>
                <div v-if="!integrations?.length" class="empty">No integrations yet.</div>
            </div>

            <section class="integration-form card">
                <header class="card-header"><h2>Add integration</h2></header>
                <form @submit.prevent="submit" class="form card-body">
                    <label>Name<input class="input" v-model="form.name" required /></label>
                    <label>GitLab URL<input class="input" v-model="form.url" type="url" required /></label>
                    <label>Client ID<input class="input" v-model="form.clientId" required /></label>
                    <label
                        >Client Secret<input class="input" v-model="form.clientSecret" type="password" autocomplete="new-password" required
                    /></label>
                    <button type="submit" class="btn primary" :disabled="submitting">
                        {{ submitting ? 'Saving...' : 'Add' }}
                    </button>
                </form>
            </section>
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
#vcs-integrations {
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.list {
    overflow: hidden;
}
.row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    &:last-child {
        border-bottom: 0;
    }
    .name {
        font-weight: 600;
    }
    .meta {
        color: var(--text-3);
        font-size: 12px;
    }
}
.empty {
    padding: 32px 18px;
    color: var(--text-3);
    font-size: 13px;
    text-align: center;
}
.integration-form {
    width: 100%;
    max-width: 480px;
}
.form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    .btn {
        align-self: flex-start;
    }
}
</style>
