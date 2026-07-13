import { http, HttpBody, HttpNotFoundError, HttpQueries, HttpRequest, HttpUnauthorizedError } from '@zyno-io/ts-server-foundation';
import { ScopedLogger } from '@zyno-io/ts-server-foundation';
import { createPersistedEntity, uuid7 } from '@zyno-io/ts-server-foundation';

import { ICiJobData, UserAuthMiddleware, validateCiToken } from '../accessories/AuthMiddleware.accessory';
import { ApiController } from '../accessories/Controller.accessory';
import { GitLabProjectAuthService } from '../accessories/GitLabProjectAuth.accessory';
import { optionalTargetPlatform, parseTargetPlatform } from '../accessories/Platform.accessory';
import { AppEntity } from '../entities/App.entity';
import { BinaryBuildEntity } from '../entities/BinaryBuild.entity';
import { ChannelEntity } from '../entities/Channel.entity';
import { TargetPlatform } from '../entities/UpdateAsset.entity';
import { UserEntity } from '../entities/User.entity';

export type IBinaryBuildResponse = Pick<
    BinaryBuildEntity,
    | 'id'
    | 'appId'
    | 'channelId'
    | 'platform'
    | 'binaryVersion'
    | 'fingerprint'
    | 'commitHash'
    | 'commitSubject'
    | 'commitAuthor'
    | 'ciJobId'
    | 'createdAt'
>;

interface IBinaryBuildCreateInput {
    platform: TargetPlatform;
    binaryVersion: string;
    fingerprint: string;
}

@ApiController('/api/apps/:appId/channels/:channelId/binary-builds')
export class BinaryBuildsController {
    constructor(
        private logger: ScopedLogger,
        private projectAuth: GitLabProjectAuthService
    ) {}

    private async loadAppAndChannel(appId: string, channelId: string): Promise<{ app: AppEntity; channel: ChannelEntity }> {
        const app = await AppEntity.query().filter({ id: appId, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();

        const channel = await ChannelEntity.query().filter({ id: channelId, appId, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        return { app, channel };
    }

    @http.GET()
    @http.middleware(UserAuthMiddleware)
    async index(
        appId: string,
        channelId: string,
        query: HttpQueries<{ platform?: TargetPlatform }>,
        user: UserEntity
    ): Promise<IBinaryBuildResponse[]> {
        const { app } = await this.loadAppAndChannel(appId, channelId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const platformFilter = optionalTargetPlatform(query.platform);
        const builds = await BinaryBuildEntity.query()
            .filter({ appId, channelId, ...(platformFilter ? { platform: platformFilter } : {}) })
            .orderBy('createdAt', 'desc')
            .orderBy('id', 'desc')
            .limit(50)
            .find();

        return builds.map(b => this.toResponse(b));
    }

    @http.GET('latest')
    @http.middleware(UserAuthMiddleware)
    async latest(
        appId: string,
        channelId: string,
        query: HttpQueries<{ platform?: TargetPlatform }>,
        user: UserEntity
    ): Promise<{ latest: IBinaryBuildResponse | null }> {
        const { app } = await this.loadAppAndChannel(appId, channelId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const platformFilter = optionalTargetPlatform(query.platform);
        const build = await BinaryBuildEntity.query()
            .filter({ appId, channelId, ...(platformFilter ? { platform: platformFilter } : {}) })
            .orderBy('createdAt', 'desc')
            .orderBy('id', 'desc')
            .findOneOrUndefined();

        return { latest: build ? this.toResponse(build) : null };
    }

    // Distinct binary versions for one platform, newest-built first. Unlike index() this is
    // uncapped, so old versions stay selectable in the UI's update filter even once the
    // channel has more than index()'s 50 most recent builds.
    @http.GET('versions')
    @http.middleware(UserAuthMiddleware)
    async versions(
        appId: string,
        channelId: string,
        query: HttpQueries<{ platform: TargetPlatform }>,
        user: UserEntity
    ): Promise<{ versions: string[] }> {
        const platform = parseTargetPlatform(query.platform);

        const { app } = await this.loadAppAndChannel(appId, channelId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const all = await BinaryBuildEntity.query()
            .filter({ appId, channelId, platform })
            .orderBy('createdAt', 'desc')
            .orderBy('id', 'desc')
            .findField('binaryVersion');

        // Set preserves insertion order, so the first entry is the newest build's version.
        return { versions: [...new Set(all)] };
    }

    @http.GET('latest-ci')
    async latestCi(
        request: HttpRequest,
        appId: string,
        channelId: string,
        query: HttpQueries<{ platform?: TargetPlatform }>
    ): Promise<{ latest: IBinaryBuildResponse | null }> {
        await this.validateCiJobForChannel(request, appId, channelId, 'Latest binary build lookup');

        const platformFilter = optionalTargetPlatform(query.platform);
        const build = await BinaryBuildEntity.query()
            .filter({ appId, channelId, ...(platformFilter ? { platform: platformFilter } : {}) })
            .orderBy('createdAt', 'desc')
            .orderBy('id', 'desc')
            .findOneOrUndefined();

        return { latest: build ? this.toResponse(build) : null };
    }

    @http.POST()
    async create(request: HttpRequest, appId: string, channelId: string, body: HttpBody<IBinaryBuildCreateInput>): Promise<IBinaryBuildResponse> {
        const platform = parseTargetPlatform(body.platform);
        const { app, channel, ciJobData } = await this.validateCiJobForChannel(request, appId, channelId, 'Binary build creation');

        const build = await createPersistedEntity(BinaryBuildEntity, {
            id: uuid7(),
            appId: app.id,
            channelId: channel.id,
            platform,
            binaryVersion: body.binaryVersion,
            fingerprint: body.fingerprint,
            commitHash: ciJobData.commitHash,
            commitSubject: ciJobData.commitSubject,
            commitAuthor: ciJobData.commitAuthor,
            ciJobId: ciJobData.jobId,
            createdAt: new Date()
        });

        return this.toResponse(build);
    }

    private toResponse(build: BinaryBuildEntity): IBinaryBuildResponse {
        return {
            id: build.id,
            appId: build.appId,
            channelId: build.channelId,
            platform: build.platform,
            binaryVersion: build.binaryVersion,
            fingerprint: build.fingerprint,
            commitHash: build.commitHash,
            commitSubject: build.commitSubject,
            commitAuthor: build.commitAuthor,
            ciJobId: build.ciJobId,
            createdAt: build.createdAt
        };
    }

    private async validateCiJobForChannel(
        request: HttpRequest,
        appId: string,
        channelId: string,
        logPrefix: string
    ): Promise<{ app: AppEntity; channel: ChannelEntity; ciJobData: ICiJobData }> {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            this.logger.warn(`${logPrefix} failed: missing or malformed Authorization header`);
            throw new HttpUnauthorizedError();
        }
        const ciToken = authHeader.slice(7);

        const { app, channel } = await this.loadAppAndChannel(appId, channelId);
        const ciJobData = await validateCiToken(ciToken, app.vcsId, this.logger);

        if (ciJobData.vcsProjectId !== app.vcsProjectId) {
            this.logger.warn(`${logPrefix} failed: vcsProjectId mismatch (expected=${app.vcsProjectId}, got=${ciJobData.vcsProjectId})`);
            throw new HttpUnauthorizedError();
        }
        if (ciJobData.branch !== channel.branchName) {
            this.logger.warn(`${logPrefix} failed: branch mismatch (channel=${channel.id} expected=${channel.branchName}, got=${ciJobData.branch})`);
            throw new HttpUnauthorizedError();
        }

        return { app, channel, ciJobData };
    }
}
