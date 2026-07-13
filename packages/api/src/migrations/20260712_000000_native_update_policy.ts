import { createMigration } from '@zyno-io/ts-server-foundation';

const DAY_MS = 86_400_000;

interface LegacyChannelRow {
    id: string;
    iosNativeUpdateRequiredAt: Date | string | null;
    androidNativeUpdateRequiredAt: Date | string | null;
}

export interface StoreVersionRow {
    id: string;
    channelId: string;
    platform: 'ios' | 'android';
    firstDetectedAt: Date | string;
}

export interface LegacyNativeUpdatePolicy {
    mode: 'immediate' | 'after-days';
    afterDays: number | null;
    latestStoreVersionId: string | null;
    latestRequiredAt: Date | null;
}

export default createMigration(async db => {
    await db.rawExecuteUnsafe(`
        ALTER TABLE channels
            ADD COLUMN iosNativeUpdateMode enum('none', 'immediate', 'after-days') NOT NULL DEFAULT 'none',
            ADD COLUMN androidNativeUpdateMode enum('none', 'immediate', 'after-days') NOT NULL DEFAULT 'none',
            ADD COLUMN iosNativeUpdateAfterDays int unsigned NULL,
            ADD COLUMN androidNativeUpdateAfterDays int unsigned NULL
    `);
    await db.rawExecuteUnsafe(`
        ALTER TABLE storeVersions
            ADD COLUMN storeIdentifier varchar(255) NULL,
            ADD COLUMN nativeUpdateRequiredAt datetime NULL
    `);
    await db.rawExecuteUnsafe(`
        UPDATE storeVersions sv
        JOIN channels c ON c.id = sv.channelId
        SET sv.storeIdentifier = CASE sv.platform
            WHEN 'ios' THEN c.iosBundleId
            WHEN 'android' THEN c.androidPackageName
        END
    `);

    const channels = await db.rawFindUnsafe<LegacyChannelRow>('SELECT id, iosNativeUpdateRequiredAt, androidNativeUpdateRequiredAt FROM channels');
    const storeVersions = await db.rawFindUnsafe<StoreVersionRow>(
        'SELECT id, channelId, platform, firstDetectedAt FROM storeVersions ORDER BY firstDetectedAt ASC, id ASC'
    );
    const storeVersionsByChannelPlatform = new Map<string, StoreVersionRow[]>();
    for (const storeVersion of storeVersions) {
        const key = channelPlatformKey(storeVersion.channelId, storeVersion.platform);
        const rows = storeVersionsByChannelPlatform.get(key) ?? [];
        rows.push(storeVersion);
        storeVersionsByChannelPlatform.set(key, rows);
    }

    for (const channel of channels) {
        for (const platform of ['ios', 'android'] as const) {
            const requiredAt = toDate(platform === 'ios' ? channel.iosNativeUpdateRequiredAt : channel.androidNativeUpdateRequiredAt);
            if (!requiredAt) continue;

            const platformVersions = storeVersionsByChannelPlatform.get(channelPlatformKey(channel.id, platform)) ?? [];
            const policy = inferLegacyNativeUpdatePolicy(requiredAt, platformVersions);
            const modeField = platform === 'ios' ? 'iosNativeUpdateMode' : 'androidNativeUpdateMode';
            const daysField = platform === 'ios' ? 'iosNativeUpdateAfterDays' : 'androidNativeUpdateAfterDays';
            const legacyDeadlineField = platform === 'ios' ? 'iosNativeUpdateRequiredAt' : 'androidNativeUpdateRequiredAt';

            await db.rawExecuteUnsafe(`UPDATE channels SET ${modeField} = ?, ${daysField} = ?, ${legacyDeadlineField} = ? WHERE id = ?`, [
                policy.mode,
                policy.afterDays,
                policy.latestRequiredAt ?? requiredAt,
                channel.id
            ]);

            if (policy.latestStoreVersionId && policy.latestRequiredAt) {
                await db.rawExecuteUnsafe('UPDATE storeVersions SET nativeUpdateRequiredAt = ? WHERE id = ?', [
                    policy.latestRequiredAt,
                    policy.latestStoreVersionId
                ]);
            }
        }
    }
    await db.rawExecuteUnsafe(
        'ALTER TABLE storeVersions ADD INDEX storeVersions_latest_idx (channelId, platform, storeIdentifier, firstDetectedAt, id)'
    );
    // Keep the legacy deadline columns as rolling-deploy/rollback compatibility caches.
    // A later cleanup migration can remove them after every deployed version understands
    // the persistent policy fields and per-store-version deadlines.
});

export function inferLegacyNativeUpdatePolicy(requiredAt: Date, storeVersions: StoreVersionRow[]): LegacyNativeUpdatePolicy {
    const orderedStoreVersions = [...storeVersions].sort((a, b) => {
        const dateDiff = toDate(a.firstDetectedAt)!.getTime() - toDate(b.firstDetectedAt)!.getTime();
        return dateDiff || a.id.localeCompare(b.id);
    });
    const delayedMatch = [...orderedStoreVersions].reverse().find(row => {
        const diff = requiredAt.getTime() - toDate(row.firstDetectedAt)!.getTime();
        return diff >= 0 && diff % DAY_MS === 0;
    });
    const afterDays = delayedMatch ? (requiredAt.getTime() - toDate(delayedMatch.firstDetectedAt)!.getTime()) / DAY_MS : null;
    const latest = orderedStoreVersions.at(-1);
    const latestDetectedAt = latest ? toDate(latest.firstDetectedAt)! : null;
    const latestRequiredAt = latest
        ? afterDays === null
            ? new Date(Math.max(requiredAt.getTime(), latestDetectedAt!.getTime()))
            : new Date(latestDetectedAt!.getTime() + afterDays * DAY_MS)
        : null;

    return {
        mode: delayedMatch ? 'after-days' : 'immediate',
        afterDays,
        latestStoreVersionId: latest?.id ?? null,
        latestRequiredAt
    };
}

function toDate(value: Date | string | null): Date | null {
    if (value === null) return null;
    return value instanceof Date ? value : new Date(value);
}

function channelPlatformKey(channelId: string, platform: 'ios' | 'android'): string {
    return `${channelId}:${platform}`;
}
