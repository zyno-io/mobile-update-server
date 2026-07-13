import '../shared/setup';
import { HttpRequest } from '@zyno-io/ts-server-foundation';
import { createPersistedEntity, TestingHelpers } from '@zyno-io/ts-server-foundation';
import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { CoreAppOptions } from '../../src/app';
import { AppEntity } from '../../src/entities/App.entity';
import { ChannelEntity } from '../../src/entities/Channel.entity';
import { UpdateEntity } from '../../src/entities/Update.entity';
import { VcsIntegrationEntity } from '../../src/entities/VcsIntegration.entity';
import { mockGitLabState, startMockGitLab, TEST_CI_TOKEN, TEST_VCS_PROJECT_ID, ZERO_ID } from '../shared/setup';

const APP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CHANNEL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const APP_OTHER_PROJECT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_CHANNEL_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

describe('upload (CI token enforcement)', () => {
    let facade: ReturnType<typeof TestingHelpers.createTestingFacade>;
    let gitlab: { port: number; close: () => Promise<void> };

    before(async () => {
        gitlab = await startMockGitLab();

        facade = TestingHelpers.createTestingFacade(CoreAppOptions, {
            enableDatabase: true,
            databasePrefix: 'mus_upload'
        });
        await facade.start();

        await seedBase(gitlab.port);
    });

    after(async () => {
        await gitlab.close();
    });

    test('create update with valid CI token (project_id matches) → 200', async () => {
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        const response = await facade.request(createUpdateRequest(APP_ID, CHANNEL_ID, TEST_CI_TOKEN));
        assert.strictEqual(response.statusCode, 200);
        const body = response.json as { id: string; status: string };
        assert.strictEqual(body.status, 'draft');

        const stored = await UpdateEntity.query().filter({ id: body.id }).findOneOrUndefined();
        assert.deepStrictEqual(stored?.expoConfigJson, { name: 'Test' });
        assert.deepStrictEqual(stored?.metadataJson, { version: 0 });
    });

    test('create update with unknown CI token → 401', async () => {
        const response = await facade.request(createUpdateRequest(APP_ID, CHANNEL_ID, 'not-a-real-token'));
        assert.strictEqual(response.statusCode, 401);
    });

    test('create update where job project_id != app.vcsProjectId → 401', async () => {
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID; // mock returns project_id=1
        // App APP_OTHER_PROJECT_ID has vcsProjectId=999 — should reject
        const response = await facade.request(createUpdateRequest(APP_OTHER_PROJECT_ID, OTHER_CHANNEL_ID, TEST_CI_TOKEN));
        assert.strictEqual(response.statusCode, 401);
    });

    test('create update where job ref != channel branch → 401', async () => {
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        mockGitLabState.jobRef = 'feature/not-production';
        const response = await facade.request(createUpdateRequest(APP_ID, CHANNEL_ID, TEST_CI_TOKEN));
        assert.strictEqual(response.statusCode, 401);
        mockGitLabState.jobRef = 'main';
    });

    test('finalize with different CI token than the draft → 401', async () => {
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        const createResponse = await facade.request(createUpdateRequest(APP_ID, CHANNEL_ID, TEST_CI_TOKEN));
        const update = createResponse.json as { id: string };

        // verify ciTokenHash was stored
        const stored = await UpdateEntity.query().filter({ id: update.id }).findOneOrUndefined();
        assert.ok(stored, 'update should exist');
        assert.ok(stored.ciTokenHash, 'ciTokenHash should be set');

        // try to finalize with a *different* bearer token — even though it'd be valid for a fresh /api/v4/job call,
        // the UpdateCiTokenMiddleware compares against the stored hash from the original create call
        const finalizeResponse = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${update.id}/finalize`).header(
                'authorization',
                `Bearer different-token`
            )
        );
        assert.strictEqual(finalizeResponse.statusCode, 401);
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
        name: 'Upload Test App',
        vcsId: ZERO_ID,
        projectPath: 'group/upload-test',
        vcsProjectId: TEST_VCS_PROJECT_ID,
        createdAt: new Date(),
        deletedAt: null
    });

    await createPersistedEntity(AppEntity, {
        id: APP_OTHER_PROJECT_ID,
        name: 'Other Project App',
        vcsId: ZERO_ID,
        projectPath: 'group/other',
        vcsProjectId: 999, // different from mock GitLab's job project_id
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
        id: OTHER_CHANNEL_ID,
        appId: APP_OTHER_PROJECT_ID,
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

function createUpdateRequest(appId: string, channelId: string, token: string) {
    return HttpRequest.POST(`/api/apps/${appId}/channels/${channelId}/updates`)
        .header('authorization', `Bearer ${token}`)
        .json({
            runtimeVersion: '1.0.0',
            platform: 'ios',
            expoConfig: { name: 'Test' },
            metadata: { version: 0 }
        });
}
