import { entity, PrimaryKey } from '@deepkit/type';
import { BaseEntity, UuidString } from '@zyno-io/dk-server-foundation';

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
