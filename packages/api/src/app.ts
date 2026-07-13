import { createApp, CreateAppOptions } from '@zyno-io/ts-server-foundation';
import { compact } from 'lodash';

import { AdminAuthMiddleware, UpdateCiTokenMiddleware, UserAuthMiddleware } from './accessories/AuthMiddleware.accessory';
import { UserResolver } from './accessories/Controller.accessory';
import { GitLabProjectAuthService } from './accessories/GitLabProjectAuth.accessory';
import { AppConfig, DEFAULT_MAX_ASSET_SIZE_BYTES } from './config';
import { AppsController } from './controllers/Apps.controller';
import { AssetsController } from './controllers/Assets.controller';
import { BinaryBuildsController } from './controllers/BinaryBuilds.controller';
import { ChannelsController } from './controllers/Channels.controller';
import { ManifestController } from './controllers/Manifest.controller';
import { MetricsController } from './controllers/Metrics.controller';
import { SessionController } from './controllers/Session.controller';
import { StoreVersionsController } from './controllers/StoreVersions.controller';
import { UpdatesController } from './controllers/Updates.controller';
import { UsersController } from './controllers/Users.controller';
import { VcsIntegrationsController } from './controllers/VcsIntegrations.controller';
import { Db } from './database';
import { DeletedDataCleanupJob } from './jobs/DeletedDataCleanup.job';
import { StoreVersionPollJob } from './jobs/StoreVersionPoll.job';
import { ManifestBuilderService } from './services/ManifestBuilder.service';
import { S3Service } from './services/S3.service';
import { StoreLookupService } from './services/StoreLookup.service';
import { VcsService } from './services/Vcs.service';

export const CoreAppOptions: CreateAppOptions<AppConfig> = {
    config: AppConfig,
    db: Db,
    cors: () => ({
        hosts: compact(['http://localhost:7935', 'http://localhost:7936']),
        credentials: true
    }),
    frameworkConfig: {
        port: 7935,
        http: {
            debug: false,
            parser: {
                maxFiles: 1,
                maxFileSize: DEFAULT_MAX_ASSET_SIZE_BYTES,
                maxTotalFileSize: DEFAULT_MAX_ASSET_SIZE_BYTES
            }
        }
    },
    staticFiles: true,
    controllers: [
        SessionController,
        AppsController,
        ChannelsController,
        UpdatesController,
        BinaryBuildsController,
        StoreVersionsController,
        ManifestController,
        AssetsController,
        MetricsController,
        VcsIntegrationsController,
        UsersController
    ],
    providers: [
        UserResolver,
        AdminAuthMiddleware,
        UserAuthMiddleware,
        UpdateCiTokenMiddleware,
        GitLabProjectAuthService,
        VcsService,
        S3Service,
        ManifestBuilderService,
        StoreLookupService
    ],
    listeners: [DeletedDataCleanupJob, StoreVersionPollJob]
};

export const createMobileUpdateServerApp = () => createApp(CoreAppOptions);
