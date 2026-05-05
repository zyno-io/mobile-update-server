import { createMySQLDatabase, MySQLDatabaseSession } from '@zyno-io/dk-server-foundation';

import { AppEntity } from './entities/App.entity';
import { BinaryBuildEntity } from './entities/BinaryBuild.entity';
import { ChannelEntity } from './entities/Channel.entity';
import { DeviceStateEntity } from './entities/DeviceState.entity';
import { StoreVersionEntity } from './entities/StoreVersion.entity';
import { UpdateEntity } from './entities/Update.entity';
import { UpdateAssetEntity } from './entities/UpdateAsset.entity';
import { UserEntity } from './entities/User.entity';
import { VcsIntegrationEntity } from './entities/VcsIntegration.entity';

export class DB extends createMySQLDatabase({ enableLocksTable: true }, [
    AppEntity,
    BinaryBuildEntity,
    ChannelEntity,
    DeviceStateEntity,
    StoreVersionEntity,
    UpdateEntity,
    UpdateAssetEntity,
    UserEntity,
    VcsIntegrationEntity
]) {}

export type DBSession = MySQLDatabaseSession;
