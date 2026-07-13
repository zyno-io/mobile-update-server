import { entity, PrimaryKey } from '@zyno-io/ts-server-foundation';
import { BaseEntity, UuidString } from '@zyno-io/ts-server-foundation';

import { TargetPlatform } from './UpdateAsset.entity';

@entity.name('storeVersions')
@entity.index(['channelId', 'platform', 'storeIdentifier', 'firstDetectedAt', 'id'], { name: 'storeVersions_latest_idx' })
export class StoreVersionEntity extends BaseEntity {
    id!: UuidString & PrimaryKey;
    appId!: UuidString;
    channelId!: UuidString;
    platform!: TargetPlatform;
    storeIdentifier: string | null = null;
    version!: string;
    firstDetectedAt!: Date;
    nativeUpdateRequiredAt: Date | null = null;
}
