import { http, HttpBadRequestError, HttpNotFoundError, HttpQueries } from '@deepkit/http';

import { UserAuthMiddleware } from '../accessories/AuthMiddleware.accessory';
import { ApiController } from '../accessories/Controller.accessory';
import { GitLabProjectAuthService } from '../accessories/GitLabProjectAuth.accessory';
import { AppEntity } from '../entities/App.entity';
import { ChannelEntity } from '../entities/Channel.entity';
import { StoreVersionEntity } from '../entities/StoreVersion.entity';
import { TargetPlatform } from '../entities/UpdateAsset.entity';
import { UserEntity } from '../entities/User.entity';

export type IStoreVersionResponse = Pick<StoreVersionEntity, 'platform' | 'version' | 'firstDetectedAt'>;

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

        const row = await StoreVersionEntity.query().filter({ channelId, platform }).orderBy('firstDetectedAt', 'desc').findOneOrUndefined();

        return {
            latest: row ? { platform: row.platform, version: row.version, firstDetectedAt: row.firstDetectedAt } : null
        };
    }
}

function parseTargetPlatform(platform: string | undefined): TargetPlatform {
    if (platform === 'ios' || platform === 'android') return platform;
    throw new HttpBadRequestError('platform must be ios or android');
}
