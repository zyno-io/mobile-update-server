import type {
    IAppDetailResponse,
    IAppListResponse,
    IBinaryBuildResponse,
    IChannelResponse,
    IMetricsResponse,
    ISessionProvider,
    ISessionResponse,
    IStoreVersionResponse,
    IUpdateAssetResponse,
    IUpdateResponse,
    IuserListResponse,
    IVcsIntegrationListResponse
} from '../../src/openapi-client-generated';

// Frozen wall-clock used by page.clock.install + all timestamps in fixtures.
// Pick a date that puts the recent activity timestamps comfortably in the past.
export const VRT_NOW = new Date('2026-04-01T15:00:00.000Z').getTime();

const APP_ID = 'app-1111-1111-1111-111111111111';
const CHANNEL_ID = 'chan-1111-1111-1111-111111111111';
const UPDATE_ID = 'upd-1111-1111-1111-111111111111';

export const ids = { appId: APP_ID, channelId: CHANNEL_ID, updateId: UPDATE_ID };

export const sessionUser: ISessionResponse = {
    id: 'usr-aaaa-bbbb-cccc-dddd',
    name: 'Casey Tester',
    isAdmin: true
};

export const providers: ISessionProvider[] = [
    { id: 'gitlab', name: 'GitLab Cloud' },
    { id: 'gitlab-self', name: 'GitLab Self-Hosted' }
];

export const apps: IAppListResponse[] = [
    {
        id: APP_ID,
        name: 'Acme Mobile',
        vcsId: 'gitlab',
        projectPath: 'acme/acme-mobile',
        vcsProjectId: 1001,
        role: 'maintainer'
    },
    {
        id: 'app-2',
        name: 'Beacon',
        vcsId: 'gitlab',
        projectPath: 'acme/beacon',
        vcsProjectId: 1002,
        role: 'developer'
    },
    {
        id: 'app-3',
        name: 'Compass',
        vcsId: 'gitlab',
        projectPath: 'acme/compass',
        vcsProjectId: 1003,
        role: 'reporter'
    }
];

export const appDetail: IAppDetailResponse = {
    id: APP_ID,
    name: 'Acme Mobile',
    vcsId: 'gitlab',
    projectPath: 'acme/acme-mobile',
    vcsProjectId: 1001,
    role: 'maintainer',
    webUrl: 'https://gitlab.example.com/acme/acme-mobile'
};

export const appMetrics: IMetricsResponse = {
    totalDevices: 12_840,
    checkedInWithinSeconds: 86_400,
    checkedInWithinCount: 11_220,
    checkedInWithinPct: 87,
    versionDistribution: [
        { updateId: UPDATE_ID, count: 9_120, pct: 71, updateLabel: 'v1.4.2', isReleased: true },
        { updateId: 'upd-2', count: 2_340, pct: 18, updateLabel: 'v1.4.1', isReleased: true },
        { updateId: null, count: 1_380, pct: 11, updateLabel: null, isReleased: false }
    ],
    platformDistribution: [
        { platform: 'ios', count: 8_320, pct: 65 },
        { platform: 'android', count: 4_520, pct: 35 }
    ],
    runtimeDistribution: [
        { runtimeVersion: '1.4.0', count: 11_460, pct: 89 },
        { runtimeVersion: '1.3.0', count: 1_380, pct: 11 }
    ]
};

export const channels: IChannelResponse[] = [
    {
        id: CHANNEL_ID,
        appId: APP_ID,
        name: 'production',
        branchName: 'main',
        iosBundleId: 'com.acme.mobile',
        androidPackageName: 'com.acme.mobile',
        iosTrackingEnabled: true,
        androidTrackingEnabled: true,
        iosNativeUpdateMode: 'after-days',
        androidNativeUpdateMode: 'none',
        iosNativeUpdateAfterDays: 14,
        androidNativeUpdateAfterDays: null,
        iosStoreUrl: null,
        androidStoreUrl: null,
        stagingMembers: [{ type: 'device', id: 'device-aaa', comment: 'lead' }],
        canaryMembers: [
            { type: 'device', id: 'device-bbb', comment: '' },
            { type: 'device', id: 'device-ccc', comment: 'beta tester' }
        ]
    },
    {
        id: 'chan-2',
        appId: APP_ID,
        name: 'staging',
        branchName: 'develop',
        iosBundleId: 'com.acme.mobile.staging',
        androidPackageName: 'com.acme.mobile.staging',
        iosTrackingEnabled: false,
        androidTrackingEnabled: false,
        iosNativeUpdateMode: 'none',
        androidNativeUpdateMode: 'none',
        iosNativeUpdateAfterDays: null,
        androidNativeUpdateAfterDays: null,
        iosStoreUrl: null,
        androidStoreUrl: null,
        stagingMembers: [],
        canaryMembers: []
    }
];

export const channelDetail: IChannelResponse = channels[0];

export const updates: IUpdateResponse[] = [
    {
        id: UPDATE_ID,
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'ios',
        runtimeVersion: '1.4.0',
        otaVersion: 'v142',
        status: 'released',
        commitHash: 'a1b2c3d4e5f6789012345678901234567890abcd',
        commitSubject: 'Fix login retry on poor connectivity',
        commitAuthor: 'Lin Ortega',
        ciJobId: 'job-9001',
        createdAt: '2026-03-30T18:21:00.000Z',
        releasedAt: '2026-03-31T09:14:00.000Z',
        supersededAt: null,
        supersededById: null
    },
    {
        id: 'upd-2',
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'android',
        runtimeVersion: '1.4.0',
        otaVersion: null,
        status: 'canary',
        commitHash: 'b2c3d4e5f6789012345678901234567890abcdef',
        commitSubject: 'Tune ProGuard rules for reanimated',
        commitAuthor: 'Sam Park',
        ciJobId: 'job-9002',
        createdAt: '2026-03-29T22:08:00.000Z',
        releasedAt: null,
        supersededAt: null,
        supersededById: null
    },
    {
        id: 'upd-3',
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'ios',
        runtimeVersion: '1.4.0',
        otaVersion: 'v141',
        status: 'released',
        commitHash: 'c3d4e5f6789012345678901234567890abcdef01',
        commitSubject: 'Localization updates for ES, PT-BR',
        commitAuthor: 'Priya Shah',
        ciJobId: 'job-9003',
        createdAt: '2026-03-28T11:42:00.000Z',
        releasedAt: '2026-03-28T13:00:00.000Z',
        supersededAt: '2026-03-31T09:14:00.000Z',
        supersededById: UPDATE_ID
    },
    {
        id: 'upd-4',
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'android',
        runtimeVersion: '1.4.0',
        otaVersion: null,
        status: 'staging',
        commitHash: 'd4e5f6789012345678901234567890abcdef0123',
        commitSubject: 'Add Firebase install ID to crash reports',
        commitAuthor: 'Sam Park',
        ciJobId: 'job-9004',
        createdAt: '2026-03-31T16:05:00.000Z',
        releasedAt: null,
        supersededAt: null,
        supersededById: null
    },
    {
        id: 'upd-5',
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'android',
        runtimeVersion: '1.4.0',
        otaVersion: 'v140',
        status: 'released',
        commitHash: 'e5f6789012345678901234567890abcdef012345',
        commitSubject: 'Bump Android target SDK to 35',
        commitAuthor: 'Priya Shah',
        ciJobId: 'job-9005',
        createdAt: '2026-03-27T09:30:00.000Z',
        releasedAt: '2026-03-27T11:00:00.000Z',
        supersededAt: null,
        supersededById: null
    },
    // Shipped against the previous binary (1.3.0). Hidden by the default "latest" filter, and
    // only visible under "All versions" or an explicit 1.3.0 selection.
    {
        id: 'upd-6',
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'ios',
        runtimeVersion: '1.3.0',
        otaVersion: 'v139',
        status: 'released',
        commitHash: 'f6789012345678901234567890abcdef01234567',
        commitSubject: 'Retry token refresh on 401',
        commitAuthor: 'Lin Ortega',
        ciJobId: 'job-9006',
        createdAt: '2026-03-10T14:20:00.000Z',
        releasedAt: '2026-03-10T15:05:00.000Z',
        supersededAt: null,
        supersededById: null
    },
    {
        id: 'upd-7',
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'android',
        runtimeVersion: '1.3.0',
        otaVersion: 'v138',
        status: 'released',
        commitHash: '789012345678901234567890abcdef0123456789',
        commitSubject: 'Cache store lookups for 24h',
        commitAuthor: 'Sam Park',
        ciJobId: 'job-9007',
        createdAt: '2026-03-09T08:45:00.000Z',
        releasedAt: '2026-03-09T10:00:00.000Z',
        supersededAt: null,
        supersededById: null
    }
];

const updateAssets: IUpdateAssetResponse[] = [
    {
        id: 'asset-1',
        key: 'ios/bundle.hbc',
        contentType: 'application/javascript',
        fileExtension: 'hbc',
        sha256: 'sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        md5: 'md5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        size: 1_482_311,
        isLaunchAsset: true,
        platform: 'ios'
    },
    {
        id: 'asset-2',
        key: 'all/icon.png',
        contentType: 'image/png',
        fileExtension: 'png',
        sha256: 'sha-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        md5: 'md5bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        size: 24_192,
        isLaunchAsset: false,
        platform: 'all'
    },
    {
        id: 'asset-3',
        key: 'all/splash.png',
        contentType: 'image/png',
        fileExtension: 'png',
        sha256: 'sha-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        md5: 'md5cccccccccccccccccccccccccccccc',
        size: 188_044,
        isLaunchAsset: false,
        platform: 'all'
    }
];

export const updateDetail = {
    ...updates[0],
    assets: updateAssets
};

export const updateMetrics = {
    totalDevicesOnChannel: 12_840,
    devicesOnUpdate: 9_120,
    pct: 71
};

export const latestBinaries: Record<'ios' | 'android', IBinaryBuildResponse> = {
    ios: {
        id: 'bb-ios-1',
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'ios',
        binaryVersion: '1.4.0',
        fingerprint: 'fp-ios-9b8a7c6d5e4f3a2b1',
        commitHash: 'a1b2c3d4e5f6789012345678901234567890abcd',
        commitSubject: 'Fix login retry on poor connectivity',
        commitAuthor: 'Lin Ortega',
        ciJobId: 'job-9001',
        createdAt: '2026-03-25T08:00:00.000Z'
    },
    android: {
        id: 'bb-and-1',
        appId: APP_ID,
        channelId: CHANNEL_ID,
        platform: 'android',
        binaryVersion: '1.4.0',
        fingerprint: 'fp-and-1a2b3c4d5e6f7g8h9',
        commitHash: 'b2c3d4e5f6789012345678901234567890abcdef',
        commitSubject: 'Tune ProGuard rules for reanimated',
        commitAuthor: 'Sam Park',
        ciJobId: 'job-9002',
        createdAt: '2026-03-26T11:30:00.000Z'
    }
};

/** Newest-built first, matching what GET binary-builds/versions returns. */
export const binaryVersions: Record<'ios' | 'android', string[]> = {
    ios: ['1.4.0', '1.3.0'],
    android: ['1.4.0', '1.3.0']
};

/**
 * Build history per platform, newest first. iOS 1.4.0 appears twice — a rebuild produced a second
 * fingerprint for the same binary version, which is exactly why a version maps to a *set* of
 * fingerprints server-side.
 */
export const binaryBuilds: Record<'ios' | 'android', IBinaryBuildResponse[]> = {
    ios: [
        latestBinaries.ios,
        {
            id: 'bb-ios-2',
            appId: APP_ID,
            channelId: CHANNEL_ID,
            platform: 'ios',
            binaryVersion: '1.4.0',
            fingerprint: 'fp-ios-4d3c2b1a0f9e8d7c6',
            commitHash: 'c3d4e5f6789012345678901234567890abcdef01',
            commitSubject: 'Localization updates for ES, PT-BR',
            commitAuthor: 'Priya Shah',
            ciJobId: 'job-8804',
            createdAt: '2026-03-22T16:40:00.000Z'
        },
        {
            id: 'bb-ios-3',
            appId: APP_ID,
            channelId: CHANNEL_ID,
            platform: 'ios',
            binaryVersion: '1.3.0',
            fingerprint: 'fp-ios-1f2e3d4c5b6a79808',
            commitHash: 'f6789012345678901234567890abcdef01234567',
            commitSubject: 'Retry token refresh on 401',
            commitAuthor: 'Lin Ortega',
            ciJobId: 'job-8712',
            createdAt: '2026-03-05T09:15:00.000Z'
        }
    ],
    android: [
        latestBinaries.android,
        {
            id: 'bb-and-2',
            appId: APP_ID,
            channelId: CHANNEL_ID,
            platform: 'android',
            binaryVersion: '1.3.0',
            fingerprint: 'fp-and-9h8g7f6e5d4c3b2a1',
            commitHash: '789012345678901234567890abcdef0123456789',
            commitSubject: 'Cache store lookups for 24h',
            commitAuthor: 'Sam Park',
            ciJobId: 'job-8715',
            createdAt: '2026-03-06T13:05:00.000Z'
        }
    ]
};

export const latestStoreVersions: Record<'ios' | 'android', IStoreVersionResponse> = {
    ios: {
        platform: 'ios',
        version: '1.4.0',
        firstDetectedAt: '2026-03-15T14:22:00.000Z',
        nativeUpdateRequiredAt: '2026-03-29T14:22:00.000Z'
    },
    android: {
        platform: 'android',
        version: '1.4.0',
        firstDetectedAt: '2026-03-28T09:11:00.000Z',
        nativeUpdateRequiredAt: null
    }
};

export const adminUsers: IuserListResponse[] = [
    {
        id: 'usr-aaaa-bbbb-cccc-dddd',
        name: 'Casey Tester',
        isAdmin: true,
        createdAt: '2025-09-01T10:00:00.000Z',
        lastLoginAt: '2026-04-01T12:30:00.000Z',
        vcsName: 'GitLab Cloud'
    },
    {
        id: 'usr-2222',
        name: 'Lin Ortega',
        isAdmin: false,
        createdAt: '2025-10-12T08:14:00.000Z',
        lastLoginAt: '2026-03-30T17:02:00.000Z',
        vcsName: 'GitLab Cloud'
    },
    {
        id: 'usr-3333',
        name: 'Sam Park',
        isAdmin: false,
        createdAt: '2025-11-04T14:51:00.000Z',
        lastLoginAt: '2026-03-29T22:18:00.000Z',
        vcsName: 'GitLab Self-Hosted'
    },
    {
        id: 'usr-4444',
        name: 'Priya Shah',
        isAdmin: true,
        createdAt: '2025-08-20T09:33:00.000Z',
        lastLoginAt: '2026-03-31T08:47:00.000Z',
        vcsName: 'GitLab Cloud'
    }
];

export const vcsIntegrations: IVcsIntegrationListResponse[] = [
    { id: 'vcs-cloud', name: 'GitLab Cloud', platform: 'gitlab' },
    { id: 'vcs-self', name: 'GitLab Self-Hosted', platform: 'gitlab' }
];
