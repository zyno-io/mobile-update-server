import { eventDispatcher } from '@zyno-io/ts-server-foundation';
import { onServerMainBootstrapDone, onServerShutdown } from '@zyno-io/ts-server-foundation';
import { ScopedLogger } from '@zyno-io/ts-server-foundation';

import { AppConfig } from '../config';
import { ChannelEntity } from '../entities/Channel.entity';
import { TargetPlatform } from '../entities/UpdateAsset.entity';
import { IStoreVersionLookupResult, StoreLookupService } from '../services/StoreLookup.service';
import { recordDetectedStoreVersion } from '../services/StoreVersion.service';

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
                const storeIdentifier = channel.iosBundleId;
                await this.pollOne(channel, 'ios', storeIdentifier, () => this.lookup.lookupApple(storeIdentifier));
                await sleep(APPLE_REQUEST_INTERVAL_MS);
            }
            if (channel.androidTrackingEnabled && channel.androidPackageName) {
                const storeIdentifier = channel.androidPackageName;
                await this.pollOne(channel, 'android', storeIdentifier, () => this.lookup.lookupGooglePlay(storeIdentifier));
            }
        }
    }

    private async pollOne(
        channel: ChannelEntity,
        platform: TargetPlatform,
        storeIdentifier: string,
        fetcher: () => Promise<IStoreVersionLookupResult | null>
    ): Promise<void> {
        let result: IStoreVersionLookupResult | null;
        try {
            result = await fetcher();
        } catch (err) {
            this.logger.warn(`Store lookup failed for channel=${channel.id} platform=${platform}: ${(err as Error).message}`);
            return;
        }
        if (!result) return;

        const recorded = await recordDetectedStoreVersion(channel, platform, storeIdentifier, result);
        if (recorded?.created) this.logger.info(`Detected new ${platform} version ${result.version} for channel ${channel.id}`);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
