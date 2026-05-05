import { BaseAppConfig } from '@zyno-io/dk-server-foundation';

export const DEFAULT_MAX_ASSET_SIZE_BYTES = 50 * 1024 * 1024;

export class AppConfig extends BaseAppConfig {
    S3_ENDPOINT?: string;
    S3_REGION?: string;
    S3_BUCKET?: string;
    S3_ACCESS_KEY_ID?: string;
    S3_ACCESS_SECRET?: string;

    MAX_ASSET_SIZE_BYTES = DEFAULT_MAX_ASSET_SIZE_BYTES;
    PUBLIC_BASE_URL = 'http://localhost:7935';
    OAUTH_REDIRECT_ORIGINS?: string;

    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
    APPLE_LOOKUP_COUNTRY = 'us';
    STORE_VERSION_POLL_INTERVAL_MS = 60 * 60 * 1000;
}
