import { http, HttpBadRequestError, HttpBody, HttpNotFoundError, HttpQueries } from '@zyno-io/ts-server-foundation';
import { uuid } from '@zyno-io/ts-server-foundation';
import { createEntity } from '@zyno-io/ts-server-foundation';

import { UserAuthMiddleware } from '../accessories/AuthMiddleware.accessory';
import { ApiController } from '../accessories/Controller.accessory';
import { GitLabProjectAuthService } from '../accessories/GitLabProjectAuth.accessory';
import { AppEntity } from '../entities/App.entity';
import { ChannelEntity } from '../entities/Channel.entity';
import { UserEntity } from '../entities/User.entity';
import { IGitLabConfig, VcsIntegrationEntity } from '../entities/VcsIntegration.entity';
import { IVcsProject, ProjectAccessLevel, VcsService } from '../services/Vcs.service';

type GrantedAccessLevel = Exclude<ProjectAccessLevel, 'none'>;

export type IAppListResponse = Pick<AppEntity, 'id' | 'name' | 'vcsId' | 'projectPath' | 'vcsProjectId'> & {
    role: ProjectAccessLevel;
};
export type IAppDetailResponse = IAppListResponse & {
    webUrl: string | null;
};

interface IAppCreateInput {
    name: string;
    vcsId: string;
    projectPath: string;
    vcsProjectId: number;
}

interface IAppUpdateInput {
    name?: string;
}

@ApiController('/api/apps')
@http.middleware(UserAuthMiddleware)
export class AppsController {
    constructor(
        private vcsService: VcsService,
        private projectAuth: GitLabProjectAuthService
    ) {}

    @http.GET()
    async index(user: UserEntity): Promise<IAppListResponse[]> {
        const apps = await AppEntity.query().filter({ deletedAt: null }).orderBy('name').find();

        const withAccess = await Promise.all(
            apps.map(async app => {
                const role = await this.projectAuth.getAccessLevel(user, app.vcsId, app.vcsProjectId);
                return role === 'none' ? null : { app, role: role as GrantedAccessLevel };
            })
        );

        return withAccess
            .filter((x): x is { app: AppEntity; role: GrantedAccessLevel } => x !== null)
            .map(({ app, role }) => ({
                id: app.id,
                name: app.name,
                vcsId: app.vcsId,
                projectPath: app.projectPath,
                vcsProjectId: app.vcsProjectId,
                role
            }));
    }

    @http.GET('/:id')
    async show(id: string, user: UserEntity): Promise<IAppDetailResponse> {
        const app = await AppEntity.query().filter({ id, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();

        const role = await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'read');

        const vcs = await VcsIntegrationEntity.query().filter({ id: app.vcsId, deletedAt: null }).findOneOrUndefined();
        const webUrl = vcs?.platform === 'gitlab' ? `${(vcs.config as IGitLabConfig).url}/${app.projectPath}` : null;

        return {
            id: app.id,
            name: app.name,
            vcsId: app.vcsId,
            projectPath: app.projectPath,
            vcsProjectId: app.vcsProjectId,
            role,
            webUrl
        };
    }

    @http.POST()
    async create(body: HttpBody<IAppCreateInput>, user: UserEntity): Promise<IAppListResponse> {
        const name = body.name.trim();
        if (!name) throw new HttpBadRequestError('Name is required');

        const role = await this.projectAuth.requireRole(user, body.vcsId, body.vcsProjectId, 'manage');

        const existing = await AppEntity.query().filter({ vcsId: body.vcsId, vcsProjectId: body.vcsProjectId, deletedAt: null }).findOneOrUndefined();
        if (existing) throw new HttpBadRequestError('An app already exists for this GitLab project');

        const app = createEntity(AppEntity, {
            id: uuid(),
            name,
            vcsId: body.vcsId,
            projectPath: body.projectPath,
            vcsProjectId: body.vcsProjectId,
            createdAt: new Date()
        });
        await app.save();

        return {
            id: app.id,
            name: app.name,
            vcsId: app.vcsId,
            projectPath: app.projectPath,
            vcsProjectId: app.vcsProjectId,
            role
        };
    }

    @http.PUT('/:id')
    async update(id: string, body: HttpBody<IAppUpdateInput>, user: UserEntity): Promise<IAppListResponse> {
        const app = await AppEntity.query().filter({ id, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();

        const role = await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'manage');

        if (body.name !== undefined) {
            const name = body.name.trim();
            if (!name) throw new HttpBadRequestError('Name cannot be empty');
            app.name = name;
        }
        await app.save();

        return {
            id: app.id,
            name: app.name,
            vcsId: app.vcsId,
            projectPath: app.projectPath,
            vcsProjectId: app.vcsProjectId,
            role
        };
    }

    @http.DELETE('/:id')
    async delete(id: string, user: UserEntity): Promise<void> {
        const app = await AppEntity.query().filter({ id, deletedAt: null }).findOneOrUndefined();
        if (!app) throw new HttpNotFoundError();

        await this.projectAuth.requireRole(user, app.vcsId, app.vcsProjectId, 'manage');

        const deletedAt = new Date();
        app.deletedAt = deletedAt;
        await app.save();

        const channels = await ChannelEntity.query().filter({ appId: app.id, deletedAt: null }).find();
        for (const channel of channels) {
            channel.deletedAt = deletedAt;
            await channel.save();
        }
    }

    @http.GET('vcs-projects/search')
    async searchVcsProjects(query: HttpQueries<{ vcsId: string; search: string }>, user: UserEntity): Promise<IVcsProject[]> {
        return this.vcsService.searchProjects(user, query.vcsId, query.search);
    }

    @http.GET('vcs-projects/resolve')
    async resolveVcsProject(query: HttpQueries<{ vcsId: string; url: string }>, user: UserEntity): Promise<IVcsProject> {
        let urlObj: URL;
        try {
            urlObj = new URL(query.url);
        } catch {
            throw new HttpBadRequestError('Invalid URL');
        }

        const projectPath = urlObj.pathname
            .replace(/^\//, '')
            .replace(/\/-\/.*$/, '')
            .replace(/\.git$/, '');
        if (!projectPath) {
            throw new HttpBadRequestError('Could not extract project path from URL');
        }
        return this.vcsService.getProjectByPath(user, query.vcsId, projectPath);
    }
}
