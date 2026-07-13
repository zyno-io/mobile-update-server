import '../shared/setup';
import { HttpRequest } from '@zyno-io/ts-server-foundation';
import { uuid } from '@zyno-io/ts-server-foundation';
import { createPersistedEntity, JWT, TestingHelpers } from '@zyno-io/ts-server-foundation';
import assert from 'node:assert';
import { before, describe, test } from 'node:test';

import { CoreAppOptions } from '../../src/app';
import { UserEntity } from '../../src/entities/User.entity';
import { VcsIntegrationEntity } from '../../src/entities/VcsIntegration.entity';

describe('onboarding', () => {
    let facade: ReturnType<typeof TestingHelpers.createTestingFacade>;
    let adminId: string;
    let adminJwt: string;
    let nonAdminId: string;

    before(async () => {
        facade = TestingHelpers.createTestingFacade(CoreAppOptions, {
            enableDatabase: true,
            databasePrefix: 'mus_onboard'
        });
        await facade.start();
    });

    test('fresh install → isOnboarded=false', async () => {
        const resp = await facade.request(HttpRequest.GET('/api/session/onboarding-status'));
        assert.strictEqual(resp.statusCode, 200);
        assert.deepStrictEqual(resp.json, { isOnboarded: false });
    });

    test('two concurrent first onboardings → exactly one succeeds, exactly one row exists', async () => {
        const post = () =>
            facade.request(
                HttpRequest.POST('/api/session/onboarding/vcs-integration').json({
                    name: 'My GitLab',
                    platform: 'gitlab',
                    config: {
                        url: 'https://gitlab.example.com',
                        clientId: 'test-client-id',
                        clientSecret: 'test-client-secret'
                    }
                })
            );

        const [a, b] = await Promise.all([post(), post()]);
        const statuses = [a.statusCode, b.statusCode].sort();
        assert.deepStrictEqual(statuses, [200, 400], `expected one 200 + one 400, got ${a.statusCode} + ${b.statusCode}`);

        const winner = (a.statusCode === 200 ? a : b).json as { id: string; name: string; platform: string };
        assert.strictEqual(winner.name, 'My GitLab');
        assert.strictEqual(winner.platform, 'gitlab');

        const all = await VcsIntegrationEntity.query().find();
        assert.strictEqual(all.length, 1, 'exactly one VcsIntegration row should exist after concurrent onboarding');
    });

    test('after onboarding → isOnboarded=true', async () => {
        const resp = await facade.request(HttpRequest.GET('/api/session/onboarding-status'));
        assert.deepStrictEqual(resp.json, { isOnboarded: true });
    });

    test('second onboarding attempt blocked → 400', async () => {
        const resp = await facade.request(
            HttpRequest.POST('/api/session/onboarding/vcs-integration').json({
                name: 'Another',
                platform: 'gitlab',
                config: {
                    url: 'https://gitlab2.example.com',
                    clientId: 'x',
                    clientSecret: 'y'
                }
            })
        );
        assert.strictEqual(resp.statusCode, 400);
    });

    test('admin endpoints reject unauthenticated requests', async () => {
        const integrationsResp = await facade.request(HttpRequest.GET('/api/admin/vcs-integrations'));
        assert.strictEqual(integrationsResp.statusCode, 401);

        const usersResp = await facade.request(HttpRequest.GET('/api/admin/users'));
        assert.strictEqual(usersResp.statusCode, 401);
    });

    test('non-admin user → 403 on admin endpoints', async () => {
        const { id, jwt } = await makeUser('non-admin', false);
        nonAdminId = id;

        const resp = await facade.request(HttpRequest.GET('/api/admin/vcs-integrations').header('authorization', `Bearer ${jwt}`));
        assert.strictEqual(resp.statusCode, 403);
    });

    test('admin user → 200 on admin endpoints, sees existing integration', async () => {
        const { id, jwt } = await makeUser('admin', true);
        adminId = id;
        adminJwt = jwt;

        const integrationsResp = await facade.request(HttpRequest.GET('/api/admin/vcs-integrations').header('authorization', `Bearer ${jwt}`));
        assert.strictEqual(integrationsResp.statusCode, 200);
        const list = integrationsResp.json as { id: string; name: string }[];
        assert.ok(
            list.some(i => i.name === 'My GitLab'),
            'should see My GitLab integration'
        );

        const usersResp = await facade.request(HttpRequest.GET('/api/admin/users').header('authorization', `Bearer ${jwt}`));
        assert.strictEqual(usersResp.statusCode, 200);
    });

    test("admin can toggle another user's isAdmin flag", async () => {
        const resp = await facade.request(
            HttpRequest.PUT(`/api/admin/users/${nonAdminId}`).header('authorization', `Bearer ${adminJwt}`).json({ isAdmin: true })
        );
        assert.strictEqual(resp.statusCode, 200);

        const updated = await UserEntity.query().filter({ id: nonAdminId }).findOne();
        assert.strictEqual(updated.isAdmin, true);
    });

    test('admin cannot toggle their own isAdmin flag → 400', async () => {
        const resp = await facade.request(
            HttpRequest.PUT(`/api/admin/users/${adminId}`).header('authorization', `Bearer ${adminJwt}`).json({ isAdmin: false })
        );
        assert.strictEqual(resp.statusCode, 400);

        const me = await UserEntity.query().filter({ id: adminId }).findOne();
        assert.strictEqual(me.isAdmin, true, 'self-flag must be unchanged');
    });
});

async function makeUser(name: string, isAdmin: boolean): Promise<{ id: string; jwt: string }> {
    const id = uuid();
    await createPersistedEntity(UserEntity, {
        id,
        vcsId: '00000000-0000-0000-0000-000000000000',
        vcsUserId: name,
        name,
        isAdmin,
        createdAt: new Date(),
        lastLoginAt: new Date(),
        vcsSession: {
            accessToken: 't',
            expiresAt: Date.now() + 3600_000,
            refreshToken: 'r',
            redirectUri: 'http://localhost'
        }
    });
    const jwt = await JWT.generate({ subject: id });
    return { id, jwt };
}
