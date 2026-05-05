import { entity, PrimaryKey } from '@deepkit/type';
import { BaseEntity, UuidString } from '@zyno-io/dk-server-foundation';

export type TargetPlatform = 'ios' | 'android';
export type AssetPlatform = TargetPlatform | 'all';

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
