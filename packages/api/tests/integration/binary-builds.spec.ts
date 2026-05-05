import '../shared/setup';
import { HttpRequest } from '@deepkit/http';
import { uuid } from '@deepkit/type';
import { createPersistedEntity, JWT, TestingHelpers } from '@zyno-io/dk-server-foundation';
import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { CoreAppOptions } from '../../src/app';
import { AppEntity } from '../../src/entities/App.entity';
import { BinaryBuildEntity } from '../../src/entities/BinaryBuild.entity';
import { ChannelEntity } from '../../src/entities/Channel.entity';
import { UserEntity } from '../../src/entities/User.entity';
import { VcsIntegrationEntity } from '../../src/entities/VcsIntegration.entity';
import { mockGitLabState, startMockGitLab, TEST_CI_TOKEN, TEST_VCS_PROJECT_ID, ZERO_ID } from '../shared/setup';

const APP_ID = '12121212-1212-1212-1212-121212121212';
const APP_OTHER_PROJECT = '13131313-1313-1313-1313-131313131313';
const CHANNEL_ID = '14141414-1414-1414-1414-141414141414';
const OTHER_CHANNEL = '15151515-1515-1515-1515-151515151515';

describe('binary builds', () => {
    let facade: ReturnType<typeof TestingHelpers.createTestingFacade>;
    let gitlab: { port: number; close: () => Promise<void> };

    before(async () => {
        gitlab = await startMockGitLab();
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        mockGitLabState.membershipAccessLevel = 20; // reporter — read is enough

        facade = TestingHelpers.createTestingFacade(CoreAppOptions, {
            enableDatabase: true,
            databasePrefix: 'mus_binbuilds'
        });
        await facade.start();

        await seedBase(gitlab.port);
    });

    after(async () => {
        await gitlab.close();
    });

    test('create rejects unknown CI token → 401', async () => {
        const resp = await facade.request(createRequest(APP_ID, CHANNEL_ID, { binaryVersion: '1.0.0', fingerprint: 'abc' }, 'bad-token'));
        assert.strictEqual(resp.statusCode, 401);
    });

    test('create rejects when CI job project_id != app.vcsProjectId → 401', async () => {
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID; // mock returns 1, app vcsProjectId is 999
        const resp = await facade.request(createRequest(APP_OTHER_PROJECT, OTHER_CHANNEL, { binaryVersion: '1.0.0', fingerprint: 'abc' }));
        assert.strictEqual(resp.statusCode, 401);
    });

    test('create rejects when CI job ref != channel branch → 401', async () => {
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        mockGitLabState.jobRef = 'feature/not-production';
        const resp = await facade.request(createRequest(APP_ID, CHANNEL_ID, { binaryVersion: '1.0.0', fingerprint: 'abc' }));
        assert.strictEqual(resp.statusCode, 401);
        mockGitLabState.jobRef = 'main';
    });

    test('create binary build → get latest returns it', async () => {
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        const createResp = await facade.request(createRequest(APP_ID, CHANNEL_ID, { binaryVersion: '1.0.0', fingerprint: 'fp-v1' }));
        assert.strictEqual(createResp.statusCode, 200);
        const created = createResp.json as { id: string; binaryVersion: string; fingerprint: string };
        assert.strictEqual(created.binaryVersion, '1.0.0');
        assert.strictEqual(created.fingerprint, 'fp-v1');

        const jwt = await makeUserJwt();
        const latestResp = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/binary-builds/latest`).header('authorization', `Bearer ${jwt}`)
        );
        assert.strictEqual(latestResp.statusCode, 200);
        const latest = (latestResp.json as { latest: { id: string } }).latest;
        assert.strictEqual(latest.id, created.id);
    });

    test('subsequent binary build supersedes the previous as latest', async () => {
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        await facade.request(createRequest(APP_ID, CHANNEL_ID, { binaryVersion: '1.1.0', fingerprint: 'fp-v2' }));
        const newest = await facade.request(createRequest(APP_ID, CHANNEL_ID, { binaryVersion: '1.2.0', fingerprint: 'fp-v3' }));
        const newestId = (newest.json as { id: string }).id;

        const jwt = await makeUserJwt();
        const latestResp = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/binary-builds/latest`).header('authorization', `Bearer ${jwt}`)
        );
        const latest = (latestResp.json as { latest: { id: string; binaryVersion: string; fingerprint: string } }).latest;
        assert.strictEqual(latest.id, newestId);
        assert.strictEqual(latest.binaryVersion, '1.2.0');
        assert.strictEqual(latest.fingerprint, 'fp-v3');
    });

    test('CI latest endpoint returns latest version + fingerprint JSON', async () => {
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        mockGitLabState.jobRef = 'main';

        const resp = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/binary-builds/latest-ci?platform=ios`).header(
                'authorization',
                `Bearer ${TEST_CI_TOKEN}`
            )
        );
        assert.strictEqual(resp.statusCode, 200);
        const latest = (resp.json as { latest: { binaryVersion: string; fingerprint: string } }).latest;
        assert.strictEqual(latest.binaryVersion, '1.2.0');
        assert.strictEqual(latest.fingerprint, 'fp-v3');
    });

    test('list endpoint returns binary builds newest-first', async () => {
        const jwt = await makeUserJwt();
        const resp = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/binary-builds`).header('authorization', `Bearer ${jwt}`)
        );
        assert.strictEqual(resp.statusCode, 200);
        const list = resp.json as { binaryVersion: string }[];
        assert.ok(list.length >= 3, `expected ≥3 builds, got ${list.length}`);
        assert.strictEqual(list[0].binaryVersion, '1.2.0');
        assert.strictEqual(list[1].binaryVersion, '1.1.0');
    });

    test('latest returns null when no binary builds exist for the channel', async () => {
        const emptyChannelId = '99000099-0099-0099-0099-009900990099';
        await createPersistedEntity(ChannelEntity, {
            id: emptyChannelId,
            appId: APP_ID,
            name: 'staging',
            branchName: 'staging',
            iosTrackingEnabled: false,
            androidTrackingEnabled: false,
            stagingMembers: [],
            canaryMembers: [],
            createdAt: new Date(),
            deletedAt: null
        });
        const orphanCount = await BinaryBuildEntity.query().filter({ channelId: emptyChannelId }).count();
        assert.strictEqual(orphanCount, 0);

        const jwt = await makeUserJwt();
        const resp = await facade.request(
            HttpRequest.GET(`/api/apps/${APP_ID}/channels/${emptyChannelId}/binary-builds/latest`).header('authorization', `Bearer ${jwt}`)
        );
        assert.strictEqual(resp.statusCode, 200);
        assert.deepStrictEqual(resp.json, { latest: null });
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
        name: 'BinaryBuild Test App',
        vcsId: ZERO_ID,
        projectPath: 'group/binbuild-test',
        vcsProjectId: TEST_VCS_PROJECT_ID,
        createdAt: new Date(),
        deletedAt: null
    });

    await createPersistedEntity(AppEntity, {
        id: APP_OTHER_PROJECT,
        name: 'Other App',
        vcsId: ZERO_ID,
        projectPath: 'group/other-binbuild',
        vcsProjectId: 999,
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

    await createPersistedEntity(ChannelEntity, {
        id: OTHER_CHANNEL,
        appId: APP_OTHER_PROJECT,
        name: 'production',
        branchName: 'main',
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
        name: 'binbuild-test-user',
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

function createRequest(
    appId: string,
    channelId: string,
    body: { platform?: 'ios' | 'android'; binaryVersion: string; fingerprint: string },
    token = TEST_CI_TOKEN
) {
    return HttpRequest.POST(`/api/apps/${appId}/channels/${channelId}/binary-builds`)
        .header('authorization', `Bearer ${token}`)
        .json({ platform: 'ios', ...body });
}
