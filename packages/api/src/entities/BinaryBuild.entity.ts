import { entity, PrimaryKey } from '@zyno-io/ts-server-foundation';
import { BaseEntity, UuidString } from '@zyno-io/ts-server-foundation';

import { TargetPlatform } from './UpdateAsset.entity';

@entity.name('binaryBuilds')
@entity.index(['channelId', 'platform', 'id'], { name: 'binaryBuilds_channel_platform_idx' })
export class BinaryBuildEntity extends BaseEntity {
    id!: UuidString & PrimaryKey;
    appId!: UuidString;
    channelId!: UuidString;
    platform!: TargetPlatform;
    binaryVersion!: string;
    fingerprint!: string;
    commitHash!: string;
    commitSubject!: string;
    commitAuthor!: string;
    ciJobId!: string;
    createdAt!: Date;
}
