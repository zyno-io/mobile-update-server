import { http, HttpNotFoundError, HttpQueries, HttpResponse } from '@deepkit/http';

import { AssetPlatform, UpdateAssetEntity } from '../entities/UpdateAsset.entity';
import { S3Service } from '../services/S3.service';

@http.controller('/api/assets')
export class AssetsController {
    constructor(private s3: S3Service) {}

    @http.GET(':id')
    async serveById(id: string, response: HttpResponse): Promise<void> {
        const asset = await UpdateAssetEntity.query().filter({ id }).findOneOrUndefined();
        if (!asset) throw new HttpNotFoundError();

        await this.redirectToSignedUrl(asset, response);
    }

    @http.GET(':appId/:updateId/:key')
    async serve(appId: string, updateId: string, key: string, query: HttpQueries<{ platform?: string }>, response: HttpResponse): Promise<void> {
        const decodedKey = decodeURIComponent(key);

        let platforms: AssetPlatform[];
        if (query.platform === 'ios' || query.platform === 'android') {
            platforms = [query.platform, 'all'];
        } else if (query.platform === 'all') {
            platforms = ['all'];
        } else {
            platforms = ['all', 'ios', 'android'];
        }

        const asset = await UpdateAssetEntity.query()
            .filter({ appId, updateId, key: decodedKey, platform: { $in: platforms } })
            .findOneOrUndefined();

        if (!asset) throw new HttpNotFoundError();

        await this.redirectToSignedUrl(asset, response);
    }

    private async redirectToSignedUrl(asset: UpdateAssetEntity, response: HttpResponse): Promise<void> {
        const signedUrl = await this.s3.getSignedUrl(asset.s3Key, 300);

        response.writeHead(302, {
            Location: signedUrl,
            'Cache-Control': 'private, max-age=0'
        });
        response.end();
    }
}
