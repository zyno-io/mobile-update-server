import type { Algorithm } from 'fast-jwt';

import { HttpBadRequestError } from '@deepkit/http';
import { Logger, ScopedLogger } from '@deepkit/logger';
import { assert } from '@deepkit/type';
import { JWT, persistEntity, r } from '@zyno-io/dk-server-foundation';
import axios from 'axios';
import { createPublicKey } from 'crypto';

import type { IVcsLoginSessionResponse, IVcsProject, IVcsServiceImpl, ProjectAccessLevel } from './Vcs.service';

import { DB } from '../database';
import { UserEntity } from '../entities/User.entity';
import { IGitLabConfig } from '../entities/VcsIntegration.entity';

const GITLAB_ACCESS_LEVELS: { min: number; level: ProjectAccessLevel }[] = [
    { min: 50, level: 'owner' },
    { min: 40, level: 'maintainer' },
    { min: 30, level: 'developer' },
    { min: 20, level: 'reporter' },
    { min: 10, level: 'guest' }
];

interface IOpenIdMetadata {
    issuer: string;
    jwks_uri: string;
}

type GitLabJwk = JsonWebKey & { kid?: string; alg?: string };

interface IJwksResponse {
    keys: GitLabJwk[];
}

interface IJwksCacheEntry {
    metadata: IOpenIdMetadata;
    jwks: IJwksResponse;
    expiresAt: number;
}

const OIDC_CACHE_TTL_MS = 5 * 60_000;
const oidcCache = new Map<string, IJwksCacheEntry>();
const SUPPORTED_ID_TOKEN_ALGORITHMS = new Set<Algorithm>(['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA']);

export class VcsGitLabService implements IVcsServiceImpl {
    private logger = r<ScopedLogger>(Logger);

    constructor(
        private config: IGitLabConfig,
        private db: DB
    ) {}

    async getProviderLoginUrl(redirectUri: string, state?: string): Promise<string> {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: redirectUri,
            state: state ?? '',
            response_type: 'code',
            scope: 'openid api'
        });
        return `${this.config.url}/oauth/authorize?${params}`;
    }

    async exchangeProviderCode(redirectUri: string, code: string): Promise<IVcsLoginSessionResponse> {
        try {
            const response = await axios.post(
                `${this.config.url}/oauth/token`,
                new URLSearchParams({
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                    redirect_uri: redirectUri,
                    code,
                    grant_type: 'authorization_code'
                })
            );

            assert<{
                access_token: string;
                expires_in: number;
                refresh_token: string;
                id_token: string;
            }>(response.data);

            const idToken = await this.verifyIdToken(response.data.id_token);

            return {
                id: idToken.subject,
                name: idToken.name,
                accessToken: response.data.access_token,
                expiresAt: Date.now() + response.data.expires_in * 1000,
                refreshToken: response.data.refresh_token,
                redirectUri
            };
        } catch (err) {
            if (axios.isAxiosError(err)) {
                throw new HttpBadRequestError(err.response?.data);
            }
            throw err;
        }
    }

    async searchProjects(user: UserEntity, search: string): Promise<IVcsProject[]> {
        await this.renewToken(user);

        const response = await axios.get(`${this.config.url}/api/v4/projects`, {
            params: {
                search,
                membership: true,
                order_by: 'last_activity_at',
                per_page: 20
            },
            headers: { Authorization: `Bearer ${user.vcsSession!.accessToken}` }
        });

        return response.data.map(
            (p: {
                id: number;
                name: string;
                path_with_namespace: string;
                web_url: string;
                description: string | null;
                default_branch: string | null;
            }) => ({
                id: String(p.id),
                name: p.name,
                projectPath: p.path_with_namespace,
                webUrl: p.web_url,
                description: p.description ?? '',
                defaultBranch: p.default_branch ?? undefined
            })
        );
    }

    async getProjectByPath(user: UserEntity, projectPath: string): Promise<IVcsProject> {
        await this.renewToken(user);

        const response = await axios.get(`${this.config.url}/api/v4/projects/${encodeURIComponent(projectPath)}`, {
            headers: { Authorization: `Bearer ${user.vcsSession!.accessToken}` }
        });

        const p = response.data;
        return {
            id: String(p.id),
            name: p.name,
            projectPath: p.path_with_namespace,
            webUrl: p.web_url,
            description: p.description ?? '',
            defaultBranch: p.default_branch ?? undefined
        };
    }

    async getUserProjectAccessLevel(user: UserEntity, vcsProjectId: number): Promise<ProjectAccessLevel> {
        await this.renewToken(user);

        // 200 → user is a member; 404 → user is not a member (legitimately "none").
        // Anything else (5xx, network error) is a real failure — propagate so callers
        // see the GitLab outage instead of silently demoting the user to no-access.
        const response = await axios.get(`${this.config.url}/api/v4/projects/${vcsProjectId}/members/all/${user.vcsUserId}`, {
            headers: { Authorization: `Bearer ${user.vcsSession!.accessToken}` },
            validateStatus: status => status === 200 || status === 404
        });

        if (response.status === 404) return 'none';

        const accessLevel = response.data?.access_level ?? 0;
        for (const { min, level } of GITLAB_ACCESS_LEVELS) {
            if (accessLevel >= min) return level;
        }
        return 'none';
    }

    private async renewToken(user: UserEntity): Promise<void> {
        // Skip refresh while the access token is still valid for ≥60s.
        if (user.vcsSession!.expiresAt > Date.now() + 60_000) return;

        try {
            await this.db.transaction(async session => {
                await session.acquireSessionLock(['mus', 'vcs-refresh', user.id]);

                const latest = await session.query(UserEntity).filter({ id: user.id }).findOne();
                if (!latest.vcsSession) throw new HttpBadRequestError('GitLab session is missing');
                if (latest.vcsSession.expiresAt > Date.now() + 60_000) {
                    user.vcsSession = latest.vcsSession;
                    return;
                }

                await this.logger.info('Refreshing GitLab token', { userId: latest.id });

                const response = await axios.post(
                    `${this.config.url}/oauth/token`,
                    new URLSearchParams({
                        client_id: this.config.clientId,
                        client_secret: this.config.clientSecret,
                        grant_type: 'refresh_token',
                        refresh_token: latest.vcsSession.refreshToken,
                        redirect_uri: latest.vcsSession.redirectUri
                    })
                );

                assert<{
                    access_token: string;
                    expires_in: number;
                    refresh_token: string;
                }>(response.data);

                latest.vcsSession = {
                    ...latest.vcsSession,
                    accessToken: response.data.access_token,
                    expiresAt: Date.now() + response.data.expires_in * 1000,
                    refreshToken: response.data.refresh_token
                };
                await persistEntity(latest, session);
                user.vcsSession = latest.vcsSession;
            });
        } catch (err) {
            if (axios.isAxiosError(err)) {
                throw new HttpBadRequestError(err.response?.data);
            }
            throw err;
        }
    }

    private async verifyIdToken(idToken: string): Promise<{ subject: string; name: string }> {
        const header = this.decodeJwtHeader(idToken);
        if (!header.kid || !header.alg) throw new HttpBadRequestError('GitLab id_token is missing kid or alg');

        let oidc = await this.getOidcMetadata();
        let jwk = oidc.jwks.keys.find(key => key.kid === header.kid);
        if (!jwk) {
            oidc = await this.getOidcMetadata(true);
            jwk = oidc.jwks.keys.find(key => key.kid === header.kid);
        }
        if (!jwk) throw new HttpBadRequestError('GitLab id_token signing key was not found');

        const algorithm = this.resolveIdTokenAlgorithm(header.alg, jwk);
        const key = createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
        const verifier = JWT.createVerifier<{ name: string }>({
            key,
            algorithm,
            issuer: oidc.metadata.issuer,
            audience: this.config.clientId
        });

        const parsed = await verifier(idToken);
        if (!parsed.isValid) throw new HttpBadRequestError('Invalid GitLab id_token');
        if (!parsed.subject) throw new HttpBadRequestError('GitLab id_token is missing subject');
        if (typeof parsed.payload?.name !== 'string' || !parsed.payload.name) {
            throw new HttpBadRequestError('GitLab id_token is missing name');
        }
        return { subject: parsed.subject, name: parsed.payload.name };
    }

    private async getOidcMetadata(force = false): Promise<IJwksCacheEntry> {
        const baseUrl = this.config.url.replace(/\/+$/, '');
        const cached = oidcCache.get(baseUrl);
        if (!force && cached && cached.expiresAt > Date.now()) return cached;

        const metadataResponse = await axios.get<IOpenIdMetadata>(`${baseUrl}/.well-known/openid-configuration`);
        const metadata = metadataResponse.data;
        if (!metadata.issuer || !metadata.jwks_uri) throw new HttpBadRequestError('GitLab OpenID metadata is incomplete');

        const jwksResponse = await axios.get<IJwksResponse>(metadata.jwks_uri);
        const entry = { metadata, jwks: jwksResponse.data, expiresAt: Date.now() + OIDC_CACHE_TTL_MS };
        oidcCache.set(baseUrl, entry);
        return entry;
    }

    private decodeJwtHeader(token: string): { alg?: string; kid?: string } {
        const [header] = token.split('.');
        if (!header) throw new HttpBadRequestError('Invalid GitLab id_token');

        try {
            return JSON.parse(Buffer.from(header, 'base64url').toString('utf-8')) as { alg?: string; kid?: string };
        } catch {
            throw new HttpBadRequestError('Invalid GitLab id_token header');
        }
    }

    private resolveIdTokenAlgorithm(headerAlg: string, jwk: GitLabJwk): Algorithm {
        const algorithm = headerAlg as Algorithm;
        if (!SUPPORTED_ID_TOKEN_ALGORITHMS.has(algorithm)) {
            throw new HttpBadRequestError('GitLab id_token uses an unsupported signing algorithm');
        }
        if (jwk.use && jwk.use !== 'sig') {
            throw new HttpBadRequestError('GitLab id_token signing key is not for signatures');
        }
        if (jwk.alg && jwk.alg !== headerAlg) {
            throw new HttpBadRequestError('GitLab id_token algorithm does not match signing key');
        }
        if (jwk.kty === 'RSA' && !algorithm.startsWith('RS') && !algorithm.startsWith('PS')) {
            throw new HttpBadRequestError('GitLab id_token algorithm does not match RSA signing key');
        }
        if (jwk.kty === 'EC' && !algorithm.startsWith('ES')) {
            throw new HttpBadRequestError('GitLab id_token algorithm does not match EC signing key');
        }
        if (jwk.kty === 'OKP' && algorithm !== 'EdDSA') {
            throw new HttpBadRequestError('GitLab id_token algorithm does not match OKP signing key');
        }
        if (jwk.kty !== 'RSA' && jwk.kty !== 'EC' && jwk.kty !== 'OKP') {
            throw new HttpBadRequestError('GitLab id_token uses an unsupported signing key type');
        }
        return algorithm;
    }
}
