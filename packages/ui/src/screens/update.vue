<template>
    <div id="update-detail">
        <LoaderModal v-if="isLoading" />

        <template v-else-if="update">
            <div class="header">
                <div>
                    <RouterLink :to="`/apps/${appId}/channels/${channelId}`" class="back">&larr; back</RouterLink>
                    <h1>
                        <a v-if="commitUrl" class="commit-link" :href="commitUrl" target="_blank" rel="noopener">{{
                            update.commitHash.substring(0, 7)
                        }}</a>
                        <code v-else class="commit-link">{{ update.commitHash.substring(0, 7) }}</code>
                        · {{ update.commitSubject }}
                    </h1>
                    <div class="meta">
                        <span :class="['status', update.status]">{{ update.status }}</span>
                        <span>{{ updatePlatform }}</span>
                        <span>{{ update.runtimeVersion }}</span>
                        <span>{{ update.commitAuthor }}</span>
                        <span>{{ formatDate(update.createdAt) }}</span>
                    </div>
                </div>
            </div>

            <div class="metrics" v-if="metrics">
                <div class="metric">
                    <span class="value">{{ metrics.devicesOnUpdate }}</span>
                    <span class="label">devices on this update</span>
                </div>
                <div class="metric">
                    <span class="value">{{ metrics.pct }}%</span>
                    <span class="label">of devices on channel</span>
                </div>
            </div>

            <h2>Assets</h2>
            <div class="table-wrap card">
                <table class="assets data-table">
                    <thead>
                        <tr>
                            <th scope="col">Key</th>
                            <th scope="col">Platform</th>
                            <th scope="col">Type</th>
                            <th scope="col">Size</th>
                            <th scope="col">Launch?</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="a in update.assets" :key="a.id">
                            <td>
                                <code>{{ a.key }}</code>
                            </td>
                            <td>{{ a.platform }}</td>
                            <td>{{ a.contentType }}</td>
                            <td>{{ formatSize(a.size) }}</td>
                            <td>{{ a.isLaunchAsset ? 'yes' : '' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>

<script lang="ts" setup>
import { dataFromAsync } from '@zyno-io/openapi-client-codegen';
import { handleErrorAndAlert } from '@zyno-io/vue-foundation';
import { format } from 'date-fns';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import {
    AppsApi,
    type IAppDetailResponse,
    type IUpdateAssetResponse,
    type IUpdateResponse,
    MetricsApi,
    UpdatesApi
} from '@/openapi-client-generated';
import LoaderModal from '@/shared/components/loader-modal.vue';

const route = useRoute();
const appId = computed(() => route.params.appId as string);
const channelId = computed(() => route.params.channelId as string);
const updateId = computed(() => route.params.updateId as string);

const isLoading = ref(true);
const app = ref<IAppDetailResponse>();
const update = ref<IUpdateResponse & { assets: IUpdateAssetResponse[] }>();
const metrics = ref<{ devicesOnUpdate: number; pct: number; totalDevicesOnChannel: number }>();
const updatePlatform = computed(() => (update.value as (IUpdateResponse & { platform?: string }) | undefined)?.platform ?? 'ios');
const commitUrl = computed(() => {
    if (!app.value?.webUrl || !update.value) return null;
    return `${app.value.webUrl}/-/commit/${update.value.commitHash}`;
});

async function load() {
    try {
        isLoading.value = true;
        [app.value, update.value, metrics.value] = await Promise.all([
            dataFromAsync(AppsApi.getAppsShow({ path: { id: appId.value } })),
            dataFromAsync(
                UpdatesApi.getUpdatesShow({
                    path: { appId: appId.value, channelId: channelId.value, id: updateId.value }
                })
            ),
            dataFromAsync(MetricsApi.getMetricsUpdateMetrics({ path: { appId: appId.value, updateId: updateId.value } }))
        ]);
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        isLoading.value = false;
    }
}

function formatDate(d: string | Date): string {
    return format(new Date(d), 'PPpp');
}
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

onMounted(load);
</script>

<style lang="scss" scoped>
#update-detail {
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.back {
    font-size: 12px;
    color: var(--text-3);
}
h1 {
    margin-top: 8px;
    overflow-wrap: anywhere;
}
h1 .commit-link {
    font-family: var(--font-mono);
    color: var(--link);
}
.meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-3);
}
</style>
