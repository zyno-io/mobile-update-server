import { ScopedLogger } from '@deepkit/logger';
import { google } from 'googleapis';

import { AppConfig } from '../config';

export interface IStoreVersionLookupResult {
    version: string;
    storeUrl: string | null;
}

export class StoreLookupService {
    private androidWarningLogged = false;

    constructor(
        private appConfig: AppConfig,
        private logger: ScopedLogger
    ) {}

    isAndroidConfigured(): boolean {
        return !!this.appConfig.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
    }

    async lookupApple(bundleId: string): Promise<IStoreVersionLookupResult | null> {
        const country = encodeURIComponent(this.appConfig.APPLE_LOOKUP_COUNTRY || 'us');
        const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=${country}`;

        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
            this.logger.warn(`Apple lookup for ${bundleId} returned ${response.status}`);
            return null;
        }

        const body = (await response.json()) as { results?: Array<{ version?: string; trackViewUrl?: string }> };
        const result = body.results?.[0];
        if (!result?.version) return null;

        return { version: result.version, storeUrl: result.trackViewUrl?.trim() || null };
    }

    async lookupGooglePlay(packageName: string): Promise<IStoreVersionLookupResult | null> {
        if (!this.isAndroidConfigured()) {
            if (!this.androidWarningLogged) {
                this.logger.warn('Google Play tracking requested but GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured; skipping');
                this.androidWarningLogged = true;
            }
            return null;
        }

        let credentials: Record<string, unknown>;
        try {
            credentials = JSON.parse(this.appConfig.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON!);
        } catch {
            this.logger.error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON');
            return null;
        }

        const auth = new google.auth.GoogleAuth({
            credentials: credentials as never,
            scopes: ['https://www.googleapis.com/auth/androidpublisher']
        });

        try {
            const response = await auth.request<IGoogleReleaseSummariesResponse>({
                method: 'GET',
                url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/tracks/production/releases`
            });

            const versionName = pickPublishedVersionName(response.data.releases ?? []);
            if (!versionName) return null;

            return {
                version: versionName,
                storeUrl: `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`
            };
        } catch (err) {
            const status = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
            if (status === 404) return null;
            this.logger.warn(`Google Play lookup for ${packageName} failed: ${(err as Error).message}`);
            return null;
        }
    }
}

interface IGoogleReleaseSummariesResponse {
    releases?: IGoogleReleaseSummary[] | null;
}

interface IGoogleReleaseSummary {
    releaseName?: string | null;
    releaseLifecycleState?: string | null;
    activeArtifacts?: Array<{ versionCode?: number | string | null }> | null;
}

function pickPublishedVersionName(releases: IGoogleReleaseSummary[]): string | undefined {
    let best: { release: IGoogleReleaseSummary; versionCode: number } | undefined;
    for (const release of releases) {
        if (release.releaseLifecycleState !== 'RELEASE_LIFECYCLE_STATE_PUBLISHED') continue;
        for (const artifact of release.activeArtifacts ?? []) {
            const n = Number(artifact.versionCode);
            if (!Number.isFinite(n)) continue;
            if (!best || n > best.versionCode) best = { release, versionCode: n };
        }
    }
    return normalizeGooglePlayReleaseName(best?.release.releaseName);
}

function normalizeGooglePlayReleaseName(releaseName: string | null | undefined): string | undefined {
    const trimmed = releaseName?.trim();
    if (!trimmed) return undefined;

    const generatedName = trimmed.match(/^\d+\s+\(([^()]+)\)$/);
    return generatedName?.[1].trim() || trimmed;
}
