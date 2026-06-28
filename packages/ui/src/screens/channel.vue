<template>
    <div id="channel-detail">
        <LoaderModal v-if="isLoading" />

        <template v-else-if="channel && app">
            <div class="header">
                <div>
                    <RouterLink :to="`/apps/${app.id}`" class="back">&larr; {{ app.name }}</RouterLink>
                    <h1>{{ channel.name }}</h1>
                    <div class="branch"><i class="fa fa-code-branch" /> {{ channel.branchName }}</div>
                </div>
                <div class="header-actions">
                    <button v-if="canManage" @click="openSettings"><i class="fa fa-gear" /> Settings</button>
                    <button v-if="canOperate" @click="openMemberEditor('staging')"><i class="fa fa-vial" /> Staging cohort</button>
                    <button v-if="canOperate" @click="openMemberEditor('canary')"><i class="fa fa-flask" /> Canary cohort</button>
                </div>
            </div>

            <div class="platforms">
                <div v-for="platform in platforms" :key="platform" class="platform-card">
                    <div class="platform-header">
                        <i :class="platformIcon(platform)" />
                        <h3>{{ platformLabel(platform) }}</h3>
                    </div>

                    <div class="platform-row">
                        <span class="row-label">Latest binary</span>
                        <div class="row-value">
                            <template v-if="latestBinaries[platform]">
                                <span class="version">v{{ latestBinaries[platform]!.binaryVersion }}</span>
                                <span class="meta">
                                    <a
                                        v-if="commitUrl(latestBinaries[platform]!.commitHash)"
                                        class="commit-link"
                                        :href="commitUrl(latestBinaries[platform]!.commitHash)!"
                                        target="_blank"
                                        rel="noopener"
                                        >{{ latestBinaries[platform]!.commitHash.substring(0, 7) }}</a
                                    >
                                    <code v-else class="commit-link">{{ latestBinaries[platform]!.commitHash.substring(0, 7) }}</code>
                                    · {{ latestBinaries[platform]!.commitAuthor }}
                                </span>
                                <code class="fingerprint" :title="latestBinaries[platform]!.fingerprint">{{
                                    latestBinaries[platform]!.fingerprint
                                }}</code>
                            </template>
                            <span v-else class="empty">No binary builds recorded yet.</span>
                        </div>
                    </div>

                    <div class="platform-row">
                        <span class="row-label">{{ platform === 'ios' ? 'App Store' : 'Play Store' }}</span>
                        <div class="row-value">
                            <template v-if="storeTrackingEnabled(platform) && latestStore[platform]">
                                <span class="version">v{{ latestStore[platform]!.version }}</span>
                                <span class="meta">first detected {{ formatDate(latestStore[platform]!.firstDetectedAt) }}</span>
                            </template>
                            <span v-else-if="storeTrackingEnabled(platform)" class="empty">Tracking enabled, no version detected yet.</span>
                            <span v-else-if="storeBundleId(platform)" class="empty">Tracking disabled.</span>
                            <span v-else class="empty">Not configured.</span>
                        </div>
                    </div>

                    <div class="platform-row">
                        <span class="row-label">Native update</span>
                        <div class="row-value">
                            <template v-if="nativeUpdateRequiredAt(platform)">
                                <span :class="['pill', nativeUpdatePillClass(platform)]">
                                    <i class="fa fa-triangle-exclamation" />
                                    {{ nativeUpdateLabel(platform) }}
                                </span>
                            </template>
                            <span v-else class="empty">Not required.</span>
                        </div>
                    </div>
                </div>
            </div>

            <h2>OTA updates</h2>
            <div v-if="!updates?.length" class="empty-block">
                <i class="fa fa-arrow-up-from-bracket" />
                <p>No updates yet. Push from your CI to get started.</p>
            </div>
            <div v-else class="updates-grid">
                <div v-for="platform in platforms" :key="platform" class="updates-column">
                    <div class="updates-column-header">
                        <i :class="platformIcon(platform)" />
                        <h3>{{ platformLabel(platform) }}</h3>
                    </div>
                    <div v-if="!updatesByPlatform[platform].length" class="empty">No updates yet.</div>
                    <div v-else class="updates">
                        <div
                            v-for="u in updatesByPlatform[platform]"
                            :key="u.id"
                            :class="['update', { superseded: isSuperseded(u), canceled: u.status === 'canceled' }]"
                            @click="$router.push({ name: 'update', params: { appId: app.id, channelId: channel.id, updateId: u.id } })"
                        >
                            <div class="info">
                                <div class="row">
                                    <span :class="['status', statusClass(u)]">{{ statusLabel(u) }}</span>
                                    <span v-if="isSuperseded(u) && u.status !== 'rolled-back'" class="status superseded">superseded</span>
                                    <span class="headline">{{ primaryLabel(u) }}</span>
                                </div>
                                <div class="row sub">
                                    <a
                                        v-if="commitUrl(u.commitHash)"
                                        class="commit-link"
                                        :href="commitUrl(u.commitHash)!"
                                        target="_blank"
                                        rel="noopener"
                                        @click.stop
                                        >{{ u.commitHash.substring(0, 8) }}</a
                                    >
                                    <code v-else class="commit-link">{{ u.commitHash.substring(0, 8) }}</code>
                                    <span class="subject">{{ u.commitSubject }}</span>
                                </div>
                                <span class="meta">{{ u.runtimeVersion }} · {{ formatDate(u.createdAt) }} · {{ u.commitAuthor }}</span>
                            </div>
                            <div v-if="canOperate" class="actions">
                                <template v-if="isLivePending(u)">
                                    <button class="primary" @click.stop="promote(u)">
                                        {{ nextTierLabel(u.status) }}
                                    </button>
                                    <button class="ghost" @click.stop="cancel(u)">Cancel</button>
                                </template>
                                <button v-else-if="isLiveRelease(u)" class="danger" @click.stop="rollback(u)">Rollback</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <VfModal v-if="memberEditorTier && channel" @close="memberEditorTier = null">
            <div class="modal-form">
                <h2>{{ memberEditorTier === 'staging' ? 'Staging' : 'Canary' }} cohort</h2>
                <p class="hint">
                    Requests are matched by device ID (<code>mus-device-id</code>). The {{ memberEditorTier }} cohort receives every update at the
                    {{ memberEditorTier }} tier and above.
                </p>
                <div class="member-list">
                    <div v-for="(m, i) in memberEditorRows" :key="i" class="member-row">
                        <input v-model="m.id" type="text" placeholder="device id" />
                        <input v-model="m.comment" type="text" placeholder="comment (optional)" />
                        <button type="button" class="icon-btn" @click="memberEditorRows.splice(i, 1)" title="Remove">
                            <i class="fa fa-trash" />
                        </button>
                    </div>
                    <div v-if="!memberEditorRows.length" class="empty">No members yet.</div>
                </div>
                <button type="button" class="add-row" @click="memberEditorRows.push({ type: 'device', id: '', comment: '' })">
                    <i class="fa fa-plus" /> Add device
                </button>
                <div class="actions">
                    <button type="button" @click="memberEditorTier = null">Cancel</button>
                    <button type="button" class="primary" :disabled="savingMembers" @click="saveMembers">
                        {{ savingMembers ? 'Saving...' : 'Save' }}
                    </button>
                </div>
            </div>
        </VfModal>

        <VfModal v-if="showSettings && channel" @close="showSettings = false">
            <div class="modal-form settings">
                <h2>Channel settings</h2>

                <div v-for="platform in platforms" :key="platform" class="platform-section">
                    <div class="section-header">
                        <i :class="platformIcon(platform)" />
                        <h3>{{ platformLabel(platform) }}</h3>
                    </div>

                    <label
                        >{{ platform === 'ios' ? 'iOS bundle ID' : 'Android package name' }}
                        <input v-model="settingsForm[platform].bundleId" type="text" placeholder="com.example.app" />
                    </label>

                    <label class="checkbox">
                        <input v-model="settingsForm[platform].trackingEnabled" type="checkbox" />
                        <span>Track {{ platform === 'ios' ? 'App Store' : 'Google Play' }} version</span>
                    </label>

                    <fieldset v-if="settingsForm[platform].trackingEnabled" class="native-update">
                        <legend>Force native update</legend>

                        <label class="checkbox">
                            <input
                                type="checkbox"
                                :checked="settingsForm[platform].requireMode === 'immediate'"
                                @change="setRequireMode(platform, ($event.target as HTMLInputElement).checked ? 'immediate' : 'none')"
                            />
                            <span>Require an immediate native update</span>
                        </label>

                        <label class="checkbox">
                            <input
                                type="checkbox"
                                :checked="settingsForm[platform].requireMode === 'after-days'"
                                @change="setRequireMode(platform, ($event.target as HTMLInputElement).checked ? 'after-days' : 'none')"
                            />
                            <span class="checkbox-block">
                                <span>Require a native update after a new store version is detected</span>
                                <span class="after-days-row">
                                    <input
                                        v-model.number="settingsForm[platform].afterDays"
                                        type="number"
                                        min="0"
                                        class="inline-number"
                                        :disabled="settingsForm[platform].requireMode !== 'after-days'"
                                    />
                                    <span>days after detection</span>
                                </span>
                            </span>
                        </label>

                        <p v-if="settingsForm[platform].requireMode === 'after-days' && !latestStore[platform]" class="hint warn">
                            <i class="fa fa-circle-info" /> No store version detected yet — this will activate when one is.
                        </p>
                    </fieldset>
                </div>

                <p class="hint">
                    Tip: leave a cohort empty to skip that tier — a channel with no staging or canary members will release new builds immediately on
                    finalize.
                </p>

                <div class="actions">
                    <button type="button" @click="showSettings = false">Cancel</button>
                    <button type="button" class="primary" :disabled="savingSettings" @click="saveSettings">
                        {{ savingSettings ? 'Saving...' : 'Save' }}
                    </button>
                </div>
            </div>
        </VfModal>
    </div>
</template>

<script lang="ts" setup>
import { dataFromAsync } from '@zyno-io/openapi-client-codegen';
import { handleErrorAndAlert, showConfirm, showConfirmDestroy, VfModal } from '@zyno-io/vue-foundation';
import { format, formatDistanceToNow } from 'date-fns';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import {
    AppsApi,
    BinaryBuildsApi,
    ChannelsApi,
    StoreVersionsApi,
    type IAppDetailResponse,
    type IBinaryBuildResponse,
    type IChannelResponse,
    type IRolloutMember,
    type IStoreVersionResponse,
    type IUpdateResponse,
    UpdatesApi
} from '@/openapi-client-generated';
import LoaderModal from '@/shared/components/loader-modal.vue';

const route = useRoute();
const appId = computed(() => route.params.appId as string);
const channelId = computed(() => route.params.channelId as string);

const isLoading = ref(true);
const app = ref<IAppDetailResponse>();
const channel = ref<IChannelResponse>();
const updates = ref<IUpdateResponse[]>();
const platforms = ['ios', 'android'] as const;
type Platform = (typeof platforms)[number];
type RequireMode = 'none' | 'immediate' | 'after-days';
const latestBinaries = ref<Record<Platform, IBinaryBuildResponse | null>>({ ios: null, android: null });
const latestStore = ref<Record<Platform, IStoreVersionResponse | null>>({ ios: null, android: null });

type MemberTier = 'staging' | 'canary';
const memberEditorTier = ref<MemberTier | null>(null);
const memberEditorRows = ref<IRolloutMember[]>([]);
const savingMembers = ref(false);

const showSettings = ref(false);
const savingSettings = ref(false);

interface PlatformSettings {
    bundleId: string;
    trackingEnabled: boolean;
    requireMode: RequireMode;
    afterDays: number;
}
type SettingsForm = Record<Platform, PlatformSettings>;
const settingsForm = reactive<SettingsForm>({
    ios: { bundleId: '', trackingEnabled: false, requireMode: 'none', afterDays: 14 },
    android: { bundleId: '', trackingEnabled: false, requireMode: 'none', afterDays: 14 }
});

const canOperate = computed(() => {
    const role = app.value?.role;
    return role === 'developer' || role === 'maintainer' || role === 'owner';
});
const canManage = computed(() => {
    const role = app.value?.role;
    return role === 'maintainer' || role === 'owner';
});

watch(memberEditorTier, tier => {
    if (!tier || !channel.value) return;
    const source = tier === 'staging' ? channel.value.stagingMembers : channel.value.canaryMembers;
    memberEditorRows.value = source.map(m => ({ ...m }));
});

function openMemberEditor(tier: MemberTier) {
    memberEditorTier.value = tier;
}

function platformLabel(platform: Platform): string {
    return platform === 'ios' ? 'iOS' : 'Android';
}
function platformIcon(platform: Platform): string {
    return platform === 'ios' ? 'fa-brands fa-apple' : 'fa-brands fa-android';
}

function storeBundleId(platform: Platform): string | null {
    if (!channel.value) return null;
    return platform === 'ios' ? channel.value.iosBundleId : channel.value.androidPackageName;
}
function storeTrackingEnabled(platform: Platform): boolean {
    if (!channel.value) return false;
    const enabled = platform === 'ios' ? channel.value.iosTrackingEnabled : channel.value.androidTrackingEnabled;
    return enabled && !!storeBundleId(platform);
}

function nativeUpdateRequiredAt(platform: Platform): Date | null {
    if (!channel.value) return null;
    const raw = platform === 'ios' ? channel.value.iosNativeUpdateRequiredAt : channel.value.androidNativeUpdateRequiredAt;
    return raw ? new Date(raw) : null;
}
function nativeUpdatePillClass(platform: Platform): string {
    const at = nativeUpdateRequiredAt(platform);
    if (!at) return '';
    return at.getTime() <= Date.now() ? 'active' : 'pending';
}
function nativeUpdateLabel(platform: Platform): string {
    const at = nativeUpdateRequiredAt(platform);
    if (!at) return '';
    if (at.getTime() <= Date.now()) return `Required since ${formatDate(at)}`;
    return `Required ${formatDistanceToNow(at, { addSuffix: true })}`;
}

function deriveMode(at: Date | null, firstDetectedAt: string | Date | null): { mode: RequireMode; afterDays: number } {
    if (!at) return { mode: 'none', afterDays: 14 };
    if (at.getTime() <= Date.now()) return { mode: 'immediate', afterDays: 14 };
    if (firstDetectedAt) {
        const detected = new Date(firstDetectedAt).getTime();
        const diffDays = Math.max(1, Math.round((at.getTime() - detected) / 86_400_000));
        return { mode: 'after-days', afterDays: diffDays };
    }
    const diffFromNow = Math.max(1, Math.round((at.getTime() - Date.now()) / 86_400_000));
    return { mode: 'after-days', afterDays: diffFromNow };
}

function setRequireMode(platform: Platform, mode: RequireMode) {
    settingsForm[platform].requireMode = mode;
}

function openSettings() {
    if (!channel.value) return;
    for (const platform of platforms) {
        const bundleId = platform === 'ios' ? channel.value.iosBundleId : channel.value.androidPackageName;
        const trackingEnabled = platform === 'ios' ? channel.value.iosTrackingEnabled : channel.value.androidTrackingEnabled;
        const requiredAt = nativeUpdateRequiredAt(platform);
        const detected = latestStore.value[platform]?.firstDetectedAt ?? null;
        const { mode, afterDays } = deriveMode(requiredAt, detected);
        settingsForm[platform].bundleId = bundleId ?? '';
        settingsForm[platform].trackingEnabled = trackingEnabled;
        settingsForm[platform].requireMode = mode;
        settingsForm[platform].afterDays = afterDays;
    }
    showSettings.value = true;
}

function computeRequiredAt(platform: Platform): string | null {
    const form = settingsForm[platform];
    if (!form.trackingEnabled) return null;
    if (form.requireMode === 'none') return null;
    if (form.requireMode === 'immediate') return new Date().toISOString();
    const days = Number(form.afterDays);
    if (!Number.isFinite(days) || days < 0) return null;
    const detected = latestStore.value[platform]?.firstDetectedAt;
    if (!detected) return null;
    const ms = new Date(detected).getTime() + days * 86_400_000;
    return new Date(ms).toISOString();
}

async function load() {
    try {
        isLoading.value = true;
        app.value = await dataFromAsync(AppsApi.getAppsShow({ path: { id: appId.value } }));
        channel.value = await dataFromAsync(ChannelsApi.getChannelsShow({ path: { appId: appId.value, id: channelId.value } }));
        updates.value = await dataFromAsync(UpdatesApi.getUpdatesIndex({ path: { appId: appId.value, channelId: channelId.value } }));
        const [binariesByPlatform, storeByPlatform] = await Promise.all([
            Promise.all(
                platforms.map(async platform => {
                    const latestResp = await dataFromAsync(
                        BinaryBuildsApi.getBinaryBuildsLatest({
                            path: { appId: appId.value, channelId: channelId.value },
                            query: { platform }
                        } as never)
                    );
                    return [platform, latestResp.latest] as const;
                })
            ),
            Promise.all(
                platforms.map(async platform => {
                    const latestResp = await dataFromAsync(
                        StoreVersionsApi.getStoreVersionsLatest({
                            path: { appId: appId.value, channelId: channelId.value },
                            query: { platform }
                        } as never)
                    );
                    return [platform, latestResp.latest] as const;
                })
            )
        ]);
        latestBinaries.value = Object.fromEntries(binariesByPlatform) as Record<Platform, IBinaryBuildResponse | null>;
        latestStore.value = Object.fromEntries(storeByPlatform) as Record<Platform, IStoreVersionResponse | null>;
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        isLoading.value = false;
    }
}

async function saveMembers() {
    if (!app.value || !channel.value || !memberEditorTier.value) return;
    try {
        savingMembers.value = true;
        const members = memberEditorRows.value
            .map(m => ({ type: 'device' as const, id: m.id.trim(), comment: (m.comment ?? '').trim() }))
            .filter(m => m.id);
        const path = { appId: app.value.id, id: channel.value.id };
        if (memberEditorTier.value === 'staging') {
            await dataFromAsync(ChannelsApi.putChannelsUpdateStagingMembers({ path, body: { stagingMembers: members } }));
        } else {
            await dataFromAsync(ChannelsApi.putChannelsUpdateCanaryMembers({ path, body: { canaryMembers: members } }));
        }
        memberEditorTier.value = null;
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        savingMembers.value = false;
    }
}

async function saveSettings() {
    if (!app.value || !channel.value) return;
    try {
        savingSettings.value = true;
        await dataFromAsync(
            ChannelsApi.putChannelsUpdate({
                path: { appId: app.value.id, id: channel.value.id },
                body: {
                    iosBundleId: settingsForm.ios.bundleId.trim() || null,
                    androidPackageName: settingsForm.android.bundleId.trim() || null,
                    iosTrackingEnabled: settingsForm.ios.trackingEnabled,
                    androidTrackingEnabled: settingsForm.android.trackingEnabled,
                    iosNativeUpdateRequiredAt: computeRequiredAt('ios'),
                    androidNativeUpdateRequiredAt: computeRequiredAt('android')
                }
            })
        );
        showSettings.value = false;
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        savingSettings.value = false;
    }
}

function nextTierFor(status: 'staging' | 'canary'): 'canary' | 'released' {
    // Mirror server-side nextTier: from staging, skip canary if its cohort is empty.
    if (status === 'staging') {
        const canaryPopulated = (channel.value?.canaryMembers.length ?? 0) > 0;
        return canaryPopulated ? 'canary' : 'released';
    }
    return 'released';
}

function nextTierLabel(status: string): string {
    if (status !== 'staging' && status !== 'canary') return '';
    return nextTierFor(status) === 'canary' ? 'Promote' : 'Release';
}

async function promote(update: IUpdateResponse) {
    if (!app.value || !channel.value) return;
    if (update.status !== 'staging' && update.status !== 'canary') return;
    const next = nextTierFor(update.status);
    const msg =
        next === 'released'
            ? 'Promote this update to released? Every device on this channel + runtime version will receive it on next check-in.'
            : 'Promote this update to the canary tier? Devices in the canary cohort will start receiving it.';
    const ok = await showConfirm('Promote update', msg);
    if (!ok) return;
    try {
        await dataFromAsync(
            UpdatesApi.postUpdatesPromote({
                path: { appId: app.value.id, channelId: channel.value.id, id: update.id }
            })
        );
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    }
}

async function cancel(update: IUpdateResponse) {
    if (!app.value || !channel.value) return;
    if (update.status !== 'staging' && update.status !== 'canary') return;
    const ok = await showConfirmDestroy('Cancel update', `Cancel ${primaryLabel(update)}? It will be removed from the rollout pipeline.`);
    if (!ok) return;
    try {
        await dataFromAsync(
            UpdatesApi.postUpdatesCancel({
                path: { appId: app.value.id, channelId: channel.value.id, id: update.id }
            })
        );
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    }
}

async function rollback(update: IUpdateResponse) {
    if (!app.value || !channel.value) return;
    if (!isLiveRelease(update)) return;
    const ok = await showConfirmDestroy(
        'Roll back release',
        `Roll back ${primaryLabel(update)}? Devices will revert to the prior release for this runtime on next check-in.`
    );
    if (!ok) return;
    try {
        await dataFromAsync(
            UpdatesApi.postUpdatesRollback({
                path: { appId: app.value.id, channelId: channel.value.id, id: update.id }
            })
        );
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    }
}

function formatDate(d: string | Date): string {
    return format(new Date(d), 'MMM d, h:mm a');
}

function updatePlatform(update: IUpdateResponse): Platform {
    const p = (update as IUpdateResponse & { platform?: string }).platform;
    return p === 'android' ? 'android' : 'ios';
}

function primaryLabel(u: IUpdateResponse): string {
    const v = u.otaVersion?.trim();
    return v ? v : u.id.substring(0, 8);
}

function commitUrl(commitHash: string): string | null {
    const base = app.value?.webUrl;
    if (!base) return null;
    return `${base}/-/commit/${commitHash}`;
}

function isSuperseded(u: IUpdateResponse): boolean {
    return u.supersededAt !== null;
}

function isLiveRelease(u: IUpdateResponse): boolean {
    return u.status === 'released' && !isSuperseded(u);
}

function isLivePending(u: IUpdateResponse): boolean {
    return (u.status === 'staging' || u.status === 'canary') && !isSuperseded(u);
}

function statusLabel(u: IUpdateResponse): string {
    return u.status === 'rolled-back' ? 'rolled back' : u.status;
}

function statusClass(u: IUpdateResponse): string {
    return u.status === 'rolled-back' ? 'rolled-back' : u.status;
}

const updatesByPlatform = computed<Record<Platform, IUpdateResponse[]>>(() => {
    const grouped: Record<Platform, IUpdateResponse[]> = { ios: [], android: [] };
    for (const u of updates.value ?? []) {
        grouped[updatePlatform(u)].push(u);
    }
    return grouped;
});

onMounted(load);
</script>

<style lang="scss" scoped>
@reference "tailwindcss";

#channel-detail {
    @apply flex flex-col gap-6;
}

.header {
    @apply flex items-start justify-between gap-4;
}

.header-actions {
    @apply flex items-center gap-2 flex-wrap;
    button {
        @apply flex items-center gap-1.5;
        i {
            @apply text-xs;
        }
    }
}

.back {
    @apply text-xs text-neutral-500;
}

.branch {
    @apply text-xs text-neutral-500 mt-1 flex items-center gap-1.5;
    i {
        @apply text-[10px];
    }
}

.empty {
    @apply text-neutral-500 text-sm;
}

.empty-block {
    @apply flex flex-col items-center gap-2 py-10 text-neutral-500 border border-dashed border-neutral-500/25 rounded-lg;
    i {
        @apply text-2xl;
    }
    p {
        @apply text-sm;
    }
}

.platforms {
    @apply grid gap-4;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
}

.platform-card {
    @apply flex flex-col gap-2 p-4 border border-neutral-500/25 rounded-lg;
}

.platform-header {
    @apply flex items-center gap-2 mb-1;
    i {
        @apply text-xl text-neutral-600;
    }
    h3 {
        @apply text-base font-semibold;
    }
}

html.dark .platform-header i {
    @apply text-neutral-300;
}

.platform-row {
    /* 2-col grid so when the value column wraps (long fingerprint + meta),
       the wrapped content stays aligned under the value, not back at the label. */
    @apply grid items-baseline gap-x-3 gap-y-0.5 text-sm py-1;
    grid-template-columns: 120px minmax(0, 1fr);

    .row-label {
        @apply text-xs uppercase tracking-wide text-neutral-500 pt-0.5;
    }
    .row-value {
        @apply flex items-center gap-3 flex-wrap min-w-0;
    }
    .version {
        @apply font-semibold;
    }
    .fingerprint {
        @apply text-xs font-mono px-2 py-0.5 bg-neutral-100 rounded max-w-[220px] truncate;
    }
    .meta {
        @apply text-xs text-neutral-500;
    }
    .commit-link {
        @apply font-mono text-blue-700 hover:underline;
    }
    .empty {
        @apply text-xs text-neutral-500;
    }
    .pill {
        @apply text-xs uppercase tracking-wide px-2 py-0.5 rounded-md flex items-center gap-1.5;
        i {
            @apply text-[10px];
        }
        &.active {
            @apply bg-red-200 text-red-900;
        }
        &.pending {
            @apply bg-amber-200 text-amber-900;
        }
    }
}

html.dark .platform-row {
    .fingerprint {
        @apply bg-neutral-800;
    }
    .commit-link {
        @apply text-blue-400;
    }
}

.updates-grid {
    /* Match the .platforms grid above so each column aligns under its platform card. */
    @apply grid gap-4;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
}

.updates-column {
    @apply flex flex-col gap-2 min-w-0;

    .empty {
        @apply text-xs text-neutral-500 italic py-2;
    }
}

.updates-column-header {
    @apply flex items-center gap-2 mb-1;
    i {
        @apply text-base text-neutral-600;
    }
    h3 {
        @apply text-sm font-semibold;
    }
}

html.dark .updates-column-header i {
    @apply text-neutral-300;
}

.updates {
    @apply flex flex-col gap-2 min-w-0;
}

.update {
    @apply flex items-start justify-between gap-3 p-3 border border-neutral-500/25 rounded-md cursor-pointer hover:bg-neutral-100 transition-colors min-w-0;

    &.superseded,
    &.canceled {
        @apply opacity-60;
    }

    .info {
        @apply flex flex-col gap-1 min-w-0 flex-1;
    }
    .row {
        @apply flex items-center gap-2 min-w-0 flex-wrap;

        &.sub {
            @apply text-sm;
        }
    }
    .status {
        @apply text-xs uppercase tracking-wide w-fit px-2 py-0.5 rounded-md flex-shrink-0;

        &.staging {
            @apply bg-purple-200 text-purple-900;
        }
        &.canary {
            @apply bg-amber-200 text-amber-900;
        }
        &.released {
            @apply bg-green-200 text-green-900;
        }
        &.draft,
        &.canceled {
            @apply bg-neutral-200 text-neutral-700;
        }
        &.rolled-back {
            @apply bg-red-200 text-red-900;
        }
        &.superseded {
            @apply bg-neutral-300 text-neutral-700;
        }
    }
    .headline {
        @apply text-sm font-semibold font-mono truncate;
    }
    .commit-link {
        @apply text-xs font-mono px-1.5 py-0.5 bg-neutral-100 rounded text-blue-700 hover:underline flex-shrink-0;
    }
    .subject {
        @apply text-xs text-neutral-600 truncate;
    }
    .meta {
        @apply text-xs text-neutral-500;
    }
    .actions {
        @apply flex flex-col gap-1 flex-shrink-0;
        button {
            @apply text-xs px-2 py-1;
        }
        .danger {
            @apply bg-red-600 text-white hover:bg-red-700;
        }
        .ghost {
            @apply bg-transparent border border-neutral-400 text-neutral-700 hover:bg-neutral-100;
        }
    }
}

html.dark .update {
    .commit-link {
        @apply bg-neutral-800 text-blue-400;
    }
    .subject {
        @apply text-neutral-400;
    }
    .actions .ghost {
        @apply text-neutral-200 border-neutral-600 hover:bg-neutral-800;
    }
}

html.dark .update:hover {
    @apply bg-neutral-800;
}

.modal-form {
    /* No outer padding — the wrapping .vf-modal-content already pads us. */
    @apply flex flex-col gap-3 w-[520px];

    .hint {
        @apply text-xs text-neutral-500;
        &.warn {
            @apply text-amber-600;
        }
    }
    label.checkbox {
        @apply flex flex-row items-start gap-2 text-sm cursor-pointer;
        input[type='checkbox'] {
            @apply mt-0.5 w-4 h-4 shrink-0 accent-blue-600;
        }
        > span {
            @apply leading-snug;
        }
        &:has(input:disabled) {
            @apply cursor-not-allowed opacity-50;
        }
    }
    input:disabled,
    textarea:disabled {
        @apply opacity-50 cursor-not-allowed;
    }
    textarea {
        @apply font-mono text-xs;
    }
    .actions {
        @apply flex justify-end gap-2 mt-2;
    }
    .member-list {
        @apply flex flex-col gap-1 max-h-[40vh] overflow-y-auto;
        .empty {
            @apply text-xs text-neutral-500 italic py-2;
        }
    }
    .member-row {
        @apply grid items-center gap-2;
        grid-template-columns: 90px 1fr 1fr auto;
        select,
        input {
            @apply text-sm;
        }
    }
    .icon-btn {
        @apply text-neutral-500 hover:text-red-600 px-2;
    }
    .add-row {
        @apply self-start text-sm flex items-center gap-1.5;
        i {
            @apply text-xs;
        }
    }
}

.modal-form.settings {
    .platform-section {
        @apply flex flex-col gap-2 p-3 border border-neutral-500/20 rounded-lg;
    }
    .section-header {
        @apply flex items-center gap-2 mb-1;
        i {
            @apply text-base;
        }
        h3 {
            @apply text-sm font-semibold;
        }
    }
    fieldset.native-update {
        @apply flex flex-col gap-2 mt-1 p-3 border border-neutral-500/15 rounded-md;
        legend {
            @apply text-xs uppercase tracking-wide text-neutral-500 px-1;
        }
    }
    .checkbox-block {
        @apply flex flex-col gap-1.5;
    }
    .after-days-row {
        @apply flex items-center gap-2 text-neutral-500;
    }
    .inline-number {
        @apply w-16 text-center;
    }
}
</style>
