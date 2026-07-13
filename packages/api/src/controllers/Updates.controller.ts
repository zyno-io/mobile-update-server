import {
    http,
    HttpBadRequestError,
    HttpBody,
    HttpNotFoundError,
    HttpQueries,
    HttpRequest,
    HttpUnauthorizedError,
    FileUpload
} from '@zyno-io/ts-server-foundation';
import { ScopedLogger } from '@zyno-io/ts-server-foundation';
import { DatabaseSession } from '@zyno-io/ts-server-foundation';
import { createPersistedEntity, MutexKey, OkResponse, persistEntity, uuid7 } from '@zyno-io/ts-server-foundation';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

import { hashCiToken, ICiJobData, UpdateCiTokenMiddleware, UserAuthMiddleware, validateCiToken } from '../accessories/AuthMiddleware.accessory';
import { ApiController } from '../accessories/Controller.accessory';
import { GitLabProjectAuthService } from '../accessories/GitLabProjectAuth.accessory';
import { optionalTargetPlatform, parseTargetPlatform } from '../accessories/Platform.accessory';
import { AppConfig } from '../config';
import { Db } from '../database';
import { AppEntity } from '../entities/App.entity';
import { BinaryBuildEntity } from '../entities/BinaryBuild.entity';
import { ChannelEntity } from '../entities/Channel.entity';
import { UpdateEntity, UpdateStatus } from '../entities/Update.entity';
import { AssetPlatform, TargetPlatform, UpdateAssetEntity } from '../entities/UpdateAsset.entity';
import { UserEntity } from '../entities/User.entity';
import { isDuplicateKeyError } from '../helpers/dbErrors';
import { S3Service } from '../services/S3.service';

export type IUpdateResponse = Pick<
    UpdateEntity,
    | 'id'
    | 'appId'
    | 'channelId'
    | 'platform'
    | 'runtimeVersion'
    | 'otaVersion'
    | 'status'
    | 'commitHash'
    | 'commitSubject'
    | 'commitAuthor'
    | 'ciJobId'
    | 'createdAt'
    | 'releasedAt'
    | 'supersededAt'
    | 'supersededById'
>;

export type IUpdateAssetResponse = Pick<
    UpdateAssetEntity,
    'id' | 'key' | 'contentType' | 'fileExtension' | 'sha256' | 'md5' | 'size' | 'isLaunchAsset' | 'platform'
>;

interface IUpdateCreateInput {
    runtimeVersion: string;
    otaVersion?: string | null;
    platform: TargetPlatform;
    // Arbitrary Expo JSON. Deepkit treats Record<string, unknown> as an object
    // with no declared properties and strips nested config keys during request
    // body deserialization.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expoConfig: { [key: string]: any };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: { [key: string]: any };
}

interface IUpdateAssetUploadInput {
    file: FileUpload;
    key: string;
    platform: AssetPlatform;
    isLaunchAsset: boolean;
    fileExtension?: string;
    contentType?: string;
}

interface IPromoteInput {
    // Tier to advance to. Omitted = advance one tier (staging→canary or canary→released).
    // Pass "released" from staging to skip the canary tier entirely.
    target?: 'canary' | 'released';
}

@ApiController('/api/apps/:appId/channels/:channelId/updates')
export class UpdatesController {
    constructor(
        private db: Db,
        private logger: ScopedLogger,
        private s3: S3Service,
        private projectAuth: GitLabProjectAuthService,
        private appConfig: AppConfig
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
        query: HttpQueries<{ platform?: TargetPlatform; binaryVersion?: string }>,
        user: UserEntity
    ): Promise<IUpdateResponse[]> {
        const platform = optionalTargetPlatform(query.platform);
        const { binaryVersion } = query;

        // A binary version only identifies a build together with its platform: ios 1.4.2 and
        // android 1.4.2 are unrelated rows.
        if (binaryVersion && !platform) {
            throw new HttpBadRequestError('platform is required when filtering by binaryVersion');
        }

        const { app } = await this.loadAppAndChannel(appId, channelId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        let runtimeVersionFilter: { $in: string[] } | undefined;
        if (binaryVersion && platform) {
            // Updates carry a runtimeVersion, not a binary version. The two are linked only by
            // BinaryBuild.fingerprint === Update.runtimeVersion, and one binary version can have
            // several fingerprints (e.g. a rebuild with different native deps), so match the set.
            const fingerprints = await BinaryBuildEntity.query().filter({ appId, channelId, platform, binaryVersion }).findField('fingerprint');

            // An empty $in would render `IN ()`, which is a syntax error.
            if (!fingerprints.length) return [];

            runtimeVersionFilter = { $in: [...new Set(fingerprints)] };
        }

        const updates = await UpdateEntity.query()
            .filter({
                appId,
                channelId,
                status: { $nin: ['draft'] },
                ...(platform ? { platform } : {}),
                ...(runtimeVersionFilter ? { runtimeVersion: runtimeVersionFilter } : {})
            })
            .orderBy('createdAt', 'desc')
            .orderBy('id', 'desc')
            .find();

        return updates.map(u => this.toResponse(u));
    }

    @http.GET(':id')
    @http.middleware(UserAuthMiddleware)
    async show(appId: string, channelId: string, id: string, user: UserEntity): Promise<IUpdateResponse & { assets: IUpdateAssetResponse[] }> {
        const { app } = await this.loadAppAndChannel(appId, channelId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const update = await UpdateEntity.query().filter({ id, appId, channelId }).findOneOrUndefined();
        if (!update) throw new HttpNotFoundError();

        const assets = await UpdateAssetEntity.query().filter({ updateId: id }).find();

        return {
            ...this.toResponse(update),
            assets: assets.map(a => ({
                id: a.id,
                key: a.key,
                contentType: a.contentType,
                fileExtension: a.fileExtension,
                sha256: a.sha256,
                md5: a.md5,
                size: a.size,
                isLaunchAsset: a.isLaunchAsset,
                platform: a.platform
            }))
        };
    }

    @http.POST()
    async create(request: HttpRequest, appId: string, channelId: string, body: HttpBody<IUpdateCreateInput>): Promise<IUpdateResponse> {
        const platform = parseTargetPlatform(body.platform);
        const { app, channel, ciToken, ciJobData } = await this.validateCiJobForChannel(request, appId, channelId, 'Update creation');

        const ciTokenHash = hashCiToken(ciToken);

        const update = await createPersistedEntity(UpdateEntity, {
            id: uuid7(),
            appId: app.id,
            channelId: channel.id,
            platform,
            runtimeVersion: body.runtimeVersion,
            otaVersion: body.otaVersion?.trim() || null,
            status: 'draft',
            commitHash: ciJobData.commitHash,
            commitSubject: ciJobData.commitSubject,
            commitAuthor: ciJobData.commitAuthor,
            ciJobId: ciJobData.jobId,
            ciTokenHash,
            expoConfigJson: body.expoConfig ?? null,
            metadataJson: body.metadata ?? null,
            createdAt: new Date(),
            releasedAt: null,
            promotedById: null,
            supersededAt: null,
            supersededById: null
        });

        return this.toResponse(update);
    }

    @http.POST('promote-ci')
    async promoteCurrentCiCommit(request: HttpRequest, appId: string, channelId: string, body: HttpBody<IPromoteInput>): Promise<IUpdateResponse[]> {
        const { channel, ciJobData } = await this.validateCiJobForChannel(request, appId, channelId, 'CI update promotion');

        if (!ciJobData.commitHash) {
            throw new HttpBadRequestError('CI job has no commit hash');
        }

        // Only select updates whose current tier can legally advance to the requested
        // target — otherwise a bulk run with target=canary would partially mutate the
        // staging rows before throwing on the first already-canary row.
        const eligibleStatuses: UpdateStatus[] = body?.target === 'canary' ? ['staging'] : ['staging', 'canary'];

        const updates = await UpdateEntity.query()
            .filter({
                appId,
                channelId,
                commitHash: ciJobData.commitHash,
                status: { $in: eligibleStatuses }
            })
            .orderBy('createdAt', 'desc')
            .orderBy('id', 'desc')
            .find();

        if (!updates.length) throw new HttpNotFoundError();

        for (const update of updates) {
            await this.advanceTier(update, null, body?.target, channel);
        }

        return updates.map(update => this.toResponse(update));
    }

    @http.POST(':id/assets')
    @http.middleware(UpdateCiTokenMiddleware)
    async uploadAsset(appId: string, channelId: string, id: string, body: HttpBody<IUpdateAssetUploadInput>): Promise<IUpdateAssetResponse> {
        const update = await UpdateEntity.query().filter({ id, appId, channelId }).findOneOrUndefined();
        if (!update) throw new HttpNotFoundError();
        if (update.status !== 'draft') throw new HttpBadRequestError('update is not in draft state');
        if (body.platform !== update.platform && body.platform !== 'all') {
            throw new HttpBadRequestError(`asset platform must be ${update.platform} or all for this update`);
        }
        if (body.isLaunchAsset && body.platform !== update.platform) {
            throw new HttpBadRequestError(`launch asset platform must be ${update.platform}`);
        }
        if (body.file.size > this.appConfig.MAX_ASSET_SIZE_BYTES) {
            throw new HttpBadRequestError(`asset exceeds max size of ${this.formatBytes(this.appConfig.MAX_ASSET_SIZE_BYTES)}`);
        }

        // Cheap dup check before reading + uploading the file; the unique index is what
        // makes it race-safe (see catch below), but bailing here saves bandwidth.
        const existing = await UpdateAssetEntity.query().filter({ updateId: id, key: body.key, platform: body.platform }).findOneOrUndefined();
        if (existing) {
            throw new HttpBadRequestError(`asset with key=${body.key} platform=${body.platform} already uploaded`);
        }

        const buffer = await readFile(body.file.path);
        if (buffer.length > this.appConfig.MAX_ASSET_SIZE_BYTES) {
            throw new HttpBadRequestError(`asset exceeds max size of ${this.formatBytes(this.appConfig.MAX_ASSET_SIZE_BYTES)}`);
        }
        const sha256 = createHash('sha256').update(buffer).digest('base64url');
        const md5 = createHash('md5').update(buffer).digest('base64');

        const fileExtension = (body.fileExtension ?? body.file.name?.split('.').pop() ?? '').toLowerCase();
        const contentType = body.contentType ?? body.file.type ?? 'application/octet-stream';
        const s3Key = this.s3.pathForAsset(appId, sha256, fileExtension);

        if (!(await this.s3.exists(s3Key))) {
            await this.s3.uploadBuffer(buffer, s3Key, contentType);
        }

        let asset: UpdateAssetEntity;
        try {
            asset = await createPersistedEntity(UpdateAssetEntity, {
                id: uuid7(),
                appId,
                updateId: id,
                key: body.key,
                contentType,
                fileExtension,
                sha256,
                md5,
                size: buffer.length,
                isLaunchAsset: body.isLaunchAsset,
                platform: body.platform,
                s3Key
            });
        } catch (err) {
            // Two concurrent uploads with the same (updateId, key, platform) can pass the
            // pre-check above; the unique index on updateAssets is what makes that race safe.
            if (isDuplicateKeyError(err)) {
                throw new HttpBadRequestError(`asset with key=${body.key} platform=${body.platform} already uploaded`);
            }
            throw err;
        }

        return {
            id: asset.id,
            key: asset.key,
            contentType: asset.contentType,
            fileExtension: asset.fileExtension,
            sha256: asset.sha256,
            md5: asset.md5,
            size: asset.size,
            isLaunchAsset: asset.isLaunchAsset,
            platform: asset.platform
        };
    }

    @http.POST(':id/finalize')
    @http.middleware(UpdateCiTokenMiddleware)
    async finalize(appId: string, channelId: string, id: string): Promise<IUpdateResponse> {
        const update = await UpdateEntity.query().filter({ id, appId, channelId }).findOneOrUndefined();
        if (!update) throw new HttpNotFoundError();
        if (update.status !== 'draft') throw new HttpBadRequestError('update is not in draft state');

        const channel = await ChannelEntity.query().filter({ id: channelId, appId, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        const assetCount = await UpdateAssetEntity.query().filter({ updateId: id }).count();
        if (assetCount === 0) throw new HttpBadRequestError('update has no assets');

        const launchAssetCount = await UpdateAssetEntity.query().filter({ updateId: id, isLaunchAsset: true, platform: update.platform }).count();
        if (launchAssetCount === 0) throw new HttpBadRequestError('update has no launch asset');

        const initialTier = this.initialTierForFinalize(channel);

        await this.db.transaction(async session => {
            // Serialize tier transitions within this (channel, platform, runtimeVersion) so
            // two concurrent finalizes can't both leave their rows live in the same tier —
            // the second one runs under the lock, sees the first as live, and supersedes it.
            await session.acquireSessionLock(this.tierLockKey(update));

            const fresh = await session.query(UpdateEntity).filter({ id }).findOneOrUndefined();
            if (!fresh) throw new HttpNotFoundError();
            if (fresh.status !== 'draft') throw new HttpBadRequestError('update is not in draft state');

            fresh.status = initialTier;
            if (initialTier === 'released') fresh.releasedAt = new Date();
            fresh.ciTokenHash = null;
            await persistEntity(fresh, session);

            await this.supersedePriorInTier(fresh, initialTier, session);

            // Mirror back so callers using `update` see fresh state.
            update.status = fresh.status;
            update.releasedAt = fresh.releasedAt;
            update.ciTokenHash = fresh.ciTokenHash;
        });

        return this.toResponse(update);
    }

    @http.POST(':id/cancel-draft')
    @http.middleware(UpdateCiTokenMiddleware)
    async cancelDraft(appId: string, channelId: string, id: string): Promise<OkResponse> {
        const update = await UpdateEntity.query().filter({ id, appId, channelId }).findOneOrUndefined();
        if (!update) throw new HttpNotFoundError();
        if (update.status !== 'draft') throw new HttpBadRequestError('update is not in draft state');

        update.status = 'canceled';
        update.ciTokenHash = null;
        await update.save();

        return { ok: true };
    }

    @http.POST(':id/promote')
    @http.middleware(UserAuthMiddleware)
    async promote(appId: string, channelId: string, id: string, user: UserEntity, body: HttpBody<IPromoteInput>): Promise<IUpdateResponse> {
        const { app, channel } = await this.loadAppAndChannel(appId, channelId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'operate');

        const update = await UpdateEntity.query().filter({ id, appId, channelId }).findOneOrUndefined();
        if (!update) throw new HttpNotFoundError();

        await this.advanceTier(update, user.id, body?.target, channel);

        return this.toResponse(update);
    }

    @http.POST(':id/promote-ci')
    async promoteCi(request: HttpRequest, appId: string, channelId: string, id: string, body: HttpBody<IPromoteInput>): Promise<IUpdateResponse> {
        const { channel } = await this.validateCiJobForChannel(request, appId, channelId, 'CI update promotion');

        const update = await UpdateEntity.query().filter({ id, appId, channelId }).findOneOrUndefined();
        if (!update) throw new HttpNotFoundError();

        await this.advanceTier(update, null, body?.target, channel);

        return this.toResponse(update);
    }

    @http.POST(':id/cancel')
    @http.middleware(UserAuthMiddleware)
    async cancel(appId: string, channelId: string, id: string, user: UserEntity): Promise<OkResponse> {
        const { app } = await this.loadAppAndChannel(appId, channelId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'operate');

        const update = await UpdateEntity.query().filter({ id, appId, channelId }).findOneOrUndefined();
        if (!update) throw new HttpNotFoundError();
        if (update.status === 'released') throw new HttpBadRequestError('cannot cancel a released update');
        if (update.supersededAt !== null) {
            throw new HttpBadRequestError('update has been superseded; no cancel is needed');
        }

        update.status = 'canceled';
        update.ciTokenHash = null;
        await update.save();

        return { ok: true };
    }

    private toResponse(update: UpdateEntity): IUpdateResponse {
        return {
            id: update.id,
            appId: update.appId,
            channelId: update.channelId,
            platform: update.platform,
            runtimeVersion: update.runtimeVersion,
            otaVersion: update.otaVersion,
            status: update.status,
            commitHash: update.commitHash,
            commitSubject: update.commitSubject,
            commitAuthor: update.commitAuthor,
            ciJobId: update.ciJobId,
            createdAt: update.createdAt,
            releasedAt: update.releasedAt,
            supersededAt: update.supersededAt,
            supersededById: update.supersededById
        };
    }

    private async validateCiJobForChannel(
        request: HttpRequest,
        appId: string,
        channelId: string,
        logPrefix: string
    ): Promise<{
        app: AppEntity;
        channel: ChannelEntity;
        ciToken: string;
        ciJobData: ICiJobData;
    }> {
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

        return { app, channel, ciToken, ciJobData };
    }

    private async advanceTier(
        update: UpdateEntity,
        promotedById: string | null,
        target: 'canary' | 'released' | undefined,
        channel: ChannelEntity
    ): Promise<void> {
        await this.db.transaction(async session => {
            await session.acquireSessionLock(this.tierLockKey(update));

            // Re-fetch under lock so the status / superseded check reflects any concurrent
            // mutation that committed while we were waiting for the lock.
            const fresh = await session.query(UpdateEntity).filter({ id: update.id }).findOneOrUndefined();
            if (!fresh) throw new HttpNotFoundError();
            if (fresh.supersededAt !== null) {
                throw new HttpBadRequestError('update has been superseded by a newer one');
            }

            const next = this.nextTier(fresh.status, target, channel);

            fresh.status = next;
            fresh.promotedById = promotedById;
            if (next === 'released') fresh.releasedAt = new Date();
            await persistEntity(fresh, session);

            await this.supersedePriorInTier(fresh, next, session);

            update.status = fresh.status;
            update.promotedById = fresh.promotedById;
            update.releasedAt = fresh.releasedAt;
        });
    }

    private tierLockKey(u: Pick<UpdateEntity, 'channelId' | 'platform' | 'runtimeVersion'>): MutexKey[] {
        return ['mus', 'update-tier', u.channelId, u.platform, u.runtimeVersion];
    }

    /**
     * Mark every prior live entry at the same tier in the same (channel, platform,
     * runtimeVersion) scope as superseded by this one. Scope mirrors what the manifest
     * selects, so runtime-1.0 entries are not superseded when a runtime-2.0 entry lands.
     * Caller must already hold the tier lock — supersession is part of the same
     * transition as the row landing in `tier`.
     */
    private async supersedePriorInTier(current: UpdateEntity, tier: 'staging' | 'canary' | 'released', session: DatabaseSession): Promise<void> {
        const olderLive = await session
            .query(UpdateEntity)
            .filter({
                appId: current.appId,
                channelId: current.channelId,
                platform: current.platform,
                runtimeVersion: current.runtimeVersion,
                status: tier,
                supersededAt: null,
                id: { $ne: current.id }
            })
            .find();

        const at = current.releasedAt ?? new Date();
        for (const o of olderLive) {
            o.supersededAt = at;
            o.supersededById = current.id;
            await persistEntity(o, session);
        }
    }

    @http.POST(':id/rollback')
    @http.middleware(UserAuthMiddleware)
    async rollback(appId: string, channelId: string, id: string, user: UserEntity): Promise<IUpdateResponse> {
        const { app } = await this.loadAppAndChannel(appId, channelId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'operate');

        const update = await UpdateEntity.query().filter({ id, appId, channelId }).findOneOrUndefined();
        if (!update) throw new HttpNotFoundError();

        await this.db.transaction(async session => {
            await session.acquireSessionLock(this.tierLockKey(update));

            const fresh = await session.query(UpdateEntity).filter({ id }).findOneOrUndefined();
            if (!fresh) throw new HttpNotFoundError();
            if (fresh.status !== 'released') throw new HttpBadRequestError('only released updates can be rolled back');
            if (fresh.supersededAt !== null) {
                throw new HttpBadRequestError('this release has already been superseded; rollback is only valid on the live release');
            }

            fresh.status = 'rolled-back';
            fresh.supersededAt = new Date();
            fresh.supersededById = null;
            await persistEntity(fresh, session);

            // Auto-revert: bring back the most-recently-superseded release in the same scope.
            // Its supersededById may point at this just-rolled-back update or at a chain of
            // earlier ones — either way, the freshest by createdAt wins.
            const candidate = await session
                .query(UpdateEntity)
                .filter({
                    appId,
                    channelId,
                    platform: fresh.platform,
                    runtimeVersion: fresh.runtimeVersion,
                    status: 'released',
                    supersededAt: { $ne: null }
                })
                .orderBy('createdAt', 'desc')
                .orderBy('id', 'desc')
                .findOneOrUndefined();

            if (candidate) {
                candidate.supersededAt = null;
                candidate.supersededById = null;
                await persistEntity(candidate, session);
            }

            update.status = fresh.status;
            update.supersededAt = fresh.supersededAt;
            update.supersededById = fresh.supersededById;
        });

        return this.toResponse(update);
    }

    private nextTier(current: UpdateStatus, target: 'canary' | 'released' | undefined, channel: ChannelEntity): 'canary' | 'released' {
        // Default: advance one tier, auto-skipping tiers whose cohort is empty.
        // Optional target ('released') lets a caller jump past all remaining tiers.
        if (current === 'staging') {
            if (target === 'released') return 'released';
            if (target === 'canary') return 'canary';
            // target undefined: advance to canary IF it has members, else released.
            return this.hasMembers(channel.canaryMembers) ? 'canary' : 'released';
        }
        if (current === 'canary') {
            if (target === undefined || target === 'released') return 'released';
            throw new HttpBadRequestError('canary updates can only be promoted to released');
        }
        throw new HttpBadRequestError(`cannot promote update in status "${current}"`);
    }

    private initialTierForFinalize(channel: ChannelEntity): 'staging' | 'canary' | 'released' {
        if (this.hasMembers(channel.stagingMembers)) return 'staging';
        if (this.hasMembers(channel.canaryMembers)) return 'canary';
        return 'released';
    }

    private hasMembers(members: { type: string; id: string }[] | null | undefined): boolean {
        return Array.isArray(members) && members.some(member => member.type === 'device');
    }

    private formatBytes(bytes: number): string {
        return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MiB`;
    }
}
