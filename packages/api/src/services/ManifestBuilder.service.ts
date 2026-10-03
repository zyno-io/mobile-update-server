import { AppConfig } from '../config';
import { UpdateEntity } from '../entities/Update.entity';
import { UpdateAssetEntity } from '../entities/UpdateAsset.entity';

export interface IManifestAsset {
    hash: string;
    key: string;
    contentType: string;
    fileExtension: string;
    url: string;
}

export interface IManifestBody {
    id: string;
    createdAt: string;
    runtimeVersion: string;
    launchAsset: IManifestAsset;
    assets: IManifestAsset[];
    metadata: Record<string, unknown>;
    extra: Record<string, unknown>;
}

export interface INoUpdateAvailableDirective {
    type: 'noUpdateAvailable';
}

export interface IRollBackToEmbeddedDirective {
    type: 'rollBackToEmbedded';
    parameters: { commitTime: string };
}

export class ManifestBuilderService {
    constructor(private appConfig: AppConfig) {}

    buildManifest(update: UpdateEntity, assets: UpdateAssetEntity[], platform: 'ios' | 'android'): IManifestBody {
        if (update.platform !== platform) {
            throw new Error(`Update ${update.id} is for ${update.platform}, not ${platform}`);
        }

        const platformAssets = assets.filter(a => a.platform === platform || a.platform === 'all');

        const launchAsset = platformAssets.find(a => a.isLaunchAsset);
        if (!launchAsset) {
            throw new Error(`No launch asset for update ${update.id} platform ${platform}`);
        }

        const nonLaunchAssets = platformAssets.filter(a => !a.isLaunchAsset);

        return {
            id: this.formatUuidForManifest(update.id),
            createdAt: update.createdAt.toISOString(),
            runtimeVersion: update.runtimeVersion,
            launchAsset: this.toManifestAsset(launchAsset),
            assets: nonLaunchAssets.map(a => this.toManifestAsset(a)),
            metadata: {},
            extra: (update.expoConfigJson ? { expoClient: update.expoConfigJson } : {}) as Record<string, unknown>
        };
    }

    buildNoUpdateAvailableDirective(): INoUpdateAvailableDirective {
        return { type: 'noUpdateAvailable' };
    }

    buildRollBackToEmbeddedDirective(commitTime: Date): IRollBackToEmbeddedDirective {
        return { type: 'rollBackToEmbedded', parameters: { commitTime: commitTime.toISOString() } };
    }

    private toManifestAsset(asset: UpdateAssetEntity): IManifestAsset {
        return {
            hash: asset.sha256,
            key: this.assetCacheKey(asset),
            contentType: asset.contentType,
            fileExtension: asset.fileExtension ? `.${asset.fileExtension.replace(/^\./, '')}` : '',
            url: `${this.appConfig.PUBLIC_BASE_URL}/api/assets/${asset.id}`
        };
    }

    /**
     * Expo's metadata.json identifies an asset by an MD5 hash of its contents (the
     * "key" in their terminology). Reusing our stored md5 here keeps clients that
     * cache by key happy.
     */
    private assetCacheKey(asset: UpdateAssetEntity): string {
        return Buffer.from(asset.md5, 'base64').toString('hex');
    }

    private formatUuidForManifest(id: string): string {
        // Expo expects manifest IDs in canonical UUID format (8-4-4-4-12). Our stored
        // ids already are, but we lower-case to match the protocol convention.
        return id.toLowerCase();
    }
}
