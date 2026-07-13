import { HttpBadRequestError } from '@zyno-io/ts-server-foundation';

import { TargetPlatform } from '../entities/UpdateAsset.entity';

export function parseTargetPlatform(platform: string | undefined): TargetPlatform {
    if (platform === 'ios' || platform === 'android') return platform;
    throw new HttpBadRequestError('platform must be ios or android');
}

export function optionalTargetPlatform(platform: string | undefined): TargetPlatform | undefined {
    if (platform === undefined) return undefined;
    return parseTargetPlatform(platform);
}
