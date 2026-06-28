import { http, HttpBadRequestError, HttpNotFoundError, HttpQueries, HttpRequest, HttpResponse } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';
import { uuid } from '@deepkit/type';
import { createPersistedEntity } from '@zyno-io/dk-server-foundation';
import { randomBytes } from 'crypto';

import { AppEntity } from '../entities/App.entity';
import { ChannelEntity, IRolloutMember } from '../entities/Channel.entity';
import { DeviceStateEntity } from '../entities/DeviceState.entity';
import { StoreVersionEntity } from '../entities/StoreVersion.entity';
import { UpdateEntity, UpdateStatus } from '../entities/Update.entity';
import { TargetPlatform } from '../entities/UpdateAsset.entity';
import { UpdateAssetEntity } from '../entities/UpdateAsset.entity';
import { ManifestBuilderService } from '../services/ManifestBuilder.service';

export interface INativeUpdateStatusResponse {
    platform: TargetPlatform;
    channelId: string;
    nativeUpdateRequiredAt: string | null;
    nativeUpdateRequired: boolean;
    latestStoreVersion: string | null;
    latestStoreVersionDetectedAt: string | null;
    storeUrl: string | null;
}

interface ParsedRequest {
    protocolVersion: number;
    platform: 'ios' | 'android';
    runtimeVersion: string;
    channelId: string;
    currentUpdateId: string | null;
    deviceId: string | null;
    accept: string;
}

@http.controller('/api/manifest')
export class ManifestController {
    constructor(
        private logger: ScopedLogger,
        private manifestBuilder: ManifestBuilderService
    ) {}

    @http.GET(':appId/native-status')
    async nativeStatus(appId: string, query: HttpQueries<{ channelId: string; platform: TargetPlatform }>): Promise<INativeUpdateStatusResponse> {
        const channelId = (query.channelId ?? '').trim();
        if (!channelId) throw new HttpNotFoundError();
        if (query.platform !== 'ios' && query.platform !== 'android') throw new HttpNotFoundError();

        const app = await AppEntity.query().filter({ id: appId, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();

        const channel = await ChannelEntity.query().filter({ id: channelId, appId: app.id, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpNotFoundError();

        const requiredAt = query.platform === 'ios' ? channel.iosNativeUpdateRequiredAt : channel.androidNativeUpdateRequiredAt;

        const latestStore = await StoreVersionEntity.query()
            .filter({ channelId: channel.id, platform: query.platform })
            .orderBy('firstDetectedAt', 'desc')
            .findOneOrUndefined();

        return {
            platform: query.platform,
            channelId: channel.id,
            nativeUpdateRequiredAt: requiredAt ? requiredAt.toISOString() : null,
            nativeUpdateRequired: !!(requiredAt && requiredAt.getTime() <= Date.now()),
            latestStoreVersion: latestStore?.version ?? null,
            latestStoreVersionDetectedAt: latestStore ? latestStore.firstDetectedAt.toISOString() : null,
            storeUrl: query.platform === 'ios' ? channel.iosStoreUrl : channel.androidStoreUrl
        };
    }

    @http.GET(':appId')
    async manifest(appId: string, request: HttpRequest, response: HttpResponse): Promise<void> {
        const parsed = this.parseRequest(request);
        if (!parsed) {
            response.writeHead(400, { 'Content-Type': 'text/plain' });
            response.end('Missing or invalid Expo Updates headers');
            return;
        }

        const app = await AppEntity.query().filter({ id: appId, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();

        const channel = await ChannelEntity.query().filter({ id: parsed.channelId, appId: app.id, deletedAt: null }).findOneOrUndefined();
        if (!channel) throw new HttpBadRequestError('Invalid channel');

        const update = await this.selectUpdate(app.id, channel, parsed);

        // Always record device check-in, even if we won't serve a new update.
        await this.recordDeviceCheckIn(app.id, channel.id, parsed, update?.id ?? null);

        // Stored ids are lowercase (uuid7) and we lowercase incoming ones at parse time.
        if (!update || update.id === parsed.currentUpdateId) {
            return this.sendNoUpdateAvailable(response, parsed);
        }

        const assets = await UpdateAssetEntity.query().filter({ updateId: update.id }).find();
        const manifest = this.manifestBuilder.buildManifest(update, assets, parsed.platform);

        return this.sendManifest(response, manifest);
    }

    private parseRequest(request: HttpRequest): ParsedRequest | null {
        const headers = request.headers;
        const protocolVersion = Number(headers['expo-protocol-version'] ?? '1');
        const platform = headers['expo-platform'];
        const runtimeVersion = headers['expo-runtime-version'];
        const channelIdRaw = headers['expo-channel-name'];
        const currentUpdateIdRaw = headers['expo-current-update-id'] as string | undefined;
        const currentUpdateId = currentUpdateIdRaw ? currentUpdateIdRaw.toLowerCase() : null;
        const accept = (headers.accept as string | undefined) ?? 'multipart/mixed';

        if (protocolVersion !== 1) return null;
        if (platform !== 'ios' && platform !== 'android') return null;
        if (typeof runtimeVersion !== 'string' || !runtimeVersion) return null;
        if (typeof channelIdRaw !== 'string' || !channelIdRaw) return null;

        const deviceIdHeader = headers['mus-device-id'];
        const deviceId = typeof deviceIdHeader === 'string' && deviceIdHeader ? deviceIdHeader : null;

        return {
            protocolVersion,
            platform,
            runtimeVersion,
            channelId: channelIdRaw.toLowerCase(),
            currentUpdateId,
            deviceId,
            accept
        };
    }

    private async selectUpdate(appId: string, channel: ChannelEntity, parsed: ParsedRequest): Promise<UpdateEntity | null> {
        // Tiers are cumulative going forward: staging → stagingMembers only,
        // canary → staging ∪ canary, released → everyone. We pick the freshest update
        // whose tier the request is eligible for, so a canary-only device still gets
        // the latest canary build even when a newer staging build exists. A request
        // matches a tier if its device id appears under that tier.
        const inStaging = this.matchesAny(channel.stagingMembers ?? [], parsed.deviceId);
        const inCanary = this.matchesAny(channel.canaryMembers, parsed.deviceId);

        const filters: Array<{ statuses: UpdateStatus[]; eligible: boolean }> = [
            { statuses: ['staging', 'canary', 'released'], eligible: inStaging },
            { statuses: ['canary', 'released'], eligible: inStaging || inCanary },
            { statuses: ['released'], eligible: true }
        ];

        for (const { statuses, eligible } of filters) {
            if (!eligible) continue;
            const candidate = await UpdateEntity.query()
                .filter({
                    appId,
                    channelId: channel.id,
                    platform: parsed.platform,
                    runtimeVersion: parsed.runtimeVersion,
                    status: { $in: statuses }
                })
                .orderBy('createdAt', 'desc')
                .orderBy('id', 'desc')
                .findOneOrUndefined();
            if (candidate) return candidate;
        }
        return null;
    }

    private matchesAny(members: IRolloutMember[], deviceId: string | null): boolean {
        if (!deviceId) return false;
        for (const m of members) {
            if (m.type === 'device' && m.id === deviceId) return true;
        }
        return false;
    }

    private async recordDeviceCheckIn(appId: string, channelId: string, parsed: ParsedRequest, servedUpdateId: string | null): Promise<void> {
        if (!parsed.deviceId) return;

        try {
            const existing = await DeviceStateEntity.query().filter({ appId, channelId, deviceId: parsed.deviceId }).findOneOrUndefined();

            const currentUpdateId = parsed.currentUpdateId ?? servedUpdateId;

            if (existing) {
                existing.platform = parsed.platform;
                existing.runtimeVersion = parsed.runtimeVersion;
                existing.currentUpdateId = currentUpdateId;
                existing.lastCheckInAt = new Date();
                await existing.save();
            } else {
                await createPersistedEntity(DeviceStateEntity, {
                    id: uuid(),
                    appId,
                    channelId,
                    deviceId: parsed.deviceId,
                    platform: parsed.platform,
                    runtimeVersion: parsed.runtimeVersion,
                    currentUpdateId,
                    lastCheckInAt: new Date()
                });
            }
        } catch (err) {
            this.logger.warn(`Failed to record device check-in: ${err}`);
        }
    }

    private sendNoUpdateAvailable(response: HttpResponse, parsed: ParsedRequest): void {
        const directive = this.manifestBuilder.buildNoUpdateAvailableDirective();
        const directiveJson = JSON.stringify(directive);

        const accept = parsed.accept;
        if (accept.includes('multipart/mixed')) {
            const boundary = `mus-${randomBytes(16).toString('hex')}`;
            const body = this.encodeMultipart(boundary, [{ name: 'directive', contentType: 'application/json', body: directiveJson }]);

            response.writeHead(200, {
                'Content-Type': `multipart/mixed; boundary=${boundary}`,
                'expo-protocol-version': '1',
                'expo-sfv-version': '0',
                'cache-control': 'private, max-age=0'
            });
            response.end(body);
        } else {
            response.writeHead(200, {
                'Content-Type': 'application/json',
                'expo-protocol-version': '1',
                'cache-control': 'private, max-age=0'
            });
            response.end(directiveJson);
        }
    }

    private sendManifest(response: HttpResponse, manifest: object): void {
        const manifestJson = JSON.stringify(manifest);
        const boundary = `mus-${randomBytes(16).toString('hex')}`;

        const body = this.encodeMultipart(boundary, [{ name: 'manifest', contentType: 'application/json; charset=utf-8', body: manifestJson }]);

        response.writeHead(200, {
            'Content-Type': `multipart/mixed; boundary=${boundary}`,
            'expo-protocol-version': '1',
            'expo-sfv-version': '0',
            'cache-control': 'private, max-age=0'
        });
        response.end(body);
    }

    private encodeMultipart(boundary: string, parts: { name: string; contentType: string; body: string }[]): Buffer {
        const segments: string[] = [];
        for (const part of parts) {
            segments.push(`--${boundary}`);
            segments.push(`Content-Disposition: form-data; name="${part.name}"`);
            segments.push(`Content-Type: ${part.contentType}`);
            segments.push('');
            segments.push(part.body);
        }
        segments.push(`--${boundary}--`);
        segments.push('');
        return Buffer.from(segments.join('\r\n'), 'utf-8');
    }
}
