import { HttpDetailedAccessDeniedError } from '@zyno-io/dk-server-foundation';

import { UserEntity } from '../entities/User.entity';
import { ProjectAccessLevel, VcsService } from '../services/Vcs.service';

const ROLE_RANK: Record<ProjectAccessLevel, number> = {
    none: 0,
    guest: 1,
    reporter: 2,
    developer: 3,
    maintainer: 4,
    owner: 5
};

export type AppRole = 'read' | 'operate' | 'manage';

const APP_ROLE_REQUIREMENT: Record<AppRole, ProjectAccessLevel> = {
    read: 'guest',
    operate: 'developer',
    manage: 'maintainer'
};

interface CacheEntry {
    level: ProjectAccessLevel;
    expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 1000;

/**
 * Resolves and caches a user's GitLab project access level. Used to mirror
 * GitLab project permissions onto every app-scoped route in this server.
 */
export class GitLabProjectAuthService {
    // Map iteration order is insertion order — re-inserting a key on hit moves it to the
    // tail, so the head is the LRU entry; we evict from the head when we exceed the cap.
    private cache = new Map<string, CacheEntry>();

    constructor(private vcsService: VcsService) {}

    async getAccessLevel(user: UserEntity, vcsId: string, vcsProjectId: number): Promise<ProjectAccessLevel> {
        const cacheKey = `${user.id}|${vcsId}|${vcsProjectId}`;
        const now = Date.now();
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            this.cache.delete(cacheKey);
            this.cache.set(cacheKey, cached);
            return cached.level;
        }

        const level = await this.vcsService.getUserProjectAccessLevel(user, vcsId, vcsProjectId);
        // delete-then-set so the key always lands at the tail, even when refreshing an expired entry
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, { level, expiresAt: now + CACHE_TTL_MS });

        if (this.cache.size > CACHE_MAX_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }

        return level;
    }

    async requireRole(user: UserEntity, vcsId: string, vcsProjectId: number, role: AppRole): Promise<ProjectAccessLevel> {
        const level = await this.getAccessLevel(user, vcsId, vcsProjectId);
        if (ROLE_RANK[level] < ROLE_RANK[APP_ROLE_REQUIREMENT[role]]) {
            throw new HttpDetailedAccessDeniedError(`Insufficient GitLab project permissions (have=${level}, need=${role})`);
        }
        return level;
    }
}
