import { entity, PrimaryKey } from '@zyno-io/ts-server-foundation';
import { BaseEntity, UuidString } from '@zyno-io/ts-server-foundation';

@entity.name('deviceStates')
@entity.index(['appId', 'channelId', 'deviceId'], { unique: true, name: 'deviceStates_app_channel_device_idx' })
export class DeviceStateEntity extends BaseEntity {
    id!: UuidString & PrimaryKey;
    appId!: UuidString;
    channelId!: UuidString;
    deviceId!: string;
    platform!: 'ios' | 'android';
    runtimeVersion!: string;
    currentUpdateId!: UuidString | null;
    lastCheckInAt!: Date;
}
