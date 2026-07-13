import '../shared/setup';
import { HttpRequest } from '@zyno-io/ts-server-foundation';
import { uuid } from '@zyno-io/ts-server-foundation';
import { createPersistedEntity, JWT, TestingHelpers } from '@zyno-io/ts-server-foundation';
import { google } from 'googleapis';
import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { CoreAppOptions } from '../../src/app';
import { AppEntity } from '../../src/entities/App.entity';
import { ChannelEntity } from '../../src/entities/Channel.entity';
import { StoreVersionEntity } from '../../src/entities/StoreVersion.entity';
import { UserEntity } from '../../src/entities/User.entity';
import { VcsIntegrationEntity } from '../../src/entities/VcsIntegration.entity';
import { StoreVersionPollJob } from '../../src/jobs/StoreVersionPoll.job';
import { inferLegacyNativeUpdatePolicy } from '../../src/migrations/20260712_000000_native_update_policy';
import { IStoreVersionLookupResult, StoreLookupService } from '../../src/services/StoreLookup.service';
import { recordDetectedStoreVersion } from '../../src/services/StoreVersion.service';
import { mockGitLabState, startMockGitLab, TEST_VCS_PROJECT_ID, ZERO_ID } from '../shared/setup';

const APP_ID = '21212121-2121-2121-2121-212121212121';
const CHANNEL_TRACKED = '22222222-2222-2222-2222-222222222222';
const CHANNEL_DISABLED = '23232323-2323-2323-2323-232323232323';

describe('Google Play store lookup', () => {
    test('ignores an in-review production release in favor of the published release', async t => {
        const request = t.mock.method(google.auth.GoogleAuth.prototype, 'request', async () => ({
            data: {
                releases: [
                    {
                        releaseName: '314284018 (26.712.549)',
                        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
                        activeArtifacts: [{ versionCode: 314284018 }]
                    },
                    {
                        releaseName: '26.513.1640',
                        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_PUBLISHED',
                        activeArtifacts: [{ versionCode: 313769520 }]
                    }
                ]
            }
        }));
        const lookup = createGooglePlayLookup();

        const result = await lookup.lookupGooglePlay('app.zyno.talk');

        assert.deepStrictEqual(result, {
            version: '26.513.1640',
            storeUrl: 'https://play.google.com/store/apps/details?id=app.zyno.talk'
        });
        assert.strictEqual(request.mock.callCount(), 1);
        assert.strictEqual(
            (request.mock.calls[0].arguments[0] as { url: string }).url,
            'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/app.zyno.talk/tracks/production/releases'
        );
    });

    test('removes the version-code prefix from a generated published release name', async t => {
        t.mock.method(google.auth.GoogleAuth.prototype, 'request', async () => ({
            data: {
                releases: [
                    {
                        releaseName: '314284018 (26.712.549)',
                        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_PUBLISHED',
                        activeArtifacts: [{ versionCode: 314284018 }]
                    }
                ]
            }
        }));
        const lookup = createGooglePlayLookup();

        const result = await lookup.lookupGooglePlay('app.zyno.talk');

        assert.strictEqual(result?.version, '26.712.549');
    });
});

function createGooglePlayLookup(): StoreLookupService {
    return new StoreLookupService({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '{}' } as never, { warn: () => {}, error: () => {} } as never);
}

test('legacy backfill recovers a delayed policy and moves its deadline to the newest store version', () => {
    const policy = inferLegacyNativeUpdatePolicy(new Date('2026-05-15T12:00:00.000Z'), [
        {
            id: 'old',
            channelId: CHANNEL_TRACKED,
            platform: 'ios',
            firstDetectedAt: new Date('2026-05-01T12:00:00.000Z')
        },
        {
            id: 'new',
            channelId: CHANNEL_TRACKED,
            platform: 'ios',
            firstDetectedAt: new Date('2026-07-12T12:00:00.000Z')
        }
    ]);

    assert.strictEqual(policy.mode, 'after-days');
    assert.strictEqual(policy.afterDays, 14);
    assert.strictEqual(policy.latestStoreVersionId, 'new');
    assert.strictEqual(policy.latestRequiredAt?.toISOString(), '2026-07-26T12:00:00.000Z');
});

test('legacy backfill anchors an immediate policy to a newer store version detection', () => {
    const policy = inferLegacyNativeUpdatePolicy(new Date('2026-05-15T12:00:01.000Z'), [
        {
            id: 'new',
            channelId: CHANNEL_TRACKED,
            platform: 'ios',
            firstDetectedAt: new Date('2026-07-12T12:00:00.000Z')
        }
    ]);

    assert.strictEqual(policy.mode, 'immediate');
    assert.strictEqual(policy.afterDays, null);
    assert.strictEqual(policy.latestRequiredAt?.toISOString(), '2026-07-12T12:00:00.000Z');
});

class StubLookup {
    appleVersion: string | null = '1.0.0';
    androidVersion: string | null = null;
    appleCalls = 0;
    androidCalls = 0;

    async lookupApple(_bundleId: string): Promise<IStoreVersionLookupResult | null> {
        this.appleCalls++;
        return this.appleVersion ? { version: this.appleVersion, storeUrl: null } : null;
    }
    async lookupGooglePlay(_packageName: string): Promise<IStoreVersionLookupResult | null> {
        this.androidCalls++;
        return this.androidVersion ? { version: this.androidVersion, storeUrl: null } : null;
    }
    isAndroidConfigured(): boolean {
        return this.androidVersion !== null;
    }
}

describe('store versions', () => {
    let facade: ReturnType<typeof TestingHelpers.createTestingFacade>;
    let gitlab: { port: number; close: () => Promise<void> };
    let stub: StubLookup;
    let job: StoreVersionPollJob;

    before(async () => {
        gitlab = await startMockGitLab();
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        mockGitLabState.membershipAccessLevel = 20;

        facade = TestingHelpers.createTestingFacade(CoreAppOptions, {
            enableDatabase: true,
            // This suite verifies transaction-lock behavior with concurrent callers,
            // which requires separate MySQL transactions instead of shared savepoints.
            useSavepoints: false,
            databasePrefix: 'mus_storever'
        });
        await facade.start();

        await seedBase(gitlab.port);

        stub = new StubLookup();
        job = new StoreVersionPollJob(
            { STORE_VERSION_POLL_INTERVAL_MS: 60_000 } as never,
            stub as unknown as StoreLookupService,
            { error: () => {}, warn: () => {}, info: () => {} } as never
        );
    });

    after(async () => {
        await gitlab.close();
    });

    test('first poll inserts a storeVersion row for a tracked channel', async () => {
        stub.appleVersion = '1.0.0';
        await job.run();

        const rows = await StoreVersionEntity.query().filter({ channelId: CHANNEL_TRACKED, platform: 'ios' }).find();
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].version, '1.0.0');
        assert.strictEqual(rows[0].storeIdentifier, 'com.example.tracked');
        assert.strictEqual(
            rows[0].nativeUpdateRequiredAt?.getTime(),
            rows[0].firstDetectedAt.getTime() + 14 * 86_400_000,
            'the configured delay should be anchored to first detection'
        );
    });

    test('re-polling same version does not insert a duplicate', async () => {
        stub.appleVersion = '1.0.0';
        await job.run();

        const count = await StoreVersionEntity.query().filter({ channelId: CHANNEL_TRACKED, platform: 'ios' }).count();
        assert.strictEqual(count, 1);
    });

    test('a different version inserts a new history row with later firstDetectedAt', async () => {
        const previousLatest = await StoreVersionEntity.query()
            .filter({ channelId: CHANNEL_TRACKED, platform: 'ios' })
            .orderBy('firstDetectedAt', 'desc')
            .findOne();

        await new Promise(r => setTimeout(r, 1100));
        stub.appleVersion = '1.1.0';
        await job.run();

        const rows = await StoreVersionEntity.query()
            .filter({ channelId: CHANNEL_TRACKED, platform: 'ios' })
            .orderBy('firstDetectedAt', 'desc')
            .find();
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].version, '1.1.0');
        assert.ok(
            rows[0].firstDetectedAt.getTime() > previousLatest.firstDetectedAt.getTime(),
            'firstDetectedAt of new row should be greater than previous'
        );
        assert.strictEqual(
            rows[0].nativeUpdateRequiredAt?.getTime(),
            rows[0].firstDetectedAt.getTime() + 14 * 86_400_000,
            'a newly detected version should get a fresh deadline'
        );
    });

    test('GET /latest returns the most recent detected version', async () => {
        const jwt = await makeUserJwt();
        const resp = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${CHANNEL_TRACKED}/store-versions/latest?platform=ios`).header(
                'authorization',
                `Bearer ${jwt}`
            )
        );
        assert.strictEqual(resp.statusCode, 200);
        const latest = (resp.json as { latest: { version: string; firstDetectedAt: string } | null }).latest;
        assert.ok(latest);
        assert.strictEqual(latest.version, '1.1.0');
    });

    test('GET /latest returns null for a platform with no rows', async () => {
        const jwt = await makeUserJwt();
        const resp = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${CHANNEL_TRACKED}/store-versions/latest?platform=android`).header(
                'authorization',
                `Bearer ${jwt}`
            )
        );
        assert.strictEqual(resp.statusCode, 200);
        assert.deepStrictEqual(resp.json, { latest: null });
    });

    test('channel with iosTrackingEnabled=false is skipped', async () => {
        const callsBefore = stub.appleCalls;
        stub.appleVersion = '2.0.0';
        await job.run();

        const disabledRows = await StoreVersionEntity.query().filter({ channelId: CHANNEL_DISABLED }).count();
        assert.strictEqual(disabledRows, 0, 'disabled channel must have no rows');
        // Tracked channel still gets one extra apple call; disabled channel adds zero.
        assert.strictEqual(stub.appleCalls, callsBefore + 1);
    });

    test('channel with tracking enabled but no bundleId is skipped', async () => {
        // Re-config the disabled channel: enable tracking but null bundleId.
        const channel = await ChannelEntity.query().filter({ id: CHANNEL_DISABLED }).findOne();
        channel.iosTrackingEnabled = true;
        channel.iosBundleId = null;
        await channel.save();

        const before = stub.appleCalls;
        await job.run();

        const rows = await StoreVersionEntity.query().filter({ channelId: CHANNEL_DISABLED }).count();
        assert.strictEqual(rows, 0);
        assert.strictEqual(stub.appleCalls, before + 1, 'only tracked channel should hit apple');
    });

    test('changing bundle ID creates a new detection even when the store version is unchanged', async () => {
        const channel = await ChannelEntity.query().filter({ id: CHANNEL_TRACKED }).findOne();
        const previous = await StoreVersionEntity.query()
            .filter({ channelId: CHANNEL_TRACKED, platform: 'ios' })
            .sort({ firstDetectedAt: 'desc', id: 'desc' })
            .findOne();
        channel.iosBundleId = 'com.example.replacement';
        await channel.save();

        stub.appleVersion = previous.version;
        await job.run();

        const latest = await StoreVersionEntity.query()
            .filter({ channelId: CHANNEL_TRACKED, platform: 'ios', storeIdentifier: 'com.example.replacement' })
            .sort({ firstDetectedAt: 'desc', id: 'desc' })
            .findOne();
        assert.strictEqual(latest.version, previous.version);
        assert.notStrictEqual(latest.id, previous.id);
        assert.ok(latest.firstDetectedAt.getTime() >= previous.firstDetectedAt.getTime());
    });

    test('concurrent detections serialize without creating duplicate rows', async () => {
        const channel = await ChannelEntity.query().filter({ id: CHANNEL_TRACKED }).findOne();
        const storeIdentifier = channel.iosBundleId!;
        const result = { version: 'concurrent-version', storeUrl: null };

        await Promise.all([
            recordDetectedStoreVersion(channel, 'ios', storeIdentifier, result),
            recordDetectedStoreVersion(channel, 'ios', storeIdentifier, result)
        ]);

        const count = await StoreVersionEntity.query()
            .filter({ channelId: CHANNEL_TRACKED, platform: 'ios', storeIdentifier, version: result.version })
            .count();
        assert.strictEqual(count, 1);
    });

    test('a lookup result is discarded if the bundle ID changes before it is recorded', async () => {
        const channel = await ChannelEntity.query().filter({ id: CHANNEL_TRACKED }).findOne();
        const staleStoreIdentifier = channel.iosBundleId!;
        channel.iosBundleId = 'com.example.changed-again';
        await channel.save();

        const recorded = await recordDetectedStoreVersion(channel, 'ios', staleStoreIdentifier, {
            version: 'stale-version',
            storeUrl: 'https://example.invalid/stale'
        });

        assert.strictEqual(recorded, null);
        const staleCount = await StoreVersionEntity.query()
            .filter({ channelId: CHANNEL_TRACKED, platform: 'ios', storeIdentifier: staleStoreIdentifier, version: 'stale-version' })
            .count();
        assert.strictEqual(staleCount, 0);
        const freshChannel = await ChannelEntity.query().filter({ id: CHANNEL_TRACKED }).findOne();
        assert.notStrictEqual(freshChannel.iosStoreUrl, 'https://example.invalid/stale');
    });

    test('native update policy round-trips and changing its delay recalculates the latest store version', async () => {
        const previousAccess = mockGitLabState.membershipAccessLevel;
        mockGitLabState.membershipAccessLevel = 40; // maintainer — required for create/update
        try {
            const jwt = await makeUserJwt();
            const createResp = await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels`).header('authorization', `Bearer ${jwt}`).json({
                    name: 'native-required-roundtrip',
                    branchName: 'native-required-roundtrip',
                    iosNativeUpdateMode: 'after-days',
                    iosNativeUpdateAfterDays: 14
                })
            );
            assert.strictEqual(createResp.statusCode, 200);
            const created = createResp.json as {
                id: string;
                iosNativeUpdateMode: string;
                iosNativeUpdateAfterDays: number | null;
                androidNativeUpdateMode: string;
            };
            assert.strictEqual(created.iosNativeUpdateMode, 'after-days');
            assert.strictEqual(created.iosNativeUpdateAfterDays, 14);
            assert.strictEqual(created.androidNativeUpdateMode, 'none');

            const showResp = await facade.request(
                HttpRequest.GET(`/api/apps/${APP_ID}/channels/${created.id}`).header('authorization', `Bearer ${jwt}`)
            );
            assert.strictEqual(showResp.statusCode, 200);
            const fetched = showResp.json as { iosNativeUpdateMode: string; iosNativeUpdateAfterDays: number | null };
            assert.strictEqual(fetched.iosNativeUpdateMode, 'after-days');
            assert.strictEqual(fetched.iosNativeUpdateAfterDays, 14);

            const firstDetectedAt = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
            const storeVersion = await createPersistedEntity(StoreVersionEntity, {
                id: uuid(),
                appId: APP_ID,
                channelId: created.id,
                platform: 'ios',
                version: '3.4.1',
                firstDetectedAt,
                nativeUpdateRequiredAt: new Date(firstDetectedAt.getTime() + 14 * 86_400_000)
            });
            const putResp = await facade.request(
                HttpRequest.PUT(`/api/apps/${APP_ID}/channels/${created.id}`).header('authorization', `Bearer ${jwt}`).json({
                    iosNativeUpdateMode: 'after-days',
                    iosNativeUpdateAfterDays: 7
                })
            );
            assert.strictEqual(putResp.statusCode, 200);
            const updated = putResp.json as {
                iosNativeUpdateMode: string;
                iosNativeUpdateAfterDays: number | null;
            };
            assert.strictEqual(updated.iosNativeUpdateMode, 'after-days');
            assert.strictEqual(updated.iosNativeUpdateAfterDays, 7);
            const recalculated = await StoreVersionEntity.query().filter({ id: storeVersion.id }).findOne();
            assert.strictEqual(recalculated.nativeUpdateRequiredAt?.toISOString(), new Date(Date.UTC(2026, 5, 8, 12, 0, 0)).toISOString());

            const clearResp = await facade.request(
                HttpRequest.PUT(`/api/apps/${APP_ID}/channels/${created.id}`)
                    .header('authorization', `Bearer ${jwt}`)
                    .json({ iosNativeUpdateMode: 'none' })
            );
            assert.strictEqual(clearResp.statusCode, 200);
            const cleared = clearResp.json as {
                iosNativeUpdateMode: string;
                iosNativeUpdateAfterDays: number | null;
            };
            assert.strictEqual(cleared.iosNativeUpdateMode, 'none');
            assert.strictEqual(cleared.iosNativeUpdateAfterDays, null);
            const clearedStoreVersion = await StoreVersionEntity.query().filter({ id: storeVersion.id }).findOne();
            assert.strictEqual(clearedStoreVersion.nativeUpdateRequiredAt, null);
        } finally {
            mockGitLabState.membershipAccessLevel = previousAccess;
        }
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
        name: 'StoreVersion Test App',
        vcsId: ZERO_ID,
        projectPath: 'group/storever-test',
        vcsProjectId: TEST_VCS_PROJECT_ID,
        createdAt: new Date(),
        deletedAt: null
    });

    await createPersistedEntity(ChannelEntity, {
        id: CHANNEL_TRACKED,
        appId: APP_ID,
        name: 'production',
        branchName: 'main',
        iosBundleId: 'com.example.tracked',
        androidPackageName: null,
        iosTrackingEnabled: true,
        androidTrackingEnabled: false,
        iosNativeUpdateMode: 'after-days',
        iosNativeUpdateAfterDays: 14,
        stagingMembers: [],
        canaryMembers: [],
        createdAt: new Date(),
        deletedAt: null
    });

    await createPersistedEntity(ChannelEntity, {
        id: CHANNEL_DISABLED,
        appId: APP_ID,
        name: 'staging',
        branchName: 'staging',
        iosBundleId: 'com.example.disabled',
        androidPackageName: null,
        iosTrackingEnabled: false,
        androidTrackingEnabled: false,
        stagingMembers: [],
        canaryMembers: [],
        createdAt: new Date(),
        deletedAt: null
    });
}

async function makeUserJwt(): Promise<string> {
    const id = uuid();
    await createPersistedEntity(UserEntity, {
        id,
        vcsId: ZERO_ID,
        vcsUserId: id,
        name: 'storever-test-user',
        isAdmin: false,
        createdAt: new Date(),
        lastLoginAt: new Date(),
        vcsSession: {
            accessToken: 't',
            expiresAt: Date.now() + 3600_000,
            refreshToken: 'r',
            redirectUri: 'http://localhost'
        }
    });
    return JWT.generate({ subject: id });
}
