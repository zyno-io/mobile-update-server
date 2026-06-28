import '../shared/setup';
import { HttpRequest } from '@deepkit/http';
import { createPersistedEntity, JWT, TestingHelpers } from '@zyno-io/dk-server-foundation';
import assert from 'node:assert';
import { after, before, describe, test } from 'node:test';

import { CoreAppOptions } from '../../src/app';
import { AppEntity } from '../../src/entities/App.entity';
import { ChannelEntity } from '../../src/entities/Channel.entity';
import { UpdateEntity } from '../../src/entities/Update.entity';
import { UpdateAssetEntity } from '../../src/entities/UpdateAsset.entity';
import { UserEntity } from '../../src/entities/User.entity';
import { VcsIntegrationEntity } from '../../src/entities/VcsIntegration.entity';
import { mockGitLabState, startMockGitLab, TEST_CI_TOKEN, TEST_VCS_PROJECT_ID, ZERO_ID } from '../shared/setup';

const APP_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CHANNEL_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const USER_ID = '99999999-9999-9999-9999-999999999999';

describe('update flow (draft → upload → finalize → promote → cancel)', () => {
    let facade: ReturnType<typeof TestingHelpers.createTestingFacade>;
    let gitlab: { port: number; close: () => Promise<void> };

    before(async () => {
        gitlab = await startMockGitLab();
        mockGitLabState.jobProjectId = TEST_VCS_PROJECT_ID;
        mockGitLabState.membershipAccessLevel = 30; // developer — can promote

        facade = TestingHelpers.createTestingFacade(CoreAppOptions, {
            enableDatabase: true,
            databasePrefix: 'mus_flow'
        });
        await facade.start();

        await seedBase(gitlab.port);
    });

    after(async () => {
        await gitlab.close();
    });

    test('create draft → upload ios launch + image asset → finalize → status=staging', async () => {
        const updateId = await createDraftUpdate(facade);

        const iosBundle = Buffer.from('ios bundle content for full-flow test');
        const sharedImage = Buffer.from('shared image bytes for full-flow test');

        for (const upload of [
            {
                key: 'bundles/ios.hbc',
                platform: 'ios' as const,
                isLaunchAsset: true,
                content: iosBundle,
                ext: 'hbc',
                type: 'application/javascript'
            },
            {
                key: 'assets/img-ios',
                platform: 'ios' as const,
                isLaunchAsset: false,
                content: sharedImage,
                ext: 'png',
                type: 'image/png'
            }
        ]) {
            const resp = await facade.request(uploadAsset(updateId, upload));
            assert.strictEqual(resp.statusCode, 200, `asset upload failed: ${resp.statusCode} ${resp.bodyString}`);
        }

        const finalizeResp = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/finalize`).header(
                'authorization',
                `Bearer ${TEST_CI_TOKEN}`
            )
        );
        assert.strictEqual(finalizeResp.statusCode, 200);
        const update = await UpdateEntity.query().filter({ id: updateId }).findOne();
        assert.strictEqual(update.status, 'staging');
        assert.strictEqual(update.ciTokenHash, null, 'token hash should be cleared after finalize');
    });

    test('finalize fails when no launch asset uploaded', async () => {
        const updateId = await createDraftUpdate(facade);

        const resp = await facade.request(
            uploadAsset(updateId, {
                key: 'assets/orphan.png',
                platform: 'all',
                isLaunchAsset: false,
                content: Buffer.from('orphan'),
                ext: 'png',
                type: 'image/png'
            })
        );
        assert.strictEqual(resp.statusCode, 200);

        const finalizeResp = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/finalize`).header(
                'authorization',
                `Bearer ${TEST_CI_TOKEN}`
            )
        );
        assert.strictEqual(finalizeResp.statusCode, 400);
    });

    test('identical content uploaded for ios + all shares the same s3 key (content-addressed)', async () => {
        const updateId = await createDraftUpdate(facade);

        const sameContent = Buffer.from('identical bytes');
        await facade.request(
            uploadAsset(updateId, {
                key: 'shared',
                platform: 'ios',
                isLaunchAsset: false,
                content: sameContent,
                ext: 'png',
                type: 'image/png'
            })
        );
        await facade.request(
            uploadAsset(updateId, {
                key: 'shared',
                platform: 'all',
                isLaunchAsset: false,
                content: sameContent,
                ext: 'png',
                type: 'image/png'
            })
        );

        const assets = await UpdateAssetEntity.query().filter({ updateId }).find();
        assert.strictEqual(assets.length, 2);
        assert.strictEqual(assets[0].sha256, assets[1].sha256, 'same content => same hash');
        assert.strictEqual(assets[0].s3Key, assets[1].s3Key, 'same content => same s3Key');
    });

    test('two concurrent uploads of (key, platform) → exactly one row, second fails 400', async () => {
        const updateId = await createDraftUpdate(facade);

        const content = Buffer.from('concurrent upload race test bytes');
        const upload = {
            key: 'shared-race-key',
            platform: 'all' as const,
            isLaunchAsset: false,
            content,
            ext: 'png',
            type: 'image/png'
        };

        const [a, b] = await Promise.all([facade.request(uploadAsset(updateId, upload)), facade.request(uploadAsset(updateId, upload))]);

        const statuses = [a.statusCode, b.statusCode].sort();
        assert.deepStrictEqual(statuses, [200, 400], `expected one 200 + one 400, got ${a.statusCode} + ${b.statusCode}`);

        const rows = await UpdateAssetEntity.query().filter({ updateId, key: 'shared-race-key', platform: 'all' }).find();
        assert.strictEqual(rows.length, 1, 'unique constraint must have prevented duplicate row');
    });

    test('promote staging → canary → released sets releasedAt + promotedById', async () => {
        const updateId = await createDraftUpdate(facade);
        await facade.request(
            uploadAsset(updateId, {
                key: 'bundles/ios.hbc',
                platform: 'ios',
                isLaunchAsset: true,
                content: Buffer.from('promote-test bundle'),
                ext: 'hbc',
                type: 'application/javascript'
            })
        );
        await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/finalize`).header(
                'authorization',
                `Bearer ${TEST_CI_TOKEN}`
            )
        );

        const userJwt = await JWT.generate({ subject: USER_ID });
        const promoteToCanary = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/promote`).header('authorization', `Bearer ${userJwt}`)
        );
        assert.strictEqual(promoteToCanary.statusCode, 200);
        assert.strictEqual((promoteToCanary.json as { status: string }).status, 'canary', 'first promote advances staging → canary');

        const promoteToReleased = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/promote`).header('authorization', `Bearer ${userJwt}`)
        );
        assert.strictEqual(promoteToReleased.statusCode, 200);

        const update = await UpdateEntity.query().filter({ id: updateId }).findOne();
        assert.strictEqual(update.status, 'released');
        assert.ok(update.releasedAt, 'releasedAt should be set');
        assert.strictEqual(update.promotedById, USER_ID);
    });

    test('promote with target=released skips canary tier from staging', async () => {
        const updateId = await createDraftUpdate(facade);
        await facade.request(
            uploadAsset(updateId, {
                key: 'bundles/ios-skip-canary.hbc',
                platform: 'ios',
                isLaunchAsset: true,
                content: Buffer.from('skip-canary bundle'),
                ext: 'hbc',
                type: 'application/javascript'
            })
        );
        await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/finalize`).header(
                'authorization',
                `Bearer ${TEST_CI_TOKEN}`
            )
        );

        const userJwt = await JWT.generate({ subject: USER_ID });
        const resp = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/promote`)
                .header('authorization', `Bearer ${userJwt}`)
                .json({ target: 'released' })
        );
        assert.strictEqual(resp.statusCode, 200);

        const update = await UpdateEntity.query().filter({ id: updateId }).findOne();
        assert.strictEqual(update.status, 'released');
        assert.strictEqual(update.promotedById, USER_ID);
    });

    test('CI promote without update id promotes current commit updates (target=released)', async () => {
        const originalSha = mockGitLabState.jobSha;
        mockGitLabState.jobSha = '1'.repeat(40);
        try {
            const updateId = await createDraftUpdate(facade);
            await facade.request(
                uploadAsset(updateId, {
                    key: 'bundles/ios-current-commit.hbc',
                    platform: 'ios',
                    isLaunchAsset: true,
                    content: Buffer.from('current-commit-promote-test bundle'),
                    ext: 'hbc',
                    type: 'application/javascript'
                })
            );
            await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/finalize`).header(
                    'authorization',
                    `Bearer ${TEST_CI_TOKEN}`
                )
            );

            const promoteResp = await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/promote-ci`)
                    .header('authorization', `Bearer ${TEST_CI_TOKEN}`)
                    .json({ target: 'released' })
            );
            assert.strictEqual(promoteResp.statusCode, 200);
            const promoted = promoteResp.json as Array<{ id: string }>;
            assert.deepStrictEqual(
                promoted.map(update => update.id),
                [updateId]
            );

            const update = await UpdateEntity.query().filter({ id: updateId }).findOne();
            assert.strictEqual(update.status, 'released');
            assert.ok(update.releasedAt, 'releasedAt should be set');
            assert.strictEqual(update.promotedById, null);
        } finally {
            mockGitLabState.jobSha = originalSha;
        }
    });

    test('finalize on a channel with empty cohorts goes straight to released', async () => {
        const channel = await ChannelEntity.query().filter({ id: CHANNEL_ID }).findOne();
        const stagingBackup = channel.stagingMembers;
        const canaryBackup = channel.canaryMembers;
        channel.stagingMembers = [];
        channel.canaryMembers = [];
        await channel.save();
        try {
            const updateId = await createDraftUpdate(facade);
            await facade.request(
                uploadAsset(updateId, {
                    key: 'bundles/ios-empty-cohorts.hbc',
                    platform: 'ios',
                    isLaunchAsset: true,
                    content: Buffer.from('empty-cohort test bundle'),
                    ext: 'hbc',
                    type: 'application/javascript'
                })
            );

            const finalizeResp = await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/finalize`).header(
                    'authorization',
                    `Bearer ${TEST_CI_TOKEN}`
                )
            );
            assert.strictEqual(finalizeResp.statusCode, 200);

            const update = await UpdateEntity.query().filter({ id: updateId }).findOne();
            assert.strictEqual(update.status, 'released');
            assert.ok(update.releasedAt, 'releasedAt should be set when finalize skips to released');
            assert.strictEqual(update.promotedById, null, 'auto-release leaves promotedById null');
        } finally {
            channel.stagingMembers = stagingBackup;
            channel.canaryMembers = canaryBackup;
            await channel.save();
        }
    });

    test('finalize treats legacy user-only cohorts as empty', async () => {
        const channel = await ChannelEntity.query().filter({ id: CHANNEL_ID }).findOne();
        const stagingBackup = channel.stagingMembers;
        const canaryBackup = channel.canaryMembers;
        channel.stagingMembers = [{ type: 'user' as never, id: 'legacy-staging-user', comment: '' }];
        channel.canaryMembers = [{ type: 'user' as never, id: 'legacy-canary-user', comment: '' }];
        await channel.save();
        try {
            const updateId = await createDraftUpdate(facade);
            await facade.request(
                uploadAsset(updateId, {
                    key: 'bundles/ios-legacy-user-cohorts.hbc',
                    platform: 'ios',
                    isLaunchAsset: true,
                    content: Buffer.from('legacy user cohort bundle'),
                    ext: 'hbc',
                    type: 'application/javascript'
                })
            );

            const finalizeResp = await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/finalize`).header(
                    'authorization',
                    `Bearer ${TEST_CI_TOKEN}`
                )
            );
            assert.strictEqual(finalizeResp.statusCode, 200);

            const update = await UpdateEntity.query().filter({ id: updateId }).findOne();
            assert.strictEqual(update.status, 'released');
        } finally {
            channel.stagingMembers = stagingBackup;
            channel.canaryMembers = canaryBackup;
            await channel.save();
        }
    });

    test('finalize skips an empty staging cohort and lands in canary', async () => {
        const channel = await ChannelEntity.query().filter({ id: CHANNEL_ID }).findOne();
        const stagingBackup = channel.stagingMembers;
        channel.stagingMembers = [];
        await channel.save();
        try {
            const updateId = await createDraftUpdate(facade);
            await facade.request(
                uploadAsset(updateId, {
                    key: 'bundles/ios-skip-staging.hbc',
                    platform: 'ios',
                    isLaunchAsset: true,
                    content: Buffer.from('skip-staging bundle'),
                    ext: 'hbc',
                    type: 'application/javascript'
                })
            );

            const finalizeResp = await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/finalize`).header(
                    'authorization',
                    `Bearer ${TEST_CI_TOKEN}`
                )
            );
            assert.strictEqual(finalizeResp.statusCode, 200);

            const update = await UpdateEntity.query().filter({ id: updateId }).findOne();
            assert.strictEqual(update.status, 'canary');
        } finally {
            channel.stagingMembers = stagingBackup;
            await channel.save();
        }
    });

    test('promote skips empty canary cohort and advances staging → released', async () => {
        const channel = await ChannelEntity.query().filter({ id: CHANNEL_ID }).findOne();
        const canaryBackup = channel.canaryMembers;
        channel.canaryMembers = [];
        await channel.save();
        try {
            const updateId = await createDraftUpdate(facade);
            await facade.request(
                uploadAsset(updateId, {
                    key: 'bundles/ios-skip-canary.hbc',
                    platform: 'ios',
                    isLaunchAsset: true,
                    content: Buffer.from('skip-canary bundle'),
                    ext: 'hbc',
                    type: 'application/javascript'
                })
            );
            await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/finalize`).header(
                    'authorization',
                    `Bearer ${TEST_CI_TOKEN}`
                )
            );
            // sanity: should have landed in staging because stagingMembers has entries
            const staging = await UpdateEntity.query().filter({ id: updateId }).findOne();
            assert.strictEqual(staging.status, 'staging');

            const userJwt = await JWT.generate({ subject: USER_ID });
            const resp = await facade.request(
                HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/promote`).header(
                    'authorization',
                    `Bearer ${userJwt}`
                )
            );
            assert.strictEqual(resp.statusCode, 200);

            const released = await UpdateEntity.query().filter({ id: updateId }).findOne();
            assert.strictEqual(released.status, 'released', 'empty canary cohort is skipped');
            assert.ok(released.releasedAt);
        } finally {
            channel.canaryMembers = canaryBackup;
            await channel.save();
        }
    });

    test('cancel a draft → status=canceled, ciTokenHash cleared', async () => {
        const updateId = await createDraftUpdate(facade);

        const userJwt = await JWT.generate({ subject: USER_ID });
        const resp = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/cancel`).header('authorization', `Bearer ${userJwt}`)
        );
        assert.strictEqual(resp.statusCode, 200);

        const update = await UpdateEntity.query().filter({ id: updateId }).findOne();
        assert.strictEqual(update.status, 'canceled');
        assert.strictEqual(update.ciTokenHash, null);
    });

    test('cannot cancel a released update', async () => {
        // depends on a released update being created by the promote-canary test above
        const released = await UpdateEntity.query().filter({ appId: APP_ID, status: 'released' }).findOneOrUndefined();
        assert.ok(released, 'expected released update from prior test');

        const userJwt = await JWT.generate({ subject: USER_ID });
        const resp = await facade.request(
            HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${released.id}/cancel`).header('authorization', `Bearer ${userJwt}`)
        );
        assert.strictEqual(resp.statusCode, 400);
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
        name: 'Flow Test App',
        vcsId: ZERO_ID,
        projectPath: 'group/flow-test',
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
        // Populated cohorts so finalize lands in staging and promote walks
        // staging → canary → released through the new tier-skip logic.
        stagingMembers: [{ type: 'device', id: 'flow-staging-device', comment: '' }],
        canaryMembers: [{ type: 'device', id: 'flow-canary-device', comment: '' }],
        createdAt: new Date(),
        deletedAt: null
    });

    await createPersistedEntity(UserEntity, {
        id: USER_ID,
        vcsId: ZERO_ID,
        vcsUserId: 'flow-user',
        name: 'flow-user',
        isAdmin: false,
        createdAt: new Date(),
        lastLoginAt: new Date(),
        vcsSession: {
            accessToken: 'tok',
            expiresAt: Date.now() + 3600_000,
            refreshToken: 'r',
            redirectUri: 'http://localhost'
        }
    });
}

async function createDraftUpdate(facade: ReturnType<typeof TestingHelpers.createTestingFacade>): Promise<string> {
    const resp = await facade.request(
        HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates`)
            .header('authorization', `Bearer ${TEST_CI_TOKEN}`)
            .json({ runtimeVersion: '1.0.0', platform: 'ios', expoConfig: {}, metadata: {} })
    );
    assert.strictEqual(resp.statusCode, 200, `expected 200 from create, got ${resp.statusCode}: ${resp.bodyString}`);
    return (resp.json as { id: string }).id;
}

function uploadAsset(
    updateId: string,
    opts: {
        key: string;
        platform: 'ios' | 'android' | 'all';
        isLaunchAsset: boolean;
        content: Buffer;
        ext: string;
        type: string;
    }
) {
    return HttpRequest.POST(`/api/apps/${APP_ID}/channels/${CHANNEL_ID}/updates/${updateId}/assets`)
        .header('authorization', `Bearer ${TEST_CI_TOKEN}`)
        .multiPart([
            { name: 'file', file: opts.content, fileName: opts.key, contentType: opts.type },
            { name: 'key', value: opts.key },
            { name: 'platform', value: opts.platform },
            { name: 'isLaunchAsset', value: String(opts.isLaunchAsset) },
            { name: 'fileExtension', value: opts.ext },
            { name: 'contentType', value: opts.type }
        ]);
}
