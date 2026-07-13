import { entity, PrimaryKey } from '@zyno-io/ts-server-foundation';
import { BaseEntity, UuidString } from '@zyno-io/ts-server-foundation';

import { TargetPlatform } from './UpdateAsset.entity';

@entity.name('storeVersions')
export class StoreVersionEntity extends BaseEntity {
    id!: UuidString & PrimaryKey;
    appId!: UuidString;
    channelId!: UuidString;
    platform!: TargetPlatform;
    version!: string;
    firstDetectedAt!: Date;
}
