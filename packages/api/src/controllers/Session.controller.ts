import { http, HttpBadRequestError, HttpBody, HttpQueries, HttpRequest, HttpResponse, HttpUnauthorizedError } from '@deepkit/http';
import { uuid } from '@deepkit/type';
import { createPersistedEntity, JWT, persistEntity } from '@zyno-io/dk-server-foundation';
import { randomBytes } from 'crypto';

import { ApiController } from '../accessories/Controller.accessory';
import { AppConfig } from '../config';
import { DB } from '../database';
import { UserEntity } from '../entities/User.entity';
import { IGitLabConfig, VcsIntegrationEntity } from '../entities/VcsIntegration.entity';
import { VcsService } from '../services/Vcs.service';

type ISessionResponse = Pick<UserEntity, 'id' | 'name' | 'isAdmin'>;
type ISessionProvider = Pick<VcsIntegrationEntity, 'id' | 'name'>;

interface ISessionLoginRequest {
    code: string;
    state: string;
}

interface ISessionLoginResponse {
    jwt: string;
    returnPath: string;
}

interface IOnboardingStatusResponse {
    isOnboarded: boolean;
}

interface IOnboardingVcsIntegrationInput {
    name: string;
    platform: 'gitlab';
    config: IGitLabConfig;
}

interface IOAuthStatePayload {
    nonce: string;
    redirectUri: string;
    returnPath: string;
}

const OAUTH_STATE_COOKIE_NAME = 'mus_oauth_nonce';
const OAUTH_STATE_TTL_MINS = 10;

@ApiController('/api/session')
export class SessionController {
    constructor(
        private db: DB,
        private vcsService: VcsService,
        private appConfig: AppConfig
    ) {}

    @http.GET('me')
    async getIdentity(user: UserEntity): Promise<ISessionResponse> {
        return {
            id: user.id,
            name: user.name,
            isAdmin: user.isAdmin
        };
    }

    @http.GET('providers')
    async getProviders(): Promise<ISessionProvider[]> {
        return VcsIntegrationEntity.query().filter({ deletedAt: null }).orderBy('name').find();
    }

    @http.GET('providers/:id/login-url')
    async getProviderLoginUrl(
        id: string,
        query: HttpQueries<{ redirectUri: string; returnPath?: string }>,
        response: HttpResponse
    ): Promise<{ url: string }> {
        const redirectUri = this.validateRedirectUri(query.redirectUri);
        const returnPath = this.normalizeReturnPath(query.returnPath);
        const nonce = randomBytes(32).toString('base64url');
        const state = await JWT.generate<IOAuthStatePayload>({
            subject: id,
            expiryMins: OAUTH_STATE_TTL_MINS,
            payload: { nonce, redirectUri, returnPath }
        });

        const url = await this.vcsService.getProviderLoginUrl(id, redirectUri, state);
        this.setOAuthStateCookie(response, nonce, redirectUri);
        return { url };
    }

    @http.GET('onboarding-status')
    async getOnboardingStatus(): Promise<IOnboardingStatusResponse> {
        const count = await VcsIntegrationEntity.query().count();
        return { isOnboarded: count > 0 };
    }

    @http.POST('onboarding/vcs-integration')
    async createOnboardingVcsIntegration(
        body: HttpBody<IOnboardingVcsIntegrationInput>
    ): Promise<Pick<VcsIntegrationEntity, 'id' | 'name' | 'platform'>> {
        return this.db.transaction(async session => {
            // Serialize concurrent onboarding attempts so the count-then-insert is atomic.
            await session.acquireSessionLock('mus:onboarding');

            const existingCount = await session.query(VcsIntegrationEntity).count();
            if (existingCount > 0) {
                throw new HttpBadRequestError('Onboarding has already been completed');
            }

            const integration = await createPersistedEntity(
                VcsIntegrationEntity,
                {
                    id: uuid(),
                    name: body.name,
                    platform: body.platform,
                    config: body.config,
                    deletedAt: null
                },
                session
            );

            return {
                id: integration.id,
                name: integration.name,
                platform: integration.platform
            };
        });
    }

    @http.POST('login')
    async login(body: HttpBody<ISessionLoginRequest>, request: HttpRequest, response: HttpResponse): Promise<ISessionLoginResponse> {
        const oauthState = await this.verifyOAuthState(body.state, request);
        this.clearOAuthStateCookie(response);

        const vcsSession = await this.vcsService.exchangeProviderCode(oauthState.providerId, oauthState.redirectUri, body.code);
        const { name, id: vcsUserId, ...sessionDetails } = vcsSession;

        const user = await this.db.transaction(async session => {
            // Serialize new-user creation so the "first user becomes admin" check is
            // race-free against concurrent first-time logins. The unique key on
            // (vcsId, vcsUserId) is the long-term guard; the lock just keeps the
            // count-then-insert atomic.
            await session.acquireSessionLock('mus:login:new-user');

            let user = await session.query(UserEntity).filter({ vcsId: oauthState.providerId, vcsUserId }).findOneOrUndefined();

            if (!user) {
                const userCount = await session.query(UserEntity).count();
                user = await createPersistedEntity(
                    UserEntity,
                    {
                        id: uuid(),
                        vcsId: oauthState.providerId,
                        vcsUserId,
                        name,
                        isAdmin: userCount === 0,
                        createdAt: new Date(),
                        lastLoginAt: new Date(),
                        vcsSession: sessionDetails
                    },
                    session
                );
                return user;
            }

            user.name = name;
            user.lastLoginAt = new Date();
            user.vcsSession = sessionDetails;
            await persistEntity(user, session);
            return user;
        });

        const jwt = await JWT.generate({ subject: user.id });
        return { jwt, returnPath: oauthState.returnPath };
    }

    private async verifyOAuthState(stateToken: string, request: HttpRequest): Promise<IOAuthStatePayload & { providerId: string }> {
        const parsed = await JWT.verify<IOAuthStatePayload>(stateToken);
        if (!parsed.isValid) throw new HttpUnauthorizedError();

        const { nonce, redirectUri, returnPath } = parsed.payload;
        if (!nonce || !redirectUri || !returnPath) throw new HttpUnauthorizedError();
        if (this.getCookie(request, OAUTH_STATE_COOKIE_NAME) !== nonce) throw new HttpUnauthorizedError();

        return {
            providerId: parsed.subject,
            nonce,
            redirectUri: this.validateRedirectUri(redirectUri),
            returnPath: this.normalizeReturnPath(returnPath)
        };
    }

    private validateRedirectUri(redirectUri: string): string {
        let url: URL;
        try {
            url = new URL(redirectUri);
        } catch {
            throw new HttpBadRequestError('Invalid redirectUri');
        }

        if (url.pathname !== '/login') {
            throw new HttpBadRequestError('redirectUri path must be /login');
        }

        const allowedOrigins = this.getAllowedRedirectOrigins();
        if (!allowedOrigins.has(url.origin)) {
            throw new HttpBadRequestError('redirectUri origin is not allowed');
        }

        return url.toString();
    }

    private getAllowedRedirectOrigins(): Set<string> {
        const origins = new Set<string>();

        for (const rawOrigin of (this.appConfig.OAUTH_REDIRECT_ORIGINS ?? '').split(',')) {
            const origin = rawOrigin.trim();
            if (origin) origins.add(new URL(origin).origin);
        }

        if (this.appConfig.PUBLIC_BASE_URL) {
            origins.add(new URL(this.appConfig.PUBLIC_BASE_URL).origin);
        }

        if (!origins.size) {
            throw new HttpBadRequestError('No OAuth redirect origins are configured');
        }

        return origins;
    }

    private normalizeReturnPath(returnPath: string | undefined): string {
        const path = returnPath || '/';
        if (!path.startsWith('/') || path.startsWith('//')) {
            throw new HttpBadRequestError('returnPath must be an absolute in-app path');
        }
        if (path.length > 1024) {
            throw new HttpBadRequestError('returnPath is too long');
        }

        const url = new URL(path, 'http://mobile-update-server.local');
        return `${url.pathname}${url.search}${url.hash}`;
    }

    private setOAuthStateCookie(response: HttpResponse, nonce: string, redirectUri: string) {
        response.setHeader(
            'Set-Cookie',
            `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(nonce)}; Max-Age=${OAUTH_STATE_TTL_MINS * 60}; Path=/api/session; HttpOnly; SameSite=Lax${this.isSecureRedirect(redirectUri) ? '; Secure' : ''}`
        );
    }

    private clearOAuthStateCookie(response: HttpResponse) {
        response.setHeader('Set-Cookie', `${OAUTH_STATE_COOKIE_NAME}=; Max-Age=0; Path=/api/session; HttpOnly; SameSite=Lax`);
    }

    private isSecureRedirect(redirectUri: string): boolean {
        return new URL(redirectUri).protocol === 'https:';
    }

    private getCookie(request: HttpRequest, name: string): string | null {
        const cookieHeader = request.headers.cookie;
        if (!cookieHeader) return null;

        for (const part of cookieHeader.split(';')) {
            const [rawName, ...rawValue] = part.trim().split('=');
            if (rawName === name) return decodeURIComponent(rawValue.join('='));
        }
        return null;
    }
}
