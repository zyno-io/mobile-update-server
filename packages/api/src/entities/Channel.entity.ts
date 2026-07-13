import type { integer, Minimum } from '@zyno-io/ts-server-foundation';

import { entity, PrimaryKey } from '@zyno-io/ts-server-foundation';
import { BaseEntity, UuidString } from '@zyno-io/ts-server-foundation';

export type RolloutMemberType = 'device';
export type NativeUpdateMode = 'none' | 'immediate' | 'after-days';
export type NativeUpdateAfterDays = integer & Minimum<0>;

export interface IRolloutMember {
    type: RolloutMemberType;
    id: string;
    comment: string;
}

@entity.name('channels')
export class ChannelEntity extends BaseEntity {
    id!: UuidString & PrimaryKey;
    appId!: UuidString;
    name!: string;
    branchName!: string;
    iosBundleId!: string | null;
    androidPackageName!: string | null;
    iosTrackingEnabled!: boolean;
    androidTrackingEnabled!: boolean;
    iosNativeUpdateMode: NativeUpdateMode = 'none';
    androidNativeUpdateMode: NativeUpdateMode = 'none';
    iosNativeUpdateAfterDays: NativeUpdateAfterDays | null = null;
    androidNativeUpdateAfterDays: NativeUpdateAfterDays | null = null;
    // Compatibility caches for old server versions during rolling deploys/rollbacks.
    // New code reads the authoritative deadline from the latest StoreVersionEntity.
    iosNativeUpdateRequiredAt: Date | null = null;
    androidNativeUpdateRequiredAt: Date | null = null;
    iosStoreUrl!: string | null;
    androidStoreUrl!: string | null;
    // stagingMembers is nullable because the column is ADD-ed by the staging_tier
    // migration without a dialect-specific default. Treat NULL as []. canaryMembers
    // inherits NOT NULL from the pre-rename canaryDeviceIds column.
    stagingMembers!: IRolloutMember[] | null;
    canaryMembers!: IRolloutMember[];
    createdAt!: Date;
    deletedAt!: Date | null;
}
