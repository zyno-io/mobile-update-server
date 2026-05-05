import { http, HttpBody, HttpNotFoundError } from '@deepkit/http';
import { uuid } from '@deepkit/type';
import { createEntity } from '@zyno-io/dk-server-foundation';

import { AdminAuthMiddleware } from '../accessories/AuthMiddleware.accessory';
import { ApiController } from '../accessories/Controller.accessory';
import { AppEntity } from '../entities/App.entity';
import { ChannelEntity } from '../entities/Channel.entity';
import { IGitLabConfig, VcsIntegrationEntity } from '../entities/VcsIntegration.entity';

type IVcsIntegrationListResponse = Pick<VcsIntegrationEntity, 'id' | 'name' | 'platform'>;
type IVcsIntegrationDetailResponse = Pick<VcsIntegrationEntity, 'id' | 'name' | 'platform' | 'config'>;

interface IVcsIntegrationCreateInput {
    name: string;
    platform: 'gitlab';
    config: IGitLabConfig;
}

interface IVcsIntegrationUpdateInput {
    name?: string;
    config?: IGitLabConfig;
}

@ApiController('/api/admin/vcs-integrations')
@http.middleware(AdminAuthMiddleware)
export class VcsIntegrationsController {
    @http.GET()
    async index(): Promise<IVcsIntegrationListResponse[]> {
        const integrations = await VcsIntegrationEntity.query().filter({ deletedAt: null }).orderBy('name').find();
        return integrations.map(i => ({ id: i.id, name: i.name, platform: i.platform }));
    }

    @http.GET('/:id')
    async show(id: string): Promise<IVcsIntegrationDetailResponse> {
        const integration = await VcsIntegrationEntity.query().filter({ id, deletedAt: null }).findOneOrUndefined();
        if (!integration) throw new HttpNotFoundError();

        return {
            id: integration.id,
            name: integration.name,
            platform: integration.platform,
            config: integration.config
        };
    }

    @http.POST()
    async create(body: HttpBody<IVcsIntegrationCreateInput>): Promise<IVcsIntegrationListResponse> {
        const integration = createEntity(VcsIntegrationEntity, {
            id: uuid(),
            name: body.name,
            platform: body.platform,
            config: body.config,
            deletedAt: null
        });
        await integration.save();

        return { id: integration.id, name: integration.name, platform: integration.platform };
    }

    @http.PUT('/:id')
    async update(id: string, body: HttpBody<IVcsIntegrationUpdateInput>): Promise<IVcsIntegrationListResponse> {
        const integration = await VcsIntegrationEntity.query().filter({ id, deletedAt: null }).findOneOrUndefined();
        if (!integration) throw new HttpNotFoundError();

        if (body.name !== undefined) integration.name = body.name;
        if (body.config !== undefined) integration.config = body.config;
        await integration.save();

        return { id: integration.id, name: integration.name, platform: integration.platform };
    }

    @http.DELETE('/:id')
    async delete(id: string): Promise<void> {
        const integration = await VcsIntegrationEntity.query().filter({ id, deletedAt: null }).findOneOrUndefined();
        if (!integration) throw new HttpNotFoundError();

        const deletedAt = new Date();
        integration.deletedAt = deletedAt;
        await integration.save();

        const apps = await AppEntity.query().filter({ vcsId: id, deletedAt: null }).find();
        for (const app of apps) {
            app.deletedAt = deletedAt;
            await app.save();

            const channels = await ChannelEntity.query().filter({ appId: app.id, deletedAt: null }).find();
            for (const channel of channels) {
                channel.deletedAt = deletedAt;
                await channel.save();
            }
        }
    }
}
