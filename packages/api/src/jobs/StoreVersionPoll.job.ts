import { eventDispatcher } from '@deepkit/event';
import { onServerMainBootstrapDone, onServerShutdown } from '@deepkit/framework';
import { ScopedLogger } from '@deepkit/logger';
import { createPersistedEntity, uuid7 } from '@zyno-io/dk-server-foundation';

import { AppConfig } from '../config';
import { ChannelEntity } from '../entities/Channel.entity';
import { StoreVersionEntity } from '../entities/StoreVersion.entity';
import { TargetPlatform } from '../entities/UpdateAsset.entity';
import { IStoreVersionLookupResult, StoreLookupService } from '../services/StoreLookup.service';

const STARTUP_DELAY_MS = 30_000;
const APPLE_REQUEST_INTERVAL_MS = 200;

export class StoreVersionPollJob {
    private startupTimer?: NodeJS.Timeout;
    private timer?: NodeJS.Timeout;

    constructor(
        private appConfig: AppConfig,
        private lookup: StoreLookupService,
        private logger: ScopedLogger
    ) {}

    @eventDispatcher.listen(onServerMainBootstrapDone)
    start() {
        const run = () => this.run().catch(err => this.logger.error('Store version poll failed', err));
        this.startupTimer = setTimeout(run, STARTUP_DELAY_MS);
        this.timer = setInterval(run, this.appConfig.STORE_VERSION_POLL_INTERVAL_MS);
    }

    @eventDispatcher.listen(onServerShutdown)
    stop() {
        if (this.startupTimer) clearTimeout(this.startupTimer);
        if (this.timer) clearInterval(this.timer);
    }

    async run(): Promise<void> {
        const channels = await ChannelEntity.query().filter({ deletedAt: null }).find();

        for (const channel of channels) {
            if (channel.iosTrackingEnabled && channel.iosBundleId) {
                await this.pollOne(channel, 'ios', () => this.lookup.lookupApple(channel.iosBundleId!));
                await sleep(APPLE_REQUEST_INTERVAL_MS);
            }
            if (channel.androidTrackingEnabled && channel.androidPackageName) {
                await this.pollOne(channel, 'android', () => this.lookup.lookupGooglePlay(channel.androidPackageName!));
            }
        }
    }

    private async pollOne(channel: ChannelEntity, platform: TargetPlatform, fetcher: () => Promise<IStoreVersionLookupResult | null>): Promise<void> {
        let result: IStoreVersionLookupResult | null;
        try {
            result = await fetcher();
        } catch (err) {
            this.logger.warn(`Store lookup failed for channel=${channel.id} platform=${platform}: ${(err as Error).message}`);
            return;
        }
        if (!result) return;

        await this.updateChannelStoreUrl(channel, platform, result.storeUrl);

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
        this.logger.info(`Detected new ${platform} version ${result.version} for channel ${channel.id}`);
    }

    private async updateChannelStoreUrl(channel: ChannelEntity, platform: TargetPlatform, storeUrl: string | null): Promise<void> {
        const field = platform === 'ios' ? 'iosStoreUrl' : 'androidStoreUrl';
        if (channel[field] === storeUrl) return;
        channel[field] = storeUrl;
        await channel.save();
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
