<template>
    <div id="app-detail">
        <LoaderModal v-if="isLoading" />

        <template v-else-if="app">
            <div class="header">
                <div>
                    <h1>{{ app.name }}</h1>
                    <a v-if="app.webUrl" :href="app.webUrl" target="_blank" class="repo-link">{{ app.projectPath }}</a>
                </div>
                <button v-if="canManage" @click="showCreateChannel = true">New channel</button>
            </div>

            <div class="metrics" v-if="metrics">
                <div class="metric">
                    <span class="value">{{ metrics.totalDevices }}</span>
                    <span class="label">total devices</span>
                </div>
                <div class="metric">
                    <span class="value">{{ metrics.checkedInWithinPct }}%</span>
                    <span class="label">checked in last 24h</span>
                </div>
                <div class="metric" v-for="p in metrics.platformDistribution" :key="p.platform">
                    <span class="value">{{ p.count }}</span>
                    <span class="label">{{ p.platform }}</span>
                </div>
            </div>

            <h2>Channels</h2>
            <div class="channel-list">
                <div v-if="!channels?.length" class="empty">No channels yet.</div>
                <div
                    v-for="ch in channels"
                    :key="ch.id"
                    class="channel"
                    @click="$router.push({ name: 'channel', params: { appId: app.id, channelId: ch.id } })"
                >
                    <div>
                        <div class="name">{{ ch.name }}</div>
                        <div class="meta">
                            {{ channelBranch(ch) }} · {{ ch.stagingMembers?.length ?? 0 }} staging, {{ ch.canaryMembers.length }} canary
                        </div>
                    </div>
                    <i class="fa fa-chevron-right" />
                </div>
            </div>
        </template>

        <VfModal v-if="showCreateChannel" @close="showCreateChannel = false">
            <div class="modal-form">
                <h2>New channel</h2>
                <form @submit.prevent="createChannel">
                    <label>
                        Name
                        <input v-model="newChannelName" type="text" placeholder="e.g. production" required />
                    </label>
                    <label>
                        Git branch
                        <input v-model="newChannelBranch" type="text" placeholder="e.g. main" required />
                    </label>
                    <div class="actions">
                        <button type="button" @click="showCreateChannel = false">Cancel</button>
                        <button type="submit" class="primary" :disabled="creating">
                            {{ creating ? 'Creating...' : 'Create' }}
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
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { AppsApi, ChannelsApi, type IAppDetailResponse, type IChannelResponse, type IMetricsResponse, MetricsApi } from '@/openapi-client-generated';
import LoaderModal from '@/shared/components/loader-modal.vue';

const route = useRoute();
const appId = computed(() => route.params.appId as string);

const isLoading = ref(true);
const app = ref<IAppDetailResponse>();
const channels = ref<IChannelResponse[]>();
const metrics = ref<IMetricsResponse>();
const showCreateChannel = ref(false);
const newChannelName = ref('');
const newChannelBranch = ref('');
const creating = ref(false);

const canManage = computed(() => app.value?.role === 'maintainer' || app.value?.role === 'owner');

async function load() {
    try {
        isLoading.value = true;
        app.value = await dataFromAsync(AppsApi.getAppsShow({ path: { id: appId.value } }));
        channels.value = await dataFromAsync(ChannelsApi.getChannelsIndex({ path: { appId: appId.value } }));
        metrics.value = await dataFromAsync(MetricsApi.getMetricsAppMetrics({ path: { appId: appId.value }, query: {} }));
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        isLoading.value = false;
    }
}

async function createChannel() {
    try {
        creating.value = true;
        await dataFromAsync(
            ChannelsApi.postChannelsCreate({
                path: { appId: appId.value },
                body: { name: newChannelName.value, branchName: newChannelBranch.value } as never
            })
        );
        showCreateChannel.value = false;
        newChannelName.value = '';
        newChannelBranch.value = '';
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        creating.value = false;
    }
}

function channelBranch(channel: IChannelResponse): string {
    return `branch ${(channel as IChannelResponse & { branchName?: string }).branchName ?? channel.name}`;
}

onMounted(load);
</script>

<style lang="scss" scoped>
@reference "tailwindcss";

#app-detail {
    @apply flex flex-col gap-4;
}

.header {
    @apply flex items-center justify-between;
}

.repo-link {
    @apply text-xs text-neutral-500;
}

.metrics {
    @apply flex gap-4 flex-wrap;

    .metric {
        @apply flex flex-col gap-0 p-4 border border-neutral-500/25 rounded-lg min-w-[120px];

        .value {
            @apply text-2xl font-semibold;
        }
        .label {
            @apply text-xs text-neutral-500 uppercase tracking-wide;
        }
    }
}

.channel-list {
    @apply flex flex-col gap-2;
}

.channel {
    @apply flex items-center justify-between p-3 border border-neutral-500/25 rounded-md cursor-pointer hover:bg-neutral-100;
    .name {
        @apply font-semibold;
    }
    .meta {
        @apply text-xs text-neutral-500;
    }
}

html.dark .channel:hover {
    @apply bg-neutral-800;
}

.empty {
    @apply text-neutral-500 text-sm py-6 text-center;
}

.modal-form {
    @apply flex flex-col gap-3 p-4 w-96;

    form {
        @apply flex flex-col gap-3;
    }
    .actions {
        @apply flex justify-end gap-2;
    }
}
</style>
