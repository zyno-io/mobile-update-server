import '../shared/setup';
import { HttpRequest } from '@zyno-io/ts-server-foundation';
import { uuid } from '@zyno-io/ts-server-foundation';
import { createPersistedEntity, JWT, TestingHelpers, uuid7 } from '@zyno-io/ts-server-foundation';
import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { hashCiToken } from '../../src/accessories/AuthMiddleware.accessory';
import { CoreAppOptions } from '../../src/app';
import { AppEntity } from '../../src/entities/App.entity';
import { ChannelEntity } from '../../src/entities/Channel.entity';
import { DeviceStateEntity } from '../../src/entities/DeviceState.entity';
import { StoreVersionEntity } from '../../src/entities/StoreVersion.entity';
import { UpdateEntity } from '../../src/entities/Update.entity';
import { UpdateAssetEntity } from '../../src/entities/UpdateAsset.entity';
import { UserEntity } from '../../src/entities/User.entity';
import { VcsIntegrationEntity } from '../../src/entities/VcsIntegration.entity';
import { IManifestBody } from '../../src/services/ManifestBuilder.service';
import { startMockGitLab, TEST_CI_TOKEN, ZERO_ID } from '../shared/setup';

const APP_ID = '11111111-1111-1111-1111-111111111111';
const CHANNEL_ID = '22222222-2222-2222-2222-222222222222';
const RUNTIME = '1.0.0';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const IOS_STORE_IDENTIFIER = 'com.example.manifest';

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

    test('superseded canary updates are excluded from manifest selection', async () => {
        await clearUpdates();
        const released = await makeRelease('released');
        const canary = await makeRelease('canary');
        canary.supersededAt = new Date();
        await canary.save();
        const response = await facade.request(manifestRequest('canary-device-1'));
        assert.strictEqual(multipartJson(response.bodyString).id, released.id);
    });

    test('a draft finalized after rollback gets a manifest timestamp newer than the directive', async () => {
        await clearUpdates();
        const revoked = await makeRelease('released', { createdAt: atSecond(Date.now()) });
        const draft = await makeRelease('released', { createdAt: revoked.createdAt });
        draft.status = 'draft';
        draft.ciTokenHash = hashCiToken(TEST_CI_TOKEN);
        await draft.save();
        const rollback = await rollbackRelease(revoked.id);
        assert.strictEqual(rollback.statusCode, 200);
        const directiveResponse = await facade.request(manifestRequest('staging-device-1', revoked.id));
        const directive = multipartJson(directiveResponse.bodyString);
        assert.strictEqual(directive.type, 'rollBackToEmbedded');
        const finalized = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${draft.id}/finalize`).header(
                'authorization',
                `Bearer ${TEST_CI_TOKEN}`
            )
        );
        assert.strictEqual(finalized.statusCode, 200);
        const response = await facade.request(manifestRequest('staging-device-1', revoked.id));
        const manifest = multipartJson(response.bodyString);
        assert.strictEqual(manifest.id, draft.id);
        assert.ok(new Date(manifest.createdAt!).getTime() > new Date(directive.parameters.commitTime).getTime());
    });

    test('legacy rollback serves a stable embedded directive instead of the restored older manifest', async () => {
        await clearUpdates();
        const prior = await makeRelease('released', { createdAt: new Date('2026-08-17T06:22:09Z') });
        const revoked = await makeRelease('released', { createdAt: new Date('2026-08-20T04:00:00Z') });
        revoked.status = 'rolled-back';
        revoked.supersededAt = new Date('2026-10-03T09:00:43Z');
        await revoked.save();

        for (const currentId of [revoked.id.toUpperCase(), prior.id, undefined]) {
            const response = await facade.request(manifestRequest('rollback-device', currentId));
            assert.strictEqual(response.statusCode, 200);
            assert.match(response.bodyString, /name="directive"/);
            assert.doesNotMatch(response.bodyString, /name="manifest"/);
            assert.deepStrictEqual(multipartJson(response.bodyString), {
                type: 'rollBackToEmbedded',
                parameters: { commitTime: '2026-10-03T09:00:43.000Z' }
            });
        }
    });

    test('promoting a pre-rollback staging update republishes its immutable manifest for canary and release', async () => {
        for (const restorePrior of [false, true]) {
            await clearUpdates();
            const prior = restorePrior ? await makeRelease('released', { createdAt: atSecond(Date.now() - 120_000) }) : null;
            const revoked = await makeRelease('released', { createdAt: atSecond(Date.now() - 60_000) });
            if (prior) {
                prior.supersededAt = revoked.createdAt;
                prior.supersededById = revoked.id;
                await prior.save();
            }
            const staging = await makeRelease('staging', { createdAt: atSecond(Date.now() - 30_000), commitHash: '0'.repeat(40) });
            const originalResponse = await facade.request(manifestRequest('staging-device-1'));
            const originalManifest = multipartJson(originalResponse.bodyString);
            assert.strictEqual(originalManifest.id, staging.id, 'the staging manifest has already been served');
            const rollback = await rollbackRelease(revoked.id);
            assert.strictEqual(rollback.statusCode, 200);
            const rollbackResponse = await facade.request(manifestRequest(undefined, revoked.id));
            const rollbackBody = multipartJson(rollbackResponse.bodyString);
            const rollbackTime = new Date(rollbackBody.createdAt ?? rollbackBody.parameters.commitTime).getTime();

            const jwt = await JWT.generate({ subject: USER_ID });
            const canaryResponse = await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${staging.id}/promote`).header('authorization', `Bearer ${jwt}`)
            );
            assert.strictEqual(canaryResponse.statusCode, 200);
            const promotedId = canaryResponse.json.id;
            assert.notStrictEqual(promotedId, staging.id, 'a served manifest must get a new UUID when its timestamp advances');
            assert.strictEqual(canaryResponse.json.status, 'canary');
            const source = await UpdateEntity.query().filter({ id: staging.id }).findOne();
            assert.strictEqual(source.createdAt.toISOString(), originalManifest.createdAt, 'do not mutate a cached manifest');
            assert.strictEqual(source.supersededById, promotedId);
            assert.ok(source.supersededAt);
            const canaryManifestResponse = await facade.request(manifestRequest('canary-device-1', revoked.id));
            const canaryManifest = multipartJson(canaryManifestResponse.bodyString);
            assert.strictEqual(canaryManifest.id, promotedId);
            assert.ok(new Date(canaryManifest.createdAt!).getTime() > rollbackTime, 'Expo must accept the promotion after rollback');
            assert.ok(canaryManifest.launchAsset && originalManifest.launchAsset);
            assert.strictEqual(canaryManifest.launchAsset.hash, originalManifest.launchAsset.hash, 'republish the same asset bytes');
            assert.strictEqual(canaryManifest.launchAsset.key, originalManifest.launchAsset.key);

            const releaseResponse = await facade.request(
                restorePrior
                    ? HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/promote-ci`).header(
                          'authorization',
                          `Bearer ${TEST_CI_TOKEN}`
                      )
                    : HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${promotedId}/promote`).header(
                          'authorization',
                          `Bearer ${jwt}`
                      )
            );
            assert.strictEqual(releaseResponse.statusCode, 200);
            const released = restorePrior ? releaseResponse.json[0] : releaseResponse.json;
            assert.strictEqual(released.id, promotedId, 'later promotion preserves the already-newer identity');
            assert.strictEqual(released.status, 'released');
            const releasedManifestResponse = await facade.request(manifestRequest(undefined, revoked.id));
            assert.strictEqual(multipartJson(releasedManifestResponse.bodyString).id, promotedId);
        }
    });

    test('rollback without a prior release serves a directive newer than an immediate release', async () => {
        await clearUpdates();
        const revoked = await makeRelease('released', { createdAt: atSecond(Date.now()) });
        const rollback = await rollbackRelease(revoked.id);
        assert.strictEqual(rollback.statusCode, 200);
        const response = await facade.request(manifestRequest('rollback-device', revoked.id));
        const directive = multipartJson(response.bodyString);
        assert.strictEqual(directive.type, 'rollBackToEmbedded');
        assert.ok(new Date(directive.parameters.commitTime).getTime() > revoked.createdAt.getTime());
        const repeated = await facade.request(manifestRequest(undefined, revoked.id));
        assert.deepStrictEqual(multipartJson(repeated.bodyString), directive);

        const jsonResponse = await facade.request(manifestRequest().header('accept', 'application/json'));
        assert.deepStrictEqual(jsonResponse.json, directive);
        const device = await DeviceStateEntity.query().filter({ appId: APP_ID, deviceId: 'rollback-device' }).findOne();
        assert.strictEqual(device.currentUpdateId, revoked.id);
        const duplicate = await rollbackRelease(revoked.id);
        assert.strictEqual(duplicate.statusCode, 400);
    });

    test('rollback is scoped to app, channel, platform and runtime; a newer fix supersedes it', async () => {
        await clearUpdates();
        const revoked = await makeRelease('released', { createdAt: atSecond(Date.now() - 60_000) });
        const rollbackResponse = await rollbackRelease(revoked.id);
        assert.strictEqual(rollbackResponse.statusCode, 200);
        for (const request of [
            manifestRequest().header('expo-platform', 'android'),
            manifestRequest().header('expo-runtime-version', 'another-runtime')
        ]) {
            const response = await facade.request(request);
            assert.strictEqual(multipartJson(response.bodyString).type, 'noUpdateAvailable');
        }
        // Change each scope dimension independently, keeping platform/runtime
        // equal; a marker from either must not override this channel's fix-forward.
        for (const overrides of [{ channelId: uuid() }, { appId: uuid() }]) {
            const other = await makeRelease('released', overrides);
            other.status = 'rolled-back';
            other.supersededAt = new Date(Date.now() + 86_400_000);
            await other.save();
        }
        const withdrawn = await UpdateEntity.query().filter({ id: revoked.id }).findOne();
        const forward = await makeRelease('released', { createdAt: new Date(withdrawn.supersededAt!.getTime() + 1000) });
        const response = await facade.request(manifestRequest(undefined, revoked.id));
        assert.strictEqual(multipartJson(response.bodyString).id, forward.id);
    });

    test('rollback republishes prior bytes with a new UUID and timestamp, then walks backward on further rollback', async () => {
        await clearUpdates();
        const oldest = await makeRelease('released', { createdAt: atSecond(Date.now() - 180_000) });
        const prior = await makeRelease('released', { createdAt: atSecond(Date.now() - 120_000), otaVersion: 'prior-version' });
        const revoked = await makeRelease('released', { createdAt: atSecond(Date.now() - 60_000) });
        for (const update of [oldest, prior]) {
            update.supersededAt = revoked.createdAt;
            update.supersededById = revoked.id;
            await update.save();
        }
        const originalAssets = await UpdateAssetEntity.query().filter({ updateId: prior.id }).orderBy('platform').find();
        const rollbackResponse = await rollbackRelease(revoked.id);
        assert.strictEqual(rollbackResponse.statusCode, 200);
        const restored = await UpdateEntity.query().filter({ status: 'released', supersededAt: null, channelId: CHANNEL_ID }).findOne();
        assert.notStrictEqual(restored.id, prior.id);
        assert.ok(restored.createdAt > revoked.createdAt, 'Expo requires a strictly newer manifest');
        assert.strictEqual(restored.rollbackSourceId, prior.id);
        assert.strictEqual(restored.otaVersion, prior.otaVersion);
        assert.deepStrictEqual(restored.expoConfigJson, prior.expoConfigJson);
        const restoredAssets = await UpdateAssetEntity.query().filter({ updateId: restored.id }).orderBy('platform').find();
        assert.strictEqual(restoredAssets.length, originalAssets.length);
        for (let i = 0; i < restoredAssets.length; i++) {
            assert.notStrictEqual(restoredAssets[i].id, originalAssets[i].id);
            assert.strictEqual(restoredAssets[i].s3Key, originalAssets[i].s3Key);
            assert.strictEqual(restoredAssets[i].sha256, originalAssets[i].sha256);
        }
        const response = await facade.request(manifestRequest(undefined, revoked.id));
        assert.strictEqual(multipartJson(response.bodyString).id, restored.id);
        const current = await facade.request(manifestRequest(undefined, restored.id.toUpperCase()));
        assert.strictEqual(multipartJson(current.bodyString).type, 'noUpdateAvailable');

        const nextRollback = await rollbackRelease(restored.id);
        assert.strictEqual(nextRollback.statusCode, 200);
        const next = await UpdateEntity.query().filter({ status: 'released', supersededAt: null, channelId: CHANNEL_ID }).findOne();
        assert.strictEqual(next.rollbackSourceId, oldest.id, 'do not restore the same prior bytes again');
        assert.ok(next.createdAt > restored.createdAt);
        const lastRollback = await rollbackRelease(next.id);
        assert.strictEqual(lastRollback.statusCode, 200);
        const embedded = await facade.request(manifestRequest(undefined, next.id));
        assert.strictEqual(multipartJson(embedded.bodyString).type, 'rollBackToEmbedded');
    });

    async function rollbackRelease(id: string) {
        const jwt = await JWT.generate({ subject: USER_ID });
        return facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${id}/rollback`).header('authorization', `Bearer ${jwt}`)
        );
    }

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
            storeIdentifier: IOS_STORE_IDENTIFIER,
            version: '1.0.0',
            firstDetectedAt: oldDetected,
            nativeUpdateRequiredAt: null
        });
        await createPersistedEntity(StoreVersionEntity, {
            id: uuid7(),
            appId: APP_ID,
            channelId: CHANNEL_ID,
            platform: 'ios',
            storeIdentifier: IOS_STORE_IDENTIFIER,
            version: '1.1.0',
            firstDetectedAt: newDetected,
            nativeUpdateRequiredAt: null
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

    await createPersistedEntity(UserEntity, {
        id: USER_ID,
        vcsId: ZERO_ID,
        vcsUserId: 'rollback-user',
        name: 'rollback-user',
        isAdmin: false,
        createdAt: new Date(),
        lastLoginAt: new Date(),
        vcsSession: { accessToken: 'tok', expiresAt: Date.now() + 3600_000, refreshToken: 'r', redirectUri: 'http://localhost' }
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
        iosBundleId: IOS_STORE_IDENTIFIER,
        iosTrackingEnabled: true,
        androidTrackingEnabled: false,
        stagingMembers: [{ type: 'device', id: 'staging-device-1', comment: 'lead engineer' }],
        canaryMembers: [{ type: 'device', id: 'canary-device-1', comment: 'beta tester' }],
        createdAt: new Date(),
        deletedAt: null
    });
}

async function makeRelease(status: 'staging' | 'canary' | 'released', overrides: Partial<UpdateEntity> = {}): Promise<UpdateEntity> {
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
        promotedById: null,
        supersededAt: null,
        supersededById: null,
        ...overrides
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
    let storeVersion = await StoreVersionEntity.query()
        .filter({ channelId: CHANNEL_ID, platform })
        .orderBy('firstDetectedAt', 'desc')
        .findOneOrUndefined();
    if (!storeVersion && requiredAt) {
        storeVersion = await createPersistedEntity(StoreVersionEntity, {
            id: uuid7(),
            appId: APP_ID,
            channelId: CHANNEL_ID,
            platform,
            storeIdentifier: platform === 'ios' ? IOS_STORE_IDENTIFIER : null,
            version: 'native-status-test',
            firstDetectedAt: new Date(Date.UTC(2026, 0, 1)),
            nativeUpdateRequiredAt: requiredAt
        });
    }
    if (!storeVersion) return;
    storeVersion.nativeUpdateRequiredAt = requiredAt;
    await storeVersion.save();
}

function multipartJson(body: string): Partial<IManifestBody> & { type?: string; parameters: { commitTime: string } } {
    const json = body.split('\r\n').find(line => line.startsWith('{'));
    assert.ok(json, 'expected a JSON multipart part');
    return JSON.parse(json);
}
