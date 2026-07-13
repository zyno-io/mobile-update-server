import '../shared/setup';
import { HttpRequest } from '@zyno-io/ts-server-foundation';
import { uuid } from '@zyno-io/ts-server-foundation';
import { createPersistedEntity, JWT, TestingHelpers, uuid7 } from '@zyno-io/ts-server-foundation';
import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { CoreAppOptions } from '../../src/app';
import { AppEntity } from '../../src/entities/App.entity';
import { ChannelEntity } from '../../src/entities/Channel.entity';
import { UpdateEntity } from '../../src/entities/Update.entity';
import { UserEntity } from '../../src/entities/User.entity';
import { VcsIntegrationEntity } from '../../src/entities/VcsIntegration.entity';
import { mockGitLabState, startMockGitLab, ZERO_ID } from '../shared/setup';

const APP_ID = '11111111-2222-3333-4444-555555555555';
const APP_OTHER_PROJECT = '11111111-2222-3333-4444-555555555556';
const CHANNEL_ID = '22222222-3333-4444-5555-666666666666';
const ANOTHER_CHANNEL = '22222222-3333-4444-5555-666666666667';
const VCS_PROJECT_ID = 1;
const OTHER_VCS_PROJECT_ID = 2;

describe('permissions (GitLab project membership)', () => {
    let facade: ReturnType<typeof TestingHelpers.createTestingFacade>;
    let gitlab: { port: number; close: () => Promise<void> };

    before(async () => {
        gitlab = await startMockGitLab();

        facade = TestingHelpers.createTestingFacade(CoreAppOptions, {
            enableDatabase: true,
            databasePrefix: 'mus_perms'
        });
        await facade.start();

        await seedBase(gitlab.port);
    });

    after(async () => {
        await gitlab.close();
    });

    test('reporter (access_level=20) can read, but cannot promote or edit rollout cohorts', async () => {
        mockGitLabState.membershipAccessLevel = 20;
        const { jwt } = await makeUser('reporter');

        const showResp = await facade.request(HttpRequest.GET(`/api/apps/${APP_ID}`).header('authorization', `Bearer ${jwt}`));
        assert.strictEqual(showResp.statusCode, 200, 'reporter should see app');

        const update = await makeCanaryUpdate();
        const promoteResp = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${update.id}/promote`).header('authorization', `Bearer ${jwt}`)
        );
        assert.strictEqual(promoteResp.statusCode, 403, 'reporter must not promote');

        const canaryResp = await facade.request(
            HttpRequest.PUT(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/canary-members`)
                .header('authorization', `Bearer ${jwt}`)
                .json({ canaryMembers: [{ type: 'device', id: 'x' }] })
        );
        assert.strictEqual(canaryResp.statusCode, 403, 'reporter must not edit canary list');

        const stagingResp = await facade.request(
            HttpRequest.PUT(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/staging-members`)
                .header('authorization', `Bearer ${jwt}`)
                .json({ stagingMembers: [{ type: 'device', id: 'x' }] })
        );
        assert.strictEqual(stagingResp.statusCode, 403, 'reporter must not edit staging list');
    });

    test('developer (access_level=30) can promote + edit rollout cohorts, but not create/delete channels', async () => {
        mockGitLabState.membershipAccessLevel = 30;
        const { jwt } = await makeUser('developer');

        const update = await makeCanaryUpdate();
        const promoteResp = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${update.id}/promote`).header('authorization', `Bearer ${jwt}`)
        );
        assert.strictEqual(promoteResp.statusCode, 200, 'developer should be able to promote');

        const canaryResp = await facade.request(
            HttpRequest.PUT(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/canary-members`)
                .header('authorization', `Bearer ${jwt}`)
                .json({
                    canaryMembers: [{ type: 'device', id: 'dev1', comment: 'beta tester' }]
                })
        );
        assert.strictEqual(canaryResp.statusCode, 200, 'developer should edit canary list');

        const stagingResp = await facade.request(
            HttpRequest.PUT(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/staging-members`)
                .header('authorization', `Bearer ${jwt}`)
                .json({ stagingMembers: [{ type: 'device', id: 'dev2' }] })
        );
        assert.strictEqual(stagingResp.statusCode, 200, 'developer should edit staging list');

        const createChannelResp = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels`).header('authorization', `Bearer ${jwt}`).json({ name: 'staging-by-developer' })
        );
        assert.strictEqual(createChannelResp.statusCode, 403, 'developer must not create channels');
    });

    test('maintainer (access_level=40) can create/delete channels', async () => {
        mockGitLabState.membershipAccessLevel = 40;
        const { jwt } = await makeUser('maintainer');

        const createChannelResp = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels`).header('authorization', `Bearer ${jwt}`).json({ name: 'staging-by-maintainer' })
        );
        assert.strictEqual(createChannelResp.statusCode, 200, 'maintainer should create channels');

        const created = createChannelResp.json as { id: string };
        const deleteResp = await facade.request(
            HttpRequest.DELETE(`/api/apps/${APP_ID}/channels/${created.id}`).header('authorization', `Bearer ${jwt}`)
        );
        assert.strictEqual(deleteResp.statusCode, 200, 'maintainer should delete channels');
    });

    test('user with no GitLab membership → 403 on app reads', async () => {
        mockGitLabState.membershipAccessLevel = 0;
        const { jwt } = await makeUser('outsider');

        const showResp = await facade.request(HttpRequest.GET(`/api/apps/${APP_ID}`).header('authorization', `Bearer ${jwt}`));
        assert.strictEqual(showResp.statusCode, 403);
    });

    test('app index returns only apps the user has access to', async () => {
        mockGitLabState.membershipAccessLevel = 30;
        const { jwt } = await makeUser('filtering-user');

        const indexResp = await facade.request(HttpRequest.GET('/api/apps').header('authorization', `Bearer ${jwt}`));
        assert.strictEqual(indexResp.statusCode, 200);

        // mock gitlab returns the same access_level for any project lookup, so this user
        // should see both APP_ID and APP_OTHER_PROJECT. With membershipAccessLevel=0
        // they would see neither. Verify visibility tracks membership.
        const apps = indexResp.json as { id: string; role: string }[];
        assert.ok(apps.length >= 2, `expected ≥2 apps, got ${apps.length}`);
        assert.ok(
            apps.every(a => a.role === 'developer'),
            'all apps should report developer role'
        );
    });

    test('app creation requires Maintainer+ on the target GitLab project', async () => {
        mockGitLabState.membershipAccessLevel = 30; // developer

        const { jwt } = await makeUser('would-be-app-creator');

        const createResp = await facade.request(
            HttpRequest.POST('/api/apps').header('authorization', `Bearer ${jwt}`).json({
                name: 'New App',
                vcsId: ZERO_ID,
                projectPath: 'group/new',
                vcsProjectId: 99
            })
        );
        assert.strictEqual(createResp.statusCode, 403, 'developer must not create apps');

        mockGitLabState.membershipAccessLevel = 40; // maintainer
        const { jwt: maintainerJwt } = await makeUser('actual-creator');

        const createResp2 = await facade.request(
            HttpRequest.POST('/api/apps').header('authorization', `Bearer ${maintainerJwt}`).json({
                name: 'New App',
                vcsId: ZERO_ID,
                projectPath: 'group/new',
                vcsProjectId: 99
            })
        );
        assert.strictEqual(createResp2.statusCode, 200, 'maintainer should create apps');
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
        name: 'Permission Test App',
        vcsId: ZERO_ID,
        projectPath: 'group/perm-test',
        vcsProjectId: VCS_PROJECT_ID,
        createdAt: new Date(),
        deletedAt: null
    });

    await createPersistedEntity(AppEntity, {
        id: APP_OTHER_PROJECT,
        name: 'Other Project App',
        vcsId: ZERO_ID,
        projectPath: 'group/other',
        vcsProjectId: OTHER_VCS_PROJECT_ID,
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
        id: ANOTHER_CHANNEL,
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

async function makeUser(name: string, vcsUserId = name): Promise<{ user: UserEntity; jwt: string }> {
    const id = uuid();
    const user = await createPersistedEntity(UserEntity, {
        id,
        vcsId: ZERO_ID,
        vcsUserId,
        name,
        isAdmin: false,
        createdAt: new Date(),
        lastLoginAt: new Date(),
        vcsSession: {
            accessToken: 'fake-token',
            expiresAt: Date.now() + 3600_000,
            refreshToken: 'fake-refresh',
            redirectUri: 'http://localhost'
        }
    });
    const jwt = await JWT.generate({ subject: id });
    return { user, jwt };
}

async function makeCanaryUpdate(channelId = CHANNEL_ID, appId = APP_ID): Promise<UpdateEntity> {
    return createPersistedEntity(UpdateEntity, {
        id: uuid7(),
        appId,
        channelId,
        platform: 'ios',
        runtimeVersion: '1.0.0',
        status: 'canary',
        commitHash: 'a'.repeat(40),
        commitSubject: 'canary',
        commitAuthor: 'tester',
        ciJobId: '1',
        ciTokenHash: null,
        expoConfigJson: {},
        metadataJson: {},
        createdAt: new Date(),
        releasedAt: null,
        promotedById: null
    });
}
