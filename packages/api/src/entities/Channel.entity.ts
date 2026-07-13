import { entity, PrimaryKey } from '@zyno-io/ts-server-foundation';
import { BaseEntity, UuidString } from '@zyno-io/ts-server-foundation';

export type RolloutMemberType = 'device';

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
    iosNativeUpdateRequiredAt!: Date | null;
    androidNativeUpdateRequiredAt!: Date | null;
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
