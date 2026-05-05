import { HttpRequest, HttpUnauthorizedError } from '@deepkit/http';
import { Logger } from '@deepkit/logger';
import { createAuthMiddleware, HttpDetailedAccessDeniedError, HttpMiddleware } from '@zyno-io/dk-server-foundation';
import { createHash } from 'crypto';

import { UpdateEntity } from '../entities/Update.entity';
import { UserEntity } from '../entities/User.entity';
import { IGitLabConfig, VcsIntegrationEntity } from '../entities/VcsIntegration.entity';

export class UserAuthMiddleware extends createAuthMiddleware(UserEntity) {}

export class AdminAuthMiddleware extends UserAuthMiddleware {
    async validateEntity(_request: HttpRequest, entity: UserEntity) {
        if (!entity.isAdmin) throw new HttpDetailedAccessDeniedError('Insufficient permissions');
    }
}

export interface ICiJobData {
    jobId: string;
    branch: string;
    commitHash: string;
    commitSubject: string;
    commitAuthor: string;
    vcsProjectId: number;
}

export function hashCiToken(ciToken: string): string {
    return createHash('sha256').update(ciToken).digest('hex');
}

/**
 * Verifies the request's Bearer token hash matches the in-progress update's stored
 * ciTokenHash. Used on asset upload + finalize to keep a draft session bound to
 * the same CI job that created it.
 */
export class UpdateCiTokenMiddleware extends HttpMiddleware {
    constructor(private logger: Logger) {
        super();
    }

    async handle(request: HttpRequest) {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            this.logger.warn('CI token auth failed: missing or malformed Authorization header');
            throw new HttpUnauthorizedError();
        }

        const ciToken = authHeader.slice(7);
        const tokenHash = hashCiToken(ciToken);

        const match = request.url?.match(/^\/api\/apps\/([^/]+)\/channels\/([^/]+)\/updates\/([^/]+)/);
        if (!match) {
            this.logger.warn('CI token auth failed: could not extract appId/channelId/updateId from URL');
            throw new HttpUnauthorizedError();
        }
        const [, appId, channelId, updateId] = match;

        const update = await UpdateEntity.query().filter({ id: updateId, appId, channelId }).findOneOrUndefined();
        if (!update || update.ciTokenHash !== tokenHash) {
            this.logger.warn(
                `CI token auth failed: update not found or token hash mismatch (appId=${appId} channelId=${channelId} updateId=${updateId})`
            );
            throw new HttpUnauthorizedError();
        }
    }
}

/**
 * Validates a GitLab CI job token against the GitLab API and returns
 * extracted job/commit data, including the project_id (used to bind the
 * upload to the App's vcsProjectId).
 */
export async function validateCiToken(ciToken: string, vcsId: string, logger: Logger): Promise<ICiJobData> {
    const vcs = await VcsIntegrationEntity.query().filter({ id: vcsId, deletedAt: null }).findOneOrUndefined();
    if (!vcs || vcs.platform !== 'gitlab') {
        logger.warn(`CI token validation failed: VCS integration not found or not GitLab (vcsId=${vcsId})`);
        throw new HttpUnauthorizedError();
    }

    const gitlabUrl = (vcs.config as IGitLabConfig).url;

    let jobResponse: Response;
    try {
        jobResponse = await fetch(`${gitlabUrl}/api/v4/job`, {
            headers: { 'JOB-TOKEN': ciToken }
        });
    } catch (err) {
        logger.warn(`CI token validation failed: GitLab /api/v4/job request failed (${err})`);
        throw new HttpUnauthorizedError();
    }

    if (!jobResponse.ok) {
        logger.warn(`CI token validation failed: GitLab /api/v4/job returned ${jobResponse.status} ${jobResponse.statusText}`);
        throw new HttpUnauthorizedError();
    }

    const jobData = (await jobResponse.json()) as {
        id?: number;
        ref?: string;
        pipeline?: { project_id?: number; sha?: string };
        commit?: { title?: string; author_name?: string };
    };

    const vcsProjectId = jobData.pipeline?.project_id;
    if (!vcsProjectId) {
        logger.warn('CI token validation failed: GitLab job response missing pipeline.project_id');
        throw new HttpUnauthorizedError();
    }

    return {
        jobId: String(jobData.id ?? ''),
        branch: jobData.ref ?? '',
        commitHash: jobData.pipeline?.sha ?? '',
        commitSubject: jobData.commit?.title ?? '',
        commitAuthor: jobData.commit?.author_name ?? '',
        vcsProjectId
    };
}
