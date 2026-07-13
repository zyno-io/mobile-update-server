import { Db } from '../database';
import { IUserVcsSession, UserEntity } from '../entities/User.entity';
import { IGitLabConfig, VcsIntegrationEntity } from '../entities/VcsIntegration.entity';
import { VcsGitLabService } from './VcsGitLab.service';

export interface IVcsLoginSessionResponse extends IUserVcsSession {
    id: string;
    name: string;
}

export interface IVcsProject {
    id: string;
    name: string;
    projectPath: string;
    webUrl: string;
    description: string;
    defaultBranch?: string;
}

export type ProjectAccessLevel = 'none' | 'guest' | 'reporter' | 'developer' | 'maintainer' | 'owner';

export interface IVcsServiceImpl {
    getProviderLoginUrl(redirectUri: string, state?: string): Promise<string>;
    exchangeProviderCode(redirectUri: string, code: string): Promise<IVcsLoginSessionResponse>;
    searchProjects(user: UserEntity, search: string): Promise<IVcsProject[]>;
    getProjectByPath(user: UserEntity, projectPath: string): Promise<IVcsProject>;
    getUserProjectAccessLevel(user: UserEntity, vcsProjectId: number): Promise<ProjectAccessLevel>;
}

export class VcsService {
    constructor(private db: Db) {}

    async getProviderLoginUrl(providerId: string, redirectUri: string, state?: string): Promise<string> {
        return this.runWithProvider(providerId, p => p.getProviderLoginUrl(redirectUri, state));
    }

    async exchangeProviderCode(providerId: string, redirectUri: string, code: string): Promise<IVcsLoginSessionResponse> {
        return this.runWithProvider(providerId, p => p.exchangeProviderCode(redirectUri, code));
    }

    async searchProjects(user: UserEntity, vcsId: string, search: string): Promise<IVcsProject[]> {
        return this.runWithProvider(vcsId, p => p.searchProjects(user, search));
    }

    async getProjectByPath(user: UserEntity, vcsId: string, projectPath: string): Promise<IVcsProject> {
        return this.runWithProvider(vcsId, p => p.getProjectByPath(user, projectPath));
    }

    async getUserProjectAccessLevel(user: UserEntity, vcsId: string, vcsProjectId: number): Promise<ProjectAccessLevel> {
        return this.runWithProvider(vcsId, p => p.getUserProjectAccessLevel(user, vcsProjectId));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async runWithProvider<T>(id: string, action: (provider: IVcsServiceImpl) => Promise<T>): Promise<T> {
        const provider = await this.getProvider(id);
        return action(provider);
    }

    private async getProvider(id: string): Promise<IVcsServiceImpl> {
        const provider = await VcsIntegrationEntity.query().filter({ id, deletedAt: null }).findOneOrUndefined();
        if (!provider) {
            throw new Error(`VCS provider with ID ${id} not found`);
        }

        if (provider.platform === 'gitlab') {
            return new VcsGitLabService(provider.config as IGitLabConfig, this.db);
        }

        throw new Error(`VCS provider with ID ${id} is not supported`);
    }
}
