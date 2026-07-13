import { createPersistedEntity, DatabaseSession, uuid7 } from '@zyno-io/ts-server-foundation';

import { ChannelEntity, NativeUpdateMode } from '../entities/Channel.entity';
import { StoreVersionEntity } from '../entities/StoreVersion.entity';
import { TargetPlatform } from '../entities/UpdateAsset.entity';
import { IStoreVersionLookupResult } from './StoreLookup.service';

const DAY_MS = 86_400_000;

export interface IStoreVersionRecordResult {
    storeVersion: StoreVersionEntity;
    created: boolean;
}

export function nativeUpdatePolicy(
    channel: ChannelEntity,
    platform: TargetPlatform
): {
    mode: NativeUpdateMode;
    afterDays: number | null;
} {
    return platform === 'ios'
        ? { mode: channel.iosNativeUpdateMode, afterDays: channel.iosNativeUpdateAfterDays }
        : { mode: channel.androidNativeUpdateMode, afterDays: channel.androidNativeUpdateAfterDays };
}

export function nativeUpdateRequiredAtFor(
    channel: ChannelEntity,
    platform: TargetPlatform,
    firstDetectedAt: Date,
    immediateAt = firstDetectedAt
): Date | null {
    const policy = nativeUpdatePolicy(channel, platform);
    if (policy.mode === 'none') return null;
    if (policy.mode === 'immediate') return immediateAt;
    if (policy.afterDays === null) return null;
    return new Date(firstDetectedAt.getTime() + policy.afterDays * DAY_MS);
}

export async function recordDetectedStoreVersion(
    channel: ChannelEntity,
    platform: TargetPlatform,
    lookedUpStoreIdentifier: string,
    result: IStoreVersionLookupResult
): Promise<IStoreVersionRecordResult | null> {
    return ChannelEntity.getDatabase().transaction(async session => {
        await session.acquireSessionLock(storeVersionLockKey(channel.id, platform));

        // Polling can overlap a settings save. Re-read under the lock so a stale job
        // instance cannot calculate the new store version against an old policy.
        const freshChannel = await session.query(ChannelEntity).filter({ id: channel.id, deletedAt: null }).findOneOrUndefined();
        if (!freshChannel) return null;

        const storeUrlField = platform === 'ios' ? 'iosStoreUrl' : 'androidStoreUrl';
        const storeIdentifierField = platform === 'ios' ? 'iosBundleId' : 'androidPackageName';
        const trackingEnabledField = platform === 'ios' ? 'iosTrackingEnabled' : 'androidTrackingEnabled';
        const storeIdentifier = platform === 'ios' ? freshChannel.iosBundleId : freshChannel.androidPackageName;
        const trackingEnabled = platform === 'ios' ? freshChannel.iosTrackingEnabled : freshChannel.androidTrackingEnabled;
        // A lookup may finish after settings changed. Never attach the old app's result
        // to the channel's new bundle/package or record it after tracking was disabled.
        if (!trackingEnabled || storeIdentifier !== lookedUpStoreIdentifier) return null;

        if (freshChannel[storeUrlField] !== result.storeUrl) {
            const updated = await session
                .query(ChannelEntity)
                .filter({ id: freshChannel.id })
                .filterField(storeIdentifierField, lookedUpStoreIdentifier)
                .filterField(trackingEnabledField, true)
                .patchOne({ [storeUrlField]: result.storeUrl });
            // Settings changed after the lookup completed; discard this stale result.
            if (updated.modified === 0) return null;
        }

        const latest = await latestStoreVersion(freshChannel.id, platform, storeIdentifier, session);
        if (latest?.version === result.version) {
            await updateLegacyDeadline(freshChannel.id, platform, storeIdentifier, latest.nativeUpdateRequiredAt, session);
            return { storeVersion: latest, created: false };
        }

        const firstDetectedAt = new Date();
        const nativeUpdateRequiredAt = nativeUpdateRequiredAtFor(freshChannel, platform, firstDetectedAt);
        const storeVersion = await createPersistedEntity(
            StoreVersionEntity,
            {
                id: uuid7(),
                appId: freshChannel.appId,
                channelId: freshChannel.id,
                platform,
                storeIdentifier,
                version: result.version,
                firstDetectedAt,
                nativeUpdateRequiredAt
            },
            session
        );
        await updateLegacyDeadline(freshChannel.id, platform, storeIdentifier, nativeUpdateRequiredAt, session);
        return { storeVersion, created: true };
    });
}

export async function recalculateLatestStoreVersionDeadline(
    channel: ChannelEntity,
    platform: TargetPlatform,
    immediateAt = new Date()
): Promise<StoreVersionEntity | null> {
    return ChannelEntity.getDatabase().transaction(async session => {
        await session.acquireSessionLock(storeVersionLockKey(channel.id, platform));

        const freshChannel = await session.query(ChannelEntity).filter({ id: channel.id, deletedAt: null }).findOne();
        const storeIdentifier = platform === 'ios' ? freshChannel.iosBundleId : freshChannel.androidPackageName;
        const latest = await latestStoreVersion(freshChannel.id, platform, storeIdentifier, session);
        if (!latest) {
            await updateLegacyDeadline(freshChannel.id, platform, storeIdentifier, null, session);
            return null;
        }

        latest.nativeUpdateRequiredAt = nativeUpdateRequiredAtFor(freshChannel, platform, latest.firstDetectedAt, immediateAt);
        await latest.save(session);
        await updateLegacyDeadline(freshChannel.id, platform, storeIdentifier, latest.nativeUpdateRequiredAt, session);
        return latest;
    });
}

export async function latestStoreVersion(
    channelId: string,
    platform: TargetPlatform,
    storeIdentifier: string | null,
    session?: DatabaseSession
): Promise<StoreVersionEntity | null> {
    return (
        (await StoreVersionEntity.query(session)
            .filter({ channelId, platform, storeIdentifier })
            .sort({ firstDetectedAt: 'desc', id: 'desc' })
            .findOneOrUndefined()) ?? null
    );
}

function storeVersionLockKey(channelId: string, platform: TargetPlatform): string[] {
    return ['mus', 'store-version', channelId, platform];
}

async function updateLegacyDeadline(
    channelId: string,
    platform: TargetPlatform,
    storeIdentifier: string | null,
    nativeUpdateRequiredAt: Date | null,
    session: DatabaseSession
): Promise<void> {
    const storeIdentifierField = platform === 'ios' ? 'iosBundleId' : 'androidPackageName';
    const deadlineField = platform === 'ios' ? 'iosNativeUpdateRequiredAt' : 'androidNativeUpdateRequiredAt';
    await session
        .query(ChannelEntity)
        .filter({ id: channelId })
        .filterField(storeIdentifierField, storeIdentifier)
        .patchOne({ [deadlineField]: nativeUpdateRequiredAt });
}
