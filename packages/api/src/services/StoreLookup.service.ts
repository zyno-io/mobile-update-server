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
        const publisher = google.androidpublisher({ version: 'v3', auth });

        let editId: string | undefined;
        try {
            const edit = await publisher.edits.insert({ packageName });
            editId = edit.data.id ?? undefined;
            if (!editId) {
                this.logger.warn(`Google Play edits.insert returned no id for ${packageName}`);
                return null;
            }

            const track = await publisher.edits.tracks.get({
                packageName,
                editId,
                track: 'production'
            });

            const releases = track.data.releases ?? [];
            const versionName = pickProductionVersionName(releases);
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
        } finally {
            if (editId) {
                try {
                    await publisher.edits.delete({ packageName, editId });
                } catch {
                    // Edits expire on their own; not worth surfacing.
                }
            }
        }
    }
}

interface IGoogleRelease {
    name?: string | null;
    status?: string | null;
    versionCodes?: string[] | null;
}

function pickProductionVersionName(releases: IGoogleRelease[]): string | undefined {
    const completed = releases.filter(r => r.status === 'completed' && r.versionCodes?.length);
    const pool = completed.length ? completed : releases.filter(r => r.versionCodes?.length);
    if (!pool.length) return undefined;

    let best: { release: IGoogleRelease; versionCode: number } | undefined;
    for (const release of pool) {
        for (const code of release.versionCodes ?? []) {
            const n = Number(code);
            if (!Number.isFinite(n)) continue;
            if (!best || n > best.versionCode) best = { release, versionCode: n };
        }
    }
    return best?.release.name?.trim() || undefined;
}
