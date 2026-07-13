import { entity, PrimaryKey } from '@zyno-io/ts-server-foundation';
import { BaseEntity, UuidString } from '@zyno-io/ts-server-foundation';

import { TargetPlatform } from './UpdateAsset.entity';

export type UpdateStatus = 'draft' | 'staging' | 'canary' | 'released' | 'canceled' | 'rolled-back';

@entity.name('updates')
@entity.index(['channelId', 'platform', 'runtimeVersion', 'status', 'id'], { name: 'updates_channel_platform_runtime_idx' })
export class UpdateEntity extends BaseEntity {
    id!: UuidString & PrimaryKey;
    appId!: UuidString;
    channelId!: UuidString;
    platform!: TargetPlatform;
    runtimeVersion!: string;
    otaVersion!: string | null;
    status!: UpdateStatus;
    commitHash!: string;
    commitSubject!: string;
    commitAuthor!: string;
    ciJobId!: string;
    ciTokenHash!: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expoConfigJson!: { [key: string]: any } | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadataJson!: { [key: string]: any } | null;
    createdAt!: Date;
    releasedAt!: Date | null;
    promotedById!: UuidString | null;
    supersededAt!: Date | null;
    supersededById!: UuidString | null;
}
