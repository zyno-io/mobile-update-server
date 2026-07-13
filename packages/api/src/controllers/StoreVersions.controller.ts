import { http, HttpNotFoundError, HttpQueries } from '@zyno-io/ts-server-foundation';

import { UserAuthMiddleware } from '../accessories/AuthMiddleware.accessory';
import { ApiController } from '../accessories/Controller.accessory';
import { GitLabProjectAuthService } from '../accessories/GitLabProjectAuth.accessory';
import { parseTargetPlatform } from '../accessories/Platform.accessory';
import { AppEntity } from '../entities/App.entity';
import { ChannelEntity } from '../entities/Channel.entity';
import { StoreVersionEntity } from '../entities/StoreVersion.entity';
import { TargetPlatform } from '../entities/UpdateAsset.entity';
import { UserEntity } from '../entities/User.entity';

export type IStoreVersionResponse = Pick<StoreVersionEntity, 'platform' | 'version' | 'firstDetectedAt' | 'nativeUpdateRequiredAt'>;

@ApiController('/api/apps/:appId/channels/:channelId/store-versions')
@http.middleware(UserAuthMiddleware)
export class StoreVersionsController {
    constructor(private projectAuth: GitLabProjectAuthService) {}

    @http.GET('latest')
    async latest(
        appId: string,
        channelId: string,
        query: HttpQueries<{ platform: TargetPlatform }>,
        user: UserEntity
    ): Promise<{ latest: IStoreVersionResponse | null }> {
        const platform = parseTargetPlatform(query.platform);

        const app = await AppEntity.query().filter({ id: appId, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();

        const channel = await ChannelEntity.query().filter({ id: channelId, appId, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const storeIdentifier = platform === 'ios' ? channel.iosBundleId : channel.androidPackageName;
        const trackingEnabled = platform === 'ios' ? channel.iosTrackingEnabled : channel.androidTrackingEnabled;
        if (!trackingEnabled || !storeIdentifier) return { latest: null };

        const row = await StoreVersionEntity.query()
            .filter({ channelId, platform, storeIdentifier })
            .sort({ firstDetectedAt: 'desc', id: 'desc' })
            .findOneOrUndefined();

        return {
            latest: row
                ? {
                      platform: row.platform,
                      version: row.version,
                      firstDetectedAt: row.firstDetectedAt,
                      nativeUpdateRequiredAt: row.nativeUpdateRequiredAt
                  }
                : null
        };
    }
}
