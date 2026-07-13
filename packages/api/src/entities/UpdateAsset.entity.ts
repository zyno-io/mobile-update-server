import { entity, PrimaryKey } from '@zyno-io/ts-server-foundation';
import { BaseEntity, UuidString } from '@zyno-io/ts-server-foundation';

export type TargetPlatform = 'ios' | 'android';
export type AssetPlatform = 'ios' | 'android' | 'all';

@entity.name('updateAssets')
@entity.index(['updateId', 'key', 'platform'], { unique: true, name: 'updateAssets_dedup_uidx' })
export class UpdateAssetEntity extends BaseEntity {
    id!: UuidString & PrimaryKey;
    appId!: UuidString;
    updateId!: UuidString;
    key!: string;
    contentType!: string;
    fileExtension!: string;
    sha256!: string;
    md5!: string;
    size!: number;
    isLaunchAsset!: boolean;
    platform!: AssetPlatform;
    s3Key!: string;
}
