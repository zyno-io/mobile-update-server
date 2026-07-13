import type { Page } from '@playwright/test';

import { statSync } from 'node:fs';

import {
    adminUsers,
    appDetail,
    appMetrics,
    apps,
    binaryBuilds,
    binaryVersions,
    channelDetail,
    channels,
    ids,
    latestBinaries,
    latestStoreVersions,
    providers,
    sessionUser,
    updateDetail,
    updateMetrics,
    updates,
    vcsIntegrations
} from './fixtures';

const FAKE_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ2cnQifQ.';
const THEME_OVERRIDE_KEY = 'mus:theme';

/** Wrap page.route() in a small JSON-fulfilling helper. */
export async function json(page: Page, urlPattern: string | RegExp, body: unknown, status = 200): Promise<void> {
    await page.route(urlPattern, route =>
        route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body)
        })
    );
}

/**
 * Bootstrap auth: stamp the JWT key the app reads from localStorage and force light theme
 * before any navigation, so the layout renders in a deterministic palette.
 */
export async function setupAuth(page: Page): Promise<void> {
    await page.addInitScript(
        ([jwtKey, jwt, themeKey]) => {
            try {
                window.localStorage.setItem(jwtKey, jwt);
                window.localStorage.setItem(themeKey, 'light');
            } catch {
                /* localStorage unavailable in some test contexts */
            }
        },
        ['mus:jwt', FAKE_JWT, THEME_OVERRIDE_KEY]
    );
}

/** Mocks every endpoint app.vue and the layout fire on load — must run on every test. */
export async function setupBaseMocks(page: Page): Promise<void> {
    await json(page, '**/api/session/onboarding-status', { isOnboarded: true });
    await json(page, '**/api/session/me', sessionUser);
    await json(page, '**/api/session/providers', providers);
}

export async function mockLoginRoutes(page: Page): Promise<void> {
    // Login.vue calls getSessionGetProviders directly. setupBaseMocks already covers it.
    await json(page, '**/api/session/providers', providers);
}

export async function mockAppsRoutes(page: Page): Promise<void> {
    await json(page, '**/api/apps', apps);
}

export async function mockAppDetailRoutes(page: Page): Promise<void> {
    await json(page, `**/api/apps/${ids.appId}`, appDetail);
    await json(page, `**/api/apps/${ids.appId}/channels`, channels);
    await json(page, new RegExp(`/api/apps/${ids.appId}/metrics(\\?.*)?$`), appMetrics);
}

export async function mockChannelDetailRoutes(page: Page): Promise<void> {
    await mockAppDetailRoutes(page);
    await json(page, `**/api/apps/${ids.appId}/channels/${ids.channelId}`, channelDetail);

    // Must be a RegExp, not a glob: the channel screen now appends ?platform=&binaryVersion=, and a
    // glob without a query segment would stop matching. The trailing (\?.*)?$ also keeps this from
    // swallowing /updates/{id}, which mockUpdateDetailRoutes owns.
    await page.route(new RegExp(`/api/apps/${ids.appId}/channels/${ids.channelId}/updates(\\?.*)?$`), route => {
        const params = new URL(route.request().url()).searchParams;
        const platform = params.get('platform');
        const binaryVersion = params.get('binaryVersion');

        // The real server maps binaryVersion → the build's fingerprints → matching runtimeVersions.
        // These fixtures use the appVersion-policy shape (runtimeVersion === binaryVersion), so a
        // direct comparison stands in for that join.
        const filtered = updates.filter(u => (!platform || u.platform === platform) && (!binaryVersion || u.runtimeVersion === binaryVersion));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(filtered) });
    });

    await page.route(new RegExp(`/api/apps/${ids.appId}/channels/${ids.channelId}/binary-builds/versions(\\?.*)?$`), route => {
        const platform = new URL(route.request().url()).searchParams.get('platform') as 'ios' | 'android' | null;
        const versions = platform ? (binaryVersions[platform] ?? []) : [];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions }) });
    });

    await page.route(new RegExp(`/api/apps/${ids.appId}/channels/${ids.channelId}/binary-builds(\\?.*)?$`), route => {
        const platform = new URL(route.request().url()).searchParams.get('platform') as 'ios' | 'android' | null;
        const builds = platform ? (binaryBuilds[platform] ?? []) : [];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(builds) });
    });

    await page.route(new RegExp(`/api/apps/${ids.appId}/channels/${ids.channelId}/binary-builds/latest(\\?.*)?$`), route => {
        const platform = new URL(route.request().url()).searchParams.get('platform') as 'ios' | 'android' | null;
        const latest = platform ? (latestBinaries[platform] ?? null) : null;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ latest })
        });
    });
    await page.route(new RegExp(`/api/apps/${ids.appId}/channels/${ids.channelId}/store-versions/latest(\\?.*)?$`), route => {
        const platform = new URL(route.request().url()).searchParams.get('platform') as 'ios' | 'android' | null;
        const latest = platform ? (latestStoreVersions[platform] ?? null) : null;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ latest })
        });
    });
}

export async function mockUpdateDetailRoutes(page: Page): Promise<void> {
    // The update page now loads app detail too so it can build VCS commit links.
    await json(page, `**/api/apps/${ids.appId}`, appDetail);
    await json(page, `**/api/apps/${ids.appId}/channels/${ids.channelId}/updates/${ids.updateId}`, updateDetail);
    await json(page, `**/api/apps/${ids.appId}/metrics/updates/${ids.updateId}`, updateMetrics);
}

export async function mockAdminUsersRoutes(page: Page): Promise<void> {
    await json(page, '**/api/admin/users', adminUsers);
}

export async function mockAdminVcsRoutes(page: Page): Promise<void> {
    await json(page, '**/api/admin/vcs-integrations', vcsIntegrations);
}

/**
 * Catch blank/black screenshots before they pollute baselines. A fully-rendered page
 * with content is reliably > 10kB; a blank white page is < 5kB.
 */
export function expectMinScreenshotSize(path: string, minBytes: number): void {
    const size = statSync(path).size;
    if (size < minBytes) {
        throw new Error(
            `Screenshot too small: ${path} is ${size} bytes (min ${minBytes}). ` +
                'This usually means the page rendered blank or the layout failed to hydrate.'
        );
    }
}
