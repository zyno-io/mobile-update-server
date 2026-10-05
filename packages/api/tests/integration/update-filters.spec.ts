import '../shared/setup';
import { HttpRequest } from '@zyno-io/ts-server-foundation';
import { uuid } from '@zyno-io/ts-server-foundation';
import { createPersistedEntity, JWT, TestingHelpers } from '@zyno-io/ts-server-foundation';
import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { CoreAppOptions } from '../../src/app';
import { AppEntity } from '../../src/entities/App.entity';
import { BinaryBuildEntity } from '../../src/entities/BinaryBuild.entity';
import { ChannelEntity } from '../../src/entities/Channel.entity';
import { UpdateEntity, UpdateStatus } from '../../src/entities/Update.entity';
import { TargetPlatform } from '../../src/entities/UpdateAsset.entity';
import { UserEntity } from '../../src/entities/User.entity';
import { VcsIntegrationEntity } from '../../src/entities/VcsIntegration.entity';
import { mockGitLabState, startMockGitLab, TEST_VCS_PROJECT_ID, ZERO_ID } from '../shared/setup';

const APP_ID = '22222222-2222-2222-2222-222222222222';
const CHANNEL_ID = '23232323-2323-2323-2323-232323232323';

// Fingerprint-policy updates are identified by BinaryBuild.fingerprint === Update.runtimeVersion.
// iOS 2.0.0 was built twice (a rebuild changed the fingerprint), so it maps to TWO fingerprints.
// AppVersion-policy updates instead use the binary version itself as their runtime version.
const IOS_V2_FP_A = 'fp-ios-2.0.0-a';
const IOS_V2_FP_B = 'fp-ios-2.0.0-b';
const IOS_V1_FP = 'fp-ios-1.0.0';
const IOS_V1_APP_VERSION = '1.0.0';
const ANDROID_V2_FP = 'fp-android-2.0.0';

// No binary build has this runtime version (e.g. a build predating this server). It must survive
// an unfiltered list but never match a version filter.
const ORPHAN_RUNTIME = '9.9.9-orphan';

describe('update filters + binary versions', () => {
    let facade: ReturnType<typeof TestingHelpers.createTestingFacade>;
    let gitlab: { port: number; close: () => Promise<void> };

    before(async () => {
        gitlab = await startMockGitLab();
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        mockGitLabState.membershipAccessLevel = 20; // reporter — read is enough

        facade = TestingHelpers.createTestingFacade(CoreAppOptions, {
            enableDatabase: true,
            databasePrefix: 'mus_updatefilters'
        });
        await facade.start();

        await seed(gitlab.port);
    });

    after(async () => {
        try {
            await facade?.stop();
        } finally {
            await gitlab?.close();
        }
    });

    test('versions lists distinct binary versions, newest build first', async () => {
        const versions = await getVersions('ios');
        // 2.0.0 was built twice but appears once; 3.0.0-beta is newest despite the lower semver.
        assert.deepStrictEqual(versions, ['3.0.0-beta', '2.0.0', '1.0.0']);
    });

    test('versions is scoped to one platform', async () => {
        const versions = await getVersions('android');
        assert.deepStrictEqual(versions, ['2.0.0']);
    });

    test('versions rejects a missing or invalid platform → 400', async () => {
        const jwt = await makeUserJwt();
        const missing = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/binary-builds/versions`).header('authorization', `Bearer ${jwt}`)
        );
        assert.strictEqual(missing.statusCode, 400);

        const invalid = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/binary-builds/versions?platform=web`).header('authorization', `Bearer ${jwt}`)
        );
        assert.strictEqual(invalid.statusCode, 400);
    });

    test('unfiltered index returns every non-draft update on both platforms', async () => {
        const updates = await getUpdates();
        const runtimes = updates.map(u => u.runtimeVersion).sort();
        assert.deepStrictEqual(runtimes, [ANDROID_V2_FP, IOS_V1_APP_VERSION, IOS_V1_FP, IOS_V2_FP_A, IOS_V2_FP_B, ORPHAN_RUNTIME].sort());
        // The draft is never exposed.
        assert.ok(!updates.some(u => u.status === 'draft'));
    });

    test('platform filter narrows to that platform', async () => {
        const updates = await getUpdates({ platform: 'android' });
        assert.strictEqual(updates.length, 1);
        assert.strictEqual(updates[0].runtimeVersion, ANDROID_V2_FP);
    });

    test('binaryVersion filter matches every fingerprint of that version', async () => {
        const updates = await getUpdates({ platform: 'ios', binaryVersion: '2.0.0' });
        const runtimes = updates.map(u => u.runtimeVersion).sort();
        // Both the original build and the rebuild — not just one of them.
        assert.deepStrictEqual(runtimes, [IOS_V2_FP_A, IOS_V2_FP_B].sort());
    });

    test('binaryVersion filter matches appVersion and fingerprint runtime policies', async () => {
        const updates = await getUpdates({ platform: 'ios', binaryVersion: '1.0.0' });
        const runtimes = updates.map(u => u.runtimeVersion).sort();
        assert.deepStrictEqual(runtimes, [IOS_V1_APP_VERSION, IOS_V1_FP].sort());
    });

    test('binaryVersion with no matching builds returns [] rather than erroring', async () => {
        // Guards the `IN ()` empty-set case.
        const resp = await requestUpdates({ platform: 'ios', binaryVersion: '404.0.0' });
        assert.strictEqual(resp.statusCode, 200);
        assert.deepStrictEqual(resp.json, []);
    });

    test('a binary version with builds but no updates returns []', async () => {
        // 3.0.0-beta was built but nothing has shipped against its fingerprint yet.
        const updates = await getUpdates({ platform: 'ios', binaryVersion: '3.0.0-beta' });
        assert.deepStrictEqual(updates, []);
    });

    test('binaryVersion is per-platform: the same version on the other platform does not leak', async () => {
        const updates = await getUpdates({ platform: 'android', binaryVersion: '2.0.0' });
        assert.strictEqual(updates.length, 1);
        assert.strictEqual(updates[0].runtimeVersion, ANDROID_V2_FP);
    });

    test('binaryVersion without platform → 400', async () => {
        const resp = await requestUpdates({ binaryVersion: '2.0.0' });
        assert.strictEqual(resp.statusCode, 400);
    });

    async function requestUpdates(query: { platform?: string; binaryVersion?: string } = {}) {
        const jwt = await makeUserJwt();
        const qs = new URLSearchParams(query as Record<string, string>).toString();
        const url = `/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates${qs ? `?${qs}` : ''}`;
        return facade.request(HttpRequest.GET(url).header('authorization', `Bearer ${jwt}`));
    }

    async function getUpdates(query: { platform?: string; binaryVersion?: string } = {}) {
        const resp = await requestUpdates(query);
        assert.strictEqual(resp.statusCode, 200);
        return resp.json as { runtimeVersion: string; status: string }[];
    }

    async function getVersions(platform: TargetPlatform) {
        const jwt = await makeUserJwt();
        const resp = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/binary-builds/versions?platform=${platform}`).header(
                'authorization',
                `Bearer ${jwt}`
            )
        );
        assert.strictEqual(resp.statusCode, 200);
        return (resp.json as { versions: string[] }).versions;
    }
});

async function seed(gitlabPort: number) {
    await createPersistedEntity(VcsIntegrationEntity, {
        id: ZERO_ID,
        name: 'mock-gitlab',
        platform: 'gitlab',
        config: { url: `http://127.0.0.1:${gitlabPort}`, clientId: 'cid', clientSecret: 'csecret' },
        deletedAt: null
    });

    await createPersistedEntity(AppEntity, {
        id: APP_ID,
        name: 'Update Filter Test App',
        vcsId: ZERO_ID,
        projectPath: 'group/update-filters',
        vcsProjectId: TEST_VCS_PROJECT_ID,
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
        stagingMembers: [],
        canaryMembers: [],
        createdAt: new Date(),
        deletedAt: null
    });

    // "Latest" is by creation time, never by semver — so build 3.0.0-beta last to make it latest.
    let t = 0;
    const build = (platform: TargetPlatform, binaryVersion: string, fingerprint: string) =>
        createPersistedEntity(BinaryBuildEntity, {
            id: uuid(),
            appId: APP_ID,
            channelId: CHANNEL_ID,
            platform,
            binaryVersion,
            fingerprint,
            commitHash: `commit-${fingerprint}`,
            commitSubject: `build ${binaryVersion}`,
            commitAuthor: 'ci',
            ciJobId: `job-${++t}`,
            createdAt: new Date(1_700_000_000_000 + t * 60_000)
        });

    await build('ios', '1.0.0', IOS_V1_FP);
    await build('ios', '2.0.0', IOS_V2_FP_A);
    await build('ios', '2.0.0', IOS_V2_FP_B); // rebuild of the same version → second fingerprint
    await build('android', '2.0.0', ANDROID_V2_FP);
    await build('ios', '3.0.0-beta', 'fp-ios-3.0.0-beta'); // newest build, no updates against it

    let u = 0;
    const update = (platform: TargetPlatform, runtimeVersion: string, status: UpdateStatus) =>
        createPersistedEntity(UpdateEntity, {
            id: uuid(),
            appId: APP_ID,
            channelId: CHANNEL_ID,
            platform,
            runtimeVersion,
            otaVersion: `ota-${++u}`,
            status,
            commitHash: `commit-u${u}`,
            commitSubject: `update ${u}`,
            commitAuthor: 'ci',
            ciJobId: `job-u${u}`,
            ciTokenHash: null,
            expoConfigJson: null,
            metadataJson: null,
            createdAt: new Date(1_700_000_000_000 + u * 60_000),
            releasedAt: null,
            promotedById: null,
            supersededAt: null,
            supersededById: null
        });

    await update('ios', IOS_V1_FP, 'released');
    await update('ios', IOS_V1_APP_VERSION, 'released');
    await update('ios', IOS_V2_FP_A, 'released');
    await update('ios', IOS_V2_FP_B, 'staging');
    await update('ios', ORPHAN_RUNTIME, 'released');
    await update('android', ANDROID_V2_FP, 'released');
    await update('ios', IOS_V2_FP_A, 'draft'); // must never appear in the index
}

async function makeUserJwt(): Promise<string> {
    const id = uuid();
    await createPersistedEntity(UserEntity, {
        id,
        vcsId: ZERO_ID,
        vcsUserId: id,
        name: 'update-filter-test-user',
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
