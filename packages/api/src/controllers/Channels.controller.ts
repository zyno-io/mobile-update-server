import { http, HttpBadRequestError, HttpBody, HttpNotFoundError } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';
import { uuid } from '@deepkit/type';
import { createEntity, createPersistedEntity, uuid7 } from '@zyno-io/dk-server-foundation';

import { UserAuthMiddleware } from '../accessories/AuthMiddleware.accessory';
import { ApiController } from '../accessories/Controller.accessory';
import { GitLabProjectAuthService } from '../accessories/GitLabProjectAuth.accessory';
import { AppEntity } from '../entities/App.entity';
import { ChannelEntity, IRolloutMember, RolloutMemberType } from '../entities/Channel.entity';
import { StoreVersionEntity } from '../entities/StoreVersion.entity';
import { TargetPlatform } from '../entities/UpdateAsset.entity';
import { UserEntity } from '../entities/User.entity';
import { IStoreVersionLookupResult, StoreLookupService } from '../services/StoreLookup.service';

export type IChannelResponse = Pick<
    ChannelEntity,
    | 'id'
    | 'appId'
    | 'name'
    | 'branchName'
    | 'iosBundleId'
    | 'androidPackageName'
    | 'iosTrackingEnabled'
    | 'androidTrackingEnabled'
    | 'iosNativeUpdateRequiredAt'
    | 'androidNativeUpdateRequiredAt'
    | 'iosStoreUrl'
    | 'androidStoreUrl'
    | 'stagingMembers'
    | 'canaryMembers'
>;

interface IChannelCreateInput {
    name: string;
    branchName?: string;
    iosBundleId?: string | null;
    androidPackageName?: string | null;
    iosTrackingEnabled?: boolean;
    androidTrackingEnabled?: boolean;
    iosNativeUpdateRequiredAt?: Date | string | null;
    androidNativeUpdateRequiredAt?: Date | string | null;
}

interface IChannelUpdateInput {
    name?: string;
    branchName?: string;
    iosBundleId?: string | null;
    androidPackageName?: string | null;
    iosTrackingEnabled?: boolean;
    androidTrackingEnabled?: boolean;
    iosNativeUpdateRequiredAt?: Date | string | null;
    androidNativeUpdateRequiredAt?: Date | string | null;
}

interface IRolloutMemberInput {
    type: RolloutMemberType;
    id: string;
    comment?: string;
}

interface IStagingMembersUpdateInput {
    stagingMembers: IRolloutMemberInput[];
}

interface ICanaryMembersUpdateInput {
    canaryMembers: IRolloutMemberInput[];
}

@ApiController('/api/apps/:appId/channels')
@http.middleware(UserAuthMiddleware)
export class ChannelsController {
    constructor(
        private projectAuth: GitLabProjectAuthService,
        private storeLookup: StoreLookupService,
        private logger: ScopedLogger
    ) {}

    private async loadApp(appId: string): Promise<AppEntity> {
        const app = await AppEntity.query().filter({ id: appId, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();
        return app;
    }

    private toResponse(channel: ChannelEntity): IChannelResponse {
        return {
            id: channel.id,
            appId: channel.appId,
            name: channel.name,
            branchName: channel.branchName,
            iosBundleId: channel.iosBundleId,
            androidPackageName: channel.androidPackageName,
            iosTrackingEnabled: channel.iosTrackingEnabled,
            androidTrackingEnabled: channel.androidTrackingEnabled,
            iosNativeUpdateRequiredAt: channel.iosNativeUpdateRequiredAt,
            androidNativeUpdateRequiredAt: channel.androidNativeUpdateRequiredAt,
            iosStoreUrl: channel.iosStoreUrl,
            androidStoreUrl: channel.androidStoreUrl,
            stagingMembers: channel.stagingMembers ?? [],
            canaryMembers: channel.canaryMembers
        };
    }

    @http.GET()
    async index(appId: string, user: UserEntity): Promise<IChannelResponse[]> {
        const app = await this.loadApp(appId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const channels = await ChannelEntity.query().filter({ appId, deletedAt: null }).orderBy('name').find();
        return channels.map(c => this.toResponse(c));
    }

    @http.GET('/:id')
    async show(appId: string, id: string, user: UserEntity): Promise<IChannelResponse> {
        const app = await this.loadApp(appId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const channel = await ChannelEntity.query().filter({ id, appId, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        return this.toResponse(channel);
    }

    @http.POST()
    async create(appId: string, body: HttpBody<IChannelCreateInput>, user: UserEntity): Promise<IChannelResponse> {
        const name = body.name.trim();
        if (!name) throw new HttpBadRequestError('Name is required');
        const branchName = (body.branchName ?? name).trim();
        if (!branchName) throw new HttpBadRequestError('Branch name is required');

        const app = await this.loadApp(appId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'manage');

        const existing = await ChannelEntity.query().filter({ appId, name, deletedAt: null }).findOneOrUndefined();
        if (existing) throw new HttpBadRequestError('Channel with this name already exists');

        const existingBranch = await ChannelEntity.query().filter({ appId, branchName, deletedAt: null }).findOneOrUndefined();
        if (existingBranch) throw new HttpBadRequestError('Channel with this branch already exists');

        const channel = createEntity(ChannelEntity, {
            id: uuid(),
            appId,
            name,
            branchName,
            iosBundleId: normalizeBundleId(body.iosBundleId),
            androidPackageName: normalizeBundleId(body.androidPackageName),
            iosTrackingEnabled: !!body.iosTrackingEnabled,
            androidTrackingEnabled: !!body.androidTrackingEnabled,
            iosNativeUpdateRequiredAt: parseDate(body.iosNativeUpdateRequiredAt),
            androidNativeUpdateRequiredAt: parseDate(body.androidNativeUpdateRequiredAt),
            iosStoreUrl: null,
            androidStoreUrl: null,
            stagingMembers: [],
            canaryMembers: [],
            createdAt: new Date(),
            deletedAt: null
        });
        await channel.save();

        await this.refreshStoreVersions(channel);

        return this.toResponse(channel);
    }

    @http.PUT('/:id')
    async update(appId: string, id: string, body: HttpBody<IChannelUpdateInput>, user: UserEntity): Promise<IChannelResponse> {
        const app = await this.loadApp(appId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'manage');

        const channel = await ChannelEntity.query().filter({ id, appId, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        if (body.name !== undefined) {
            const name = body.name.trim();
            if (!name) throw new HttpBadRequestError('Name cannot be empty');

            const existing = await ChannelEntity.query().filter({ appId, name, deletedAt: null }).findOneOrUndefined();
            if (existing && existing.id !== channel.id) throw new HttpBadRequestError('Channel with this name already exists');

            channel.name = name;
        }
        if (body.branchName !== undefined) {
            const branchName = body.branchName.trim();
            if (!branchName) throw new HttpBadRequestError('Branch name cannot be empty');

            const existingBranch = await ChannelEntity.query().filter({ appId, branchName, deletedAt: null }).findOneOrUndefined();
            if (existingBranch && existingBranch.id !== channel.id) {
                throw new HttpBadRequestError('Channel with this branch already exists');
            }

            channel.branchName = branchName;
        }
        if (body.iosBundleId !== undefined) {
            const next = normalizeBundleId(body.iosBundleId);
            if (next !== channel.iosBundleId) channel.iosStoreUrl = null;
            channel.iosBundleId = next;
        }
        if (body.androidPackageName !== undefined) {
            const next = normalizeBundleId(body.androidPackageName);
            if (next !== channel.androidPackageName) channel.androidStoreUrl = null;
            channel.androidPackageName = next;
        }
        if (body.iosTrackingEnabled !== undefined) {
            channel.iosTrackingEnabled = !!body.iosTrackingEnabled;
            if (!channel.iosTrackingEnabled) channel.iosStoreUrl = null;
        }
        if (body.androidTrackingEnabled !== undefined) {
            channel.androidTrackingEnabled = !!body.androidTrackingEnabled;
            if (!channel.androidTrackingEnabled) channel.androidStoreUrl = null;
        }
        if (body.iosNativeUpdateRequiredAt !== undefined) channel.iosNativeUpdateRequiredAt = parseDate(body.iosNativeUpdateRequiredAt);
        if (body.androidNativeUpdateRequiredAt !== undefined) channel.androidNativeUpdateRequiredAt = parseDate(body.androidNativeUpdateRequiredAt);
        await channel.save();

        await this.refreshStoreVersions(channel);

        return this.toResponse(channel);
    }

    @http.PUT('/:id/staging-members')
    async updateStagingMembers(appId: string, id: string, body: HttpBody<IStagingMembersUpdateInput>, user: UserEntity): Promise<IChannelResponse> {
        const app = await this.loadApp(appId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'operate');

        const channel = await ChannelEntity.query().filter({ id, appId, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        channel.stagingMembers = normalizeMembers(body.stagingMembers);
        await channel.save();

        return this.toResponse(channel);
    }

    @http.PUT('/:id/canary-members')
    async updateCanaryMembers(appId: string, id: string, body: HttpBody<ICanaryMembersUpdateInput>, user: UserEntity): Promise<IChannelResponse> {
        const app = await this.loadApp(appId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'operate');

        const channel = await ChannelEntity.query().filter({ id, appId, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        channel.canaryMembers = normalizeMembers(body.canaryMembers);
        await channel.save();

        return this.toResponse(channel);
    }

    @http.DELETE('/:id')
    async delete(appId: string, id: string, user: UserEntity): Promise<void> {
        const app = await this.loadApp(appId);
        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'manage');

        const channel = await ChannelEntity.query().filter({ id, appId, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        channel.deletedAt = new Date();
        await channel.save();
    }

    private async refreshStoreVersions(channel: ChannelEntity): Promise<void> {
        const tasks: Array<Promise<void>> = [];
        if (channel.iosTrackingEnabled && channel.iosBundleId) {
            tasks.push(this.recordStoreVersion(channel, 'ios', () => this.storeLookup.lookupApple(channel.iosBundleId!)));
        }
        if (channel.androidTrackingEnabled && channel.androidPackageName) {
            tasks.push(this.recordStoreVersion(channel, 'android', () => this.storeLookup.lookupGooglePlay(channel.androidPackageName!)));
        }
        await Promise.all(tasks);
    }

    private async recordStoreVersion(
        channel: ChannelEntity,
        platform: TargetPlatform,
        fetcher: () => Promise<IStoreVersionLookupResult | null>
    ): Promise<void> {
        let result: IStoreVersionLookupResult | null;
        try {
            result = await fetcher();
        } catch (err) {
            this.logger.warn(`Store lookup on save failed for channel=${channel.id} platform=${platform}: ${(err as Error).message}`);
            return;
        }
        if (!result) return;

        const field = platform === 'ios' ? 'iosStoreUrl' : 'androidStoreUrl';
        if (channel[field] !== result.storeUrl) {
            channel[field] = result.storeUrl;
            await channel.save();
        }

        const latest = await StoreVersionEntity.query()
            .filter({ channelId: channel.id, platform })
            .orderBy('firstDetectedAt', 'desc')
            .findOneOrUndefined();
        if (latest && latest.version === result.version) return;

        await createPersistedEntity(StoreVersionEntity, {
            id: uuid7(),
            appId: channel.appId,
            channelId: channel.id,
            platform,
            version: result.version,
            firstDetectedAt: new Date()
        });
    }
}

function normalizeMembers(input: IRolloutMemberInput[] | null | undefined): IRolloutMember[] {
    if (!Array.isArray(input)) {
        throw new HttpBadRequestError('members must be an array');
    }
    const seen = new Set<string>();
    const out: IRolloutMember[] = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object') {
            throw new HttpBadRequestError('each member must be an object');
        }
        if (raw.type !== 'device' && raw.type !== 'user') {
            throw new HttpBadRequestError('member type must be "device" or "user"');
        }
        const id = (raw.id ?? '').trim();
        if (!id) continue;
        const key = `${raw.type}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type: raw.type, id, comment: (raw.comment ?? '').trim() });
    }
    return out;
}

function normalizeBundleId(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function parseDate(value: Date | string | null | undefined): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) throw new HttpBadRequestError('Invalid date');
    return parsed;
}
