import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrapDone, onServerShutdown } from '@deepkit/framework';
import { ScopedLogger } from '@deepkit/logger';

import { AppEntity } from '../entities/App.entity';
import { BinaryBuildEntity } from '../entities/BinaryBuild.entity';
import { ChannelEntity } from '../entities/Channel.entity';
import { DeviceStateEntity } from '../entities/DeviceState.entity';
import { StoreVersionEntity } from '../entities/StoreVersion.entity';
import { UpdateEntity } from '../entities/Update.entity';
import { UpdateAssetEntity } from '../entities/UpdateAsset.entity';
import { UserEntity } from '../entities/User.entity';
import { VcsIntegrationEntity } from '../entities/VcsIntegration.entity';
import { S3Service } from '../services/S3.service';

const CLEANUP_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DRAFT_CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

export class DeletedDataCleanupJob {
    private startupTimer?: NodeJS.Timeout;
    private timer?: NodeJS.Timeout;

    constructor(
        private s3: S3Service,
        private logger: ScopedLogger
    ) {}

    @eventDispatcher.listen(onServerMainBootstrapDone)
    start() {
        const run = () => this.run().catch(err => this.logger.error('Deleted data cleanup failed', err));
        this.startupTimer = setTimeout(run, 30_000);
        this.timer = setInterval(run, CLEANUP_INTERVAL_MS);
    }

    @eventDispatcher.listen(onServerShutdown)
    stop() {
        if (this.startupTimer) clearTimeout(this.startupTimer);
        if (this.timer) clearInterval(this.timer);
    }

    async run(): Promise<void> {
        await this.cleanup();
    }

    private async cleanup(): Promise<void> {
        const cutoff = new Date(Date.now() - CLEANUP_AFTER_MS);
        await this.purgeStaleUnfinishedUpdates(cutoff);

        const deletedApps = await AppEntity.query()
            .filter({ deletedAt: { $lt: cutoff } })
            .find();
        const appIds = deletedApps.map(app => app.id);

        const deletedChannels = await ChannelEntity.query()
            .filter({ deletedAt: { $lt: cutoff } })
            .find();
        const appChannels = appIds.length
            ? await ChannelEntity.query()
                  .filter({ appId: { $in: appIds } })
                  .find()
            : [];
        const channelIds = [...new Set([...deletedChannels, ...appChannels].map(channel => channel.id))];

        await this.purgeAppAndChannelChildren(appIds, channelIds);

        if (channelIds.length) {
            await ChannelEntity.query()
                .filter({ id: { $in: channelIds } })
                .deleteMany();
        }
        if (appIds.length) {
            await AppEntity.query()
                .filter({ id: { $in: appIds } })
                .deleteMany();
        }

        const deletedIntegrations = await VcsIntegrationEntity.query()
            .filter({ deletedAt: { $lt: cutoff } })
            .find();
        for (const integration of deletedIntegrations) {
            const appCount = await AppEntity.query().filter({ vcsId: integration.id }).count();
            if (appCount > 0) continue;

            await UserEntity.query().filter({ vcsId: integration.id }).deleteMany();
            await VcsIntegrationEntity.query().filter({ id: integration.id }).deleteMany();
        }
    }

    private async purgeStaleUnfinishedUpdates(canceledCutoff: Date): Promise<void> {
        const draftCutoff = new Date(Date.now() - DRAFT_CLEANUP_AFTER_MS);

        const staleDrafts = await UpdateEntity.query()
            .filter({ status: 'draft', createdAt: { $lt: draftCutoff } })
            .find();
        const staleCanceled = await UpdateEntity.query()
            .filter({ status: 'canceled', createdAt: { $lt: canceledCutoff } })
            .find();

        const ids = [...new Set([...staleDrafts, ...staleCanceled].map(update => update.id))];
        await this.purgeUpdates(ids);
    }

    private async purgeAppAndChannelChildren(appIds: string[], channelIds: string[]): Promise<void> {
        const updateIds = new Set<string>();
        if (appIds.length) {
            const updates = await UpdateEntity.query()
                .filter({ appId: { $in: appIds } })
                .find();
            for (const update of updates) updateIds.add(update.id);

            await BinaryBuildEntity.query()
                .filter({ appId: { $in: appIds } })
                .deleteMany();
            await DeviceStateEntity.query()
                .filter({ appId: { $in: appIds } })
                .deleteMany();
            await StoreVersionEntity.query()
                .filter({ appId: { $in: appIds } })
                .deleteMany();
        }
        if (channelIds.length) {
            const updates = await UpdateEntity.query()
                .filter({ channelId: { $in: channelIds } })
                .find();
            for (const update of updates) updateIds.add(update.id);

            await BinaryBuildEntity.query()
                .filter({ channelId: { $in: channelIds } })
                .deleteMany();
            await DeviceStateEntity.query()
                .filter({ channelId: { $in: channelIds } })
                .deleteMany();
            await StoreVersionEntity.query()
                .filter({ channelId: { $in: channelIds } })
                .deleteMany();
        }

        const ids = [...updateIds];
        if (!ids.length) return;

        await this.purgeUpdates(ids);
    }

    private async purgeUpdates(ids: string[]): Promise<void> {
        if (!ids.length) return;
        const assets = await UpdateAssetEntity.query()
            .filter({ updateId: { $in: ids } })
            .find();
        const s3Keys = [...new Set(assets.map(asset => asset.s3Key))];

        await UpdateAssetEntity.query()
            .filter({ updateId: { $in: ids } })
            .deleteMany();
        await UpdateEntity.query()
            .filter({ id: { $in: ids } })
            .deleteMany();

        for (const s3Key of s3Keys) {
            const remainingReferences = await UpdateAssetEntity.query().filter({ s3Key }).count();
            if (remainingReferences > 0) continue;

            try {
                await this.s3.deleteFile(s3Key);
            } catch (err) {
                this.logger.warn(`Failed to delete S3 object ${s3Key}: ${err}`);
            }
        }
    }
}
