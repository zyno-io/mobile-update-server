import '../shared/setup';
import { HttpRequest } from '@deepkit/http';
import { uuid } from '@deepkit/type';
import { createPersistedEntity, JWT, TestingHelpers } from '@zyno-io/dk-server-foundation';
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
import { IStoreVersionLookupResult, StoreLookupService } from '../../src/services/StoreLookup.service';
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
    return new StoreLookupService(
        { GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '{}' } as never,
        { warn: () => {}, error: () => {} } as never
    );
}

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

    test('nativeUpdateRequiredAt round-trips via POST/PUT/GET on Channels controller', async () => {
        const previousAccess = mockGitLabState.membershipAccessLevel;
        mockGitLabState.membershipAccessLevel = 40; // maintainer — required for create/update
        try {
            const jwt = await makeUserJwt();
            const requiredAt = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

            const createResp = await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels`).header('authorization', `Bearer ${jwt}`).json({
                    name: 'native-required-roundtrip',
                    branchName: 'native-required-roundtrip',
                    iosNativeUpdateRequiredAt: requiredAt.toISOString()
                })
            );
            assert.strictEqual(createResp.statusCode, 200);
            const created = createResp.json as {
                id: string;
                iosNativeUpdateRequiredAt: string | null;
                androidNativeUpdateRequiredAt: string | null;
            };
            assert.strictEqual(created.iosNativeUpdateRequiredAt, requiredAt.toISOString());
            assert.strictEqual(created.androidNativeUpdateRequiredAt, null);

            const showResp = await facade.request(
                HttpRequest.GET(`/api/apps/${APP_ID}/channels/${created.id}`).header('authorization', `Bearer ${jwt}`)
            );
            assert.strictEqual(showResp.statusCode, 200);
            const fetched = showResp.json as { iosNativeUpdateRequiredAt: string | null };
            assert.strictEqual(fetched.iosNativeUpdateRequiredAt, requiredAt.toISOString());

            const newRequiredAt = new Date(Date.UTC(2026, 6, 15, 0, 0, 0));
            const putResp = await facade.request(
                HttpRequest.PUT(`/api/apps/${APP_ID}/channels/${created.id}`).header('authorization', `Bearer ${jwt}`).json({
                    iosNativeUpdateRequiredAt: newRequiredAt.toISOString(),
                    androidNativeUpdateRequiredAt: newRequiredAt.toISOString()
                })
            );
            assert.strictEqual(putResp.statusCode, 200);
            const updated = putResp.json as {
                iosNativeUpdateRequiredAt: string | null;
                androidNativeUpdateRequiredAt: string | null;
            };
            assert.strictEqual(updated.iosNativeUpdateRequiredAt, newRequiredAt.toISOString());
            assert.strictEqual(updated.androidNativeUpdateRequiredAt, newRequiredAt.toISOString());

            const clearResp = await facade.request(
                HttpRequest.PUT(`/api/apps/${APP_ID}/channels/${created.id}`)
                    .header('authorization', `Bearer ${jwt}`)
                    .json({ iosNativeUpdateRequiredAt: null })
            );
            assert.strictEqual(clearResp.statusCode, 200);
            const cleared = clearResp.json as {
                iosNativeUpdateRequiredAt: string | null;
                androidNativeUpdateRequiredAt: string | null;
            };
            assert.strictEqual(cleared.iosNativeUpdateRequiredAt, null);
            assert.strictEqual(cleared.androidNativeUpdateRequiredAt, newRequiredAt.toISOString());
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
