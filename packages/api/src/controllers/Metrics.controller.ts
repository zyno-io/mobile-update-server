import { http, HttpNotFoundError, HttpQueries } from '@zyno-io/ts-server-foundation';
import { keyBy } from 'lodash';

import { UserAuthMiddleware } from '../accessories/AuthMiddleware.accessory';
import { ApiController } from '../accessories/Controller.accessory';
import { GitLabProjectAuthService } from '../accessories/GitLabProjectAuth.accessory';
import { AppEntity } from '../entities/App.entity';
import { ChannelEntity } from '../entities/Channel.entity';
import { DeviceStateEntity } from '../entities/DeviceState.entity';
import { UpdateEntity } from '../entities/Update.entity';
import { UserEntity } from '../entities/User.entity';

interface IMetricsResponse {
    totalDevices: number;
    checkedInWithinSeconds: number;
    checkedInWithinCount: number;
    checkedInWithinPct: number;
    versionDistribution: { updateId: string | null; count: number; pct: number; updateLabel: string | null; isReleased: boolean }[];
    platformDistribution: { platform: string; count: number; pct: number }[];
    runtimeDistribution: { runtimeVersion: string; count: number; pct: number }[];
}

@ApiController('/api/apps/:appId/metrics')
@http.middleware(UserAuthMiddleware)
export class MetricsController {
    constructor(private projectAuth: GitLabProjectAuthService) {}

    @http.GET()
    async appMetrics(appId: string, query: HttpQueries<{ channelId?: string; windowSeconds?: number }>, user: UserEntity): Promise<IMetricsResponse> {
        const app = await AppEntity.query().filter({ id: appId, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();

        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const windowSeconds = Math.max(60, Math.min(query.windowSeconds ?? 86400, 60 * 60 * 24 * 30));
        const cutoff = new Date(Date.now() - windowSeconds * 1000);

        const filter = {
            appId,
            ...(query.channelId ? { channelId: query.channelId } : {})
        };

        const states = await DeviceStateEntity.query().filter(filter).find();

        const totalDevices = states.length;
        const checkedInWithinCount = states.filter(s => s.lastCheckInAt >= cutoff).length;

        const updateIds = [...new Set(states.map(s => s.currentUpdateId).filter((x): x is string => !!x))];
        const updates = updateIds.length
            ? await UpdateEntity.query()
                  .filter({ id: { $in: updateIds } })
                  .find()
            : [];
        const updateMap = keyBy(updates, 'id');

        const versionCounts = new Map<string | null, number>();
        for (const s of states) {
            versionCounts.set(s.currentUpdateId, (versionCounts.get(s.currentUpdateId) ?? 0) + 1);
        }

        const platformCounts = new Map<string, number>();
        for (const s of states) platformCounts.set(s.platform, (platformCounts.get(s.platform) ?? 0) + 1);

        const runtimeCounts = new Map<string, number>();
        for (const s of states) runtimeCounts.set(s.runtimeVersion, (runtimeCounts.get(s.runtimeVersion) ?? 0) + 1);

        const pct = (n: number) => (totalDevices === 0 ? 0 : Math.round((n / totalDevices) * 1000) / 10);

        return {
            totalDevices,
            checkedInWithinSeconds: windowSeconds,
            checkedInWithinCount,
            checkedInWithinPct: pct(checkedInWithinCount),
            versionDistribution: [...versionCounts.entries()]
                .map(([updateId, count]) => {
                    const update = updateId ? updateMap[updateId] : undefined;
                    return {
                        updateId,
                        count,
                        pct: pct(count),
                        updateLabel: update ? `${update.runtimeVersion} @ ${update.commitHash.substring(0, 7)}` : null,
                        isReleased: update?.status === 'released'
                    };
                })
                .sort((a, b) => b.count - a.count),
            platformDistribution: [...platformCounts.entries()]
                .map(([platform, count]) => ({ platform, count, pct: pct(count) }))
                .sort((a, b) => b.count - a.count),
            runtimeDistribution: [...runtimeCounts.entries()]
                .map(([runtimeVersion, count]) => ({ runtimeVersion, count, pct: pct(count) }))
                .sort((a, b) => b.count - a.count)
        };
    }

    @http.GET('updates/:updateId')
    async updateMetrics(
        appId: string,
        updateId: string,
        user: UserEntity
    ): Promise<{ totalDevicesOnChannel: number; devicesOnUpdate: number; pct: number }> {
        const app = await AppEntity.query().filter({ id: appId, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();

        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const update = await UpdateEntity.query().filter({ id: updateId, appId }).findOneOrUndefined();
        if (!update) throw new HttpNotFoundError();

        const channel = await ChannelEntity.query().filter({ id: update.channelId, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        const totalDevicesOnChannel = await DeviceStateEntity.query().filter({ appId, channelId: channel.id }).count();
        const devicesOnUpdate = await DeviceStateEntity.query().filter({ appId, channelId: channel.id, currentUpdateId: updateId }).count();

        return {
            totalDevicesOnChannel,
            devicesOnUpdate,
            pct: totalDevicesOnChannel === 0 ? 0 : Math.round((devicesOnUpdate / totalDevicesOnChannel) * 1000) / 10
        };
    }
}
