import '../shared/setup';
import { HttpRequest } from '@deepkit/http';
import { uuid } from '@deepkit/type';
import { createPersistedEntity, TestingHelpers, uuid7 } from '@zyno-io/dk-server-foundation';
import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { CoreAppOptions } from '../../src/app';
import { AppEntity } from '../../src/entities/App.entity';
import { ChannelEntity } from '../../src/entities/Channel.entity';
import { DeviceStateEntity } from '../../src/entities/DeviceState.entity';
import { StoreVersionEntity } from '../../src/entities/StoreVersion.entity';
import { UpdateEntity } from '../../src/entities/Update.entity';
import { UpdateAssetEntity } from '../../src/entities/UpdateAsset.entity';
import { VcsIntegrationEntity } from '../../src/entities/VcsIntegration.entity';
import { startMockGitLab, ZERO_ID } from '../shared/setup';

const APP_ID = '11111111-1111-1111-1111-111111111111';
const CHANNEL_ID = '22222222-2222-2222-2222-222222222222';
const RUNTIME = '1.0.0';

describe('manifest + native-status', () => {
    let facade: ReturnType<typeof TestingHelpers.createTestingFacade>;
    let gitlab: { port: number; close: () => Promise<void> };

    before(async () => {
        gitlab = await startMockGitLab();

        facade = TestingHelpers.createTestingFacade(CoreAppOptions, {
            enableDatabase: true,
            databasePrefix: 'mus_manifest'
        });
        await facade.start();

        await seedBase(gitlab.port);
    });

    after(async () => {
        await gitlab.close();
    });

    test('released update served to any device', async () => {
        await clearUpdates();
        const released = await makeRelease('released');

        const response = await facade.request(manifestRequest('any-random-device'));
        assert.strictEqual(response.statusCode, 200);
        const body = response.bodyString;
        assert.match(body, /name="manifest"/, 'expected multipart manifest part');
        assert.match(body, new RegExp(`"id":"${released.id.toLowerCase()}"`), 'manifest contains released update id');
    });

    test('canary update served to device in canary list', async () => {
        await clearUpdates();
        await makeRelease('released');
        const canary = await makeRelease('canary');

        const response = await facade.request(manifestRequest('canary-device-1'));
        assert.strictEqual(response.statusCode, 200);
        assert.match(response.bodyString, new RegExp(`"id":"${canary.id.toLowerCase()}"`));
    });

    test('canary update NOT served to non-listed device → falls back to released', async () => {
        await clearUpdates();
        const released = await makeRelease('released');
        const canary = await makeRelease('canary');

        const response = await facade.request(manifestRequest('some-other-device'));
        assert.strictEqual(response.statusCode, 200);
        const body = response.bodyString;
        assert.match(body, new RegExp(`"id":"${released.id.toLowerCase()}"`), 'should serve released, not canary');
        assert.doesNotMatch(body, new RegExp(`"id":"${canary.id.toLowerCase()}"`), 'should NOT serve canary');
    });

    test('device with no device-id header gets released, not canary', async () => {
        await clearUpdates();
        const released = await makeRelease('released');
        await makeRelease('canary');

        const response = await facade.request(manifestRequest()); // no device-id
        assert.strictEqual(response.statusCode, 200);
        assert.match(response.bodyString, new RegExp(`"id":"${released.id.toLowerCase()}"`));
    });

    test('staging update served to device in staging list', async () => {
        await clearUpdates();
        await makeRelease('released');
        const staging = await makeRelease('staging');

        const response = await facade.request(manifestRequest('staging-device-1'));
        assert.strictEqual(response.statusCode, 200);
        assert.match(response.bodyString, new RegExp(`"id":"${staging.id.toLowerCase()}"`));
    });

    test('staging update NOT served to canary-only device → falls back to released', async () => {
        await clearUpdates();
        const released = await makeRelease('released');
        const staging = await makeRelease('staging');

        const response = await facade.request(manifestRequest('canary-device-1'));
        assert.strictEqual(response.statusCode, 200);
        const body = response.bodyString;
        assert.match(body, new RegExp(`"id":"${released.id.toLowerCase()}"`), 'canary-only device falls back to released');
        assert.doesNotMatch(body, new RegExp(`"id":"${staging.id.toLowerCase()}"`));
    });

    test('canary update served to staging-list device (tiers are cumulative)', async () => {
        await clearUpdates();
        await makeRelease('released');
        const canary = await makeRelease('canary');

        const response = await facade.request(manifestRequest('staging-device-1'));
        assert.strictEqual(response.statusCode, 200);
        assert.match(response.bodyString, new RegExp(`"id":"${canary.id.toLowerCase()}"`), 'staging-list device should still receive canary');
    });

    test('newer staging skipped for canary-only device, older canary still served', async () => {
        await clearUpdates();
        const released = await makeRelease('released');
        const canary = await makeRelease('canary');
        const staging = await makeRelease('staging'); // newer than the canary

        const response = await facade.request(manifestRequest('canary-device-1'));
        assert.strictEqual(response.statusCode, 200);
        const body = response.bodyString;
        assert.match(body, new RegExp(`"id":"${canary.id.toLowerCase()}"`), 'canary device falls back to latest canary');
        assert.doesNotMatch(body, new RegExp(`"id":"${staging.id.toLowerCase()}"`));
        assert.doesNotMatch(body, new RegExp(`"id":"${released.id.toLowerCase()}"`));
    });

    test('no-update-available directive when client already has latest', async () => {
        await clearUpdates();
        const released = await makeRelease('released');

        const response = await facade.request(manifestRequest('any-device', released.id));
        assert.strictEqual(response.statusCode, 200);
        assert.match(response.bodyString, /name="directive"/);
        assert.match(response.bodyString, /"type":"noUpdateAvailable"/);
    });

    test('unknown app id → 404', async () => {
        const req = HttpRequest.GET('/api/manifest/99999999-9999-9999-9999-999999999999')
            .header('expo-protocol-version', '1')
            .header('expo-platform', 'ios')
            .header('expo-runtime-version', RUNTIME)
            .header('expo-channel-name', CHANNEL_ID);
        const response = await facade.request(req);
        assert.strictEqual(response.statusCode, 404);
    });

    test('DeviceState row created on manifest hit with device-id', async () => {
        await clearUpdates();
        const released = await makeRelease('released');

        await facade.request(manifestRequest('tracking-device-99'));

        const state = await DeviceStateEntity.query()
            .filter({ appId: APP_ID, channelId: CHANNEL_ID, deviceId: 'tracking-device-99' })
            .findOneOrUndefined();
        assert.ok(state, 'expected DeviceState row');
        assert.strictEqual(state.platform, 'ios');
        assert.strictEqual(state.runtimeVersion, RUNTIME);
        assert.strictEqual(state.currentUpdateId, released.id);
    });

    test('native-status reports nativeUpdateRequired=true when requiredAt is in the past', async () => {
        const past = atSecond(Date.now() - 60_000);
        await setRequiredAt('ios', past);

        const response = await facade.request(nativeStatusRequest('ios'));
        assert.strictEqual(response.statusCode, 200);
        const body = response.json as {
            nativeUpdateRequiredAt: string | null;
            nativeUpdateRequired: boolean;
            platform: string;
            channelId: string;
        };
        assert.strictEqual(body.platform, 'ios');
        assert.strictEqual(body.channelId, CHANNEL_ID);
        assert.strictEqual(body.nativeUpdateRequiredAt, past.toISOString());
        assert.strictEqual(body.nativeUpdateRequired, true);
    });

    test('native-status reports nativeUpdateRequired=false when requiredAt is in the future', async () => {
        const future = atSecond(Date.now() + 7 * 86_400_000);
        await setRequiredAt('ios', future);

        const response = await facade.request(nativeStatusRequest('ios'));
        assert.strictEqual(response.statusCode, 200);
        const body = response.json as { nativeUpdateRequiredAt: string | null; nativeUpdateRequired: boolean };
        assert.strictEqual(body.nativeUpdateRequiredAt, future.toISOString());
        assert.strictEqual(body.nativeUpdateRequired, false);
    });

    test('native-status returns the most recent detected store version', async () => {
        const oldDetected = atSecond(Date.now() - 14 * 86_400_000);
        const newDetected = atSecond(Date.now() - 1 * 86_400_000);
        await createPersistedEntity(StoreVersionEntity, {
            id: uuid7(),
            appId: APP_ID,
            channelId: CHANNEL_ID,
            platform: 'ios',
            version: '1.0.0',
            firstDetectedAt: oldDetected
        });
        await createPersistedEntity(StoreVersionEntity, {
            id: uuid7(),
            appId: APP_ID,
            channelId: CHANNEL_ID,
            platform: 'ios',
            version: '1.1.0',
            firstDetectedAt: newDetected
        });

        const response = await facade.request(nativeStatusRequest('ios'));
        assert.strictEqual(response.statusCode, 200);
        const body = response.json as {
            latestStoreVersion: string | null;
            latestStoreVersionDetectedAt: string | null;
        };
        assert.strictEqual(body.latestStoreVersion, '1.1.0');
        assert.strictEqual(body.latestStoreVersionDetectedAt, newDetected.toISOString());
    });

    test('native-status returns null fields for the platform that has no requirement and no store data', async () => {
        await setRequiredAt('android', null);
        await StoreVersionEntity.query().filter({ channelId: CHANNEL_ID, platform: 'android' }).deleteMany();

        const response = await facade.request(nativeStatusRequest('android'));
        assert.strictEqual(response.statusCode, 200);
        const body = response.json as {
            nativeUpdateRequiredAt: string | null;
            nativeUpdateRequired: boolean;
            latestStoreVersion: string | null;
            latestStoreVersionDetectedAt: string | null;
        };
        assert.strictEqual(body.nativeUpdateRequiredAt, null);
        assert.strictEqual(body.nativeUpdateRequired, false);
        assert.strictEqual(body.latestStoreVersion, null);
        assert.strictEqual(body.latestStoreVersionDetectedAt, null);
    });

    test('native-status 404s on unknown app, unknown channel, and bad platform', async () => {
        const unknownApp = await facade.request(nativeStatusRequest('ios', '99999999-9999-9999-9999-999999999999'));
        assert.strictEqual(unknownApp.statusCode, 404, 'unknown app');

        const unknownChannel = await facade.request(nativeStatusRequest('ios', APP_ID, '00000000-0000-0000-0000-000000000000'));
        assert.strictEqual(unknownChannel.statusCode, 404, 'unknown channel');

        const badPlatform = await facade.request(HttpRequest.GET(`/api/manifest/${APP_ID}/native-status?channelId=${CHANNEL_ID}&platform=windows`));
        // Deepkit's union validator rejects invalid enum values with 400 before reaching the handler.
        assert.strictEqual(badPlatform.statusCode, 400, 'bad platform');
    });
});

async function seedBase(gitlabPort: number) {
    await createPersistedEntity(VcsIntegrationEntity, {
        id: ZERO_ID,
        name: 'mock-gitlab',
        platform: 'gitlab',
        config: {
            url: `http://127.0.0.1:${gitlabPort}`,
            clientId: 'cid',
            clientSecret: 'csecret'
        },
        deletedAt: null
    });

    await createPersistedEntity(AppEntity, {
        id: APP_ID,
        name: 'Test App',
        vcsId: ZERO_ID,
        projectPath: 'group/test',
        vcsProjectId: 1,
        createdAt: new Date(),
        deletedAt: null
    });

    await createPersistedEntity(ChannelEntity, {
        id: CHANNEL_ID,
        appId: APP_ID,
        name: 'production',
        branchName: 'main',
        iosTrackingEnabled: false,
        androidTrackingEnabled: false,
        stagingMembers: [
            { type: 'device', id: 'staging-device-1', comment: 'lead engineer' }
        ],
        canaryMembers: [
            { type: 'device', id: 'canary-device-1', comment: 'beta tester' }
        ],
        createdAt: new Date(),
        deletedAt: null
    });
}

async function makeRelease(status: 'staging' | 'canary' | 'released'): Promise<UpdateEntity> {
    const update = await createPersistedEntity(UpdateEntity, {
        id: uuid7(),
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'ios',
        runtimeVersion: RUNTIME,
        status,
        commitHash: 'a'.repeat(40),
        commitSubject: `${status} build`,
        commitAuthor: 'tester',
        ciJobId: '1',
        ciTokenHash: null,
        expoConfigJson: { name: 'Test App' },
        metadataJson: {},
        createdAt: new Date(),
        releasedAt: status === 'released' ? new Date() : null,
        promotedById: null
    });

    // one launch asset per platform
    for (const platform of ['ios', 'android'] as const) {
        await createPersistedEntity(UpdateAssetEntity, {
            id: uuid(),
            appId: APP_ID,
            updateId: update.id,
            key: `bundles/${platform}-bundle.hbc`,
            contentType: 'application/javascript',
            fileExtension: 'hbc',
            sha256: `${platform}-${update.id.substring(0, 8)}`,
            md5: 'd41d8cd98f00b204e9800998ecf8427e',
            size: 1234,
            isLaunchAsset: true,
            platform,
            s3Key: `apps/${APP_ID}/assets/${platform}-${update.id}.hbc`
        });
    }

    return update;
}

function manifestRequest(deviceId?: string, currentUpdateId?: string) {
    const req = HttpRequest.GET(`/api/manifest/${APP_ID}`)
        .header('expo-protocol-version', '1')
        .header('expo-platform', 'ios')
        .header('expo-runtime-version', RUNTIME)
        .header('expo-channel-name', CHANNEL_ID)
        .header('accept', 'multipart/mixed');
    if (deviceId) req.header('mus-device-id', deviceId);
    if (currentUpdateId) req.header('expo-current-update-id', currentUpdateId);
    return req;
}

async function clearUpdates() {
    await UpdateAssetEntity.query().filter({ appId: APP_ID }).deleteMany();
    await UpdateEntity.query().filter({ appId: APP_ID }).deleteMany();
    await DeviceStateEntity.query().filter({ appId: APP_ID }).deleteMany();
}

function nativeStatusRequest(platform: 'ios' | 'android' = 'ios', appId = APP_ID, channelId = CHANNEL_ID) {
    return HttpRequest.GET(`/api/manifest/${appId}/native-status?channelId=${encodeURIComponent(channelId)}&platform=${platform}`);
}

// MySQL DATETIME has 1-second precision; round so timestamps survive the round-trip.
function atSecond(ms: number): Date {
    return new Date(Math.floor(ms / 1000) * 1000);
}

async function setRequiredAt(platform: 'ios' | 'android', requiredAt: Date | null): Promise<void> {
    const channel = await ChannelEntity.query().filter({ id: CHANNEL_ID }).findOne();
    if (platform === 'ios') channel.iosNativeUpdateRequiredAt = requiredAt;
    else channel.androidNativeUpdateRequiredAt = requiredAt;
    await channel.save();
}
