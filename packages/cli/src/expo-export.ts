import { readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import type { TargetPlatform } from './api.js';

import { AppError } from './error.js';

export interface IExpoFileMetadata {
    bundle: string;
    assets: { path: string; ext: string }[];
}

export interface IExpoMetadata {
    version: number;
    bundler: string;
    fileMetadata: {
        ios?: IExpoFileMetadata;
        android?: IExpoFileMetadata;
    };
}

export interface ICollectedAsset {
    absolutePath: string;
    /** Cache key for the Expo client; relative path within the export. */
    key: string;
    fileExtension: string;
    platform: 'ios' | 'android';
    isLaunchAsset: boolean;
}

export async function readExpoExport(
    distDir: string,
    runtimeVersionOverride?: string,
    platformOverride?: TargetPlatform
): Promise<{
    metadata: IExpoMetadata;
    expoConfig: Record<string, unknown>;
    runtimeVersion: string;
    platform: TargetPlatform;
    assets: ICollectedAsset[];
}> {
    const metadataPath = join(distDir, 'metadata.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf-8')) as IExpoMetadata;

    const expoConfigPath = join(distDir, 'expoConfig.json');
    let expoConfig: Record<string, unknown> = {};
    try {
        expoConfig = JSON.parse(await readFile(expoConfigPath, 'utf-8'));
    } catch {
        // expoConfig.json is not always emitted; fall back to app.json's expo field
        try {
            const appJson = JSON.parse(await readFile(join(distDir, '..', 'app.json'), 'utf-8'));
            expoConfig = appJson.expo ?? appJson;
        } catch {
            if (!runtimeVersionOverride) {
                throw new AppError('Could not find expoConfig.json in dist or app.json next to it. Pass --runtime-version to override.');
            }
        }
    }

    const runtimeVersion = runtimeVersionOverride ?? expoConfig.runtimeVersion;
    if (typeof runtimeVersion !== 'string' || !runtimeVersion) {
        throw new AppError(
            'Could not determine runtimeVersion. Expo should resolve `expo.runtimeVersion` to a string at export time; if your config uses a policy object (e.g. { policy: "appVersion" }), pass --runtime-version=<value> explicitly.'
        );
    }

    const availablePlatforms = (['ios', 'android'] as const).filter(platform => metadata.fileMetadata[platform]);
    const selectedPlatform = platformOverride ?? (availablePlatforms.length === 1 ? availablePlatforms[0] : undefined);
    if (!selectedPlatform) {
        throw new AppError('Expo export contains multiple platforms. Pass --platform=ios or --platform=android.');
    }
    if (!metadata.fileMetadata[selectedPlatform]) {
        throw new AppError(`Expo export does not contain ${selectedPlatform} assets. Run 'expo export --platform ${selectedPlatform}'.`);
    }

    const assets: ICollectedAsset[] = [];
    for (const platform of [selectedPlatform] as const) {
        const fm = metadata.fileMetadata[platform];
        if (!fm) continue;

        assets.push({
            absolutePath: join(distDir, fm.bundle),
            key: relative(distDir, join(distDir, fm.bundle)).replace(/\\/g, '/'),
            fileExtension: extname(fm.bundle).replace(/^\./, '') || 'bundle',
            platform,
            isLaunchAsset: true
        });

        for (const asset of fm.assets) {
            assets.push({
                absolutePath: join(distDir, asset.path),
                key: asset.path.replace(/\\/g, '/'),
                fileExtension: asset.ext,
                platform,
                isLaunchAsset: false
            });
        }
    }

    if (assets.length === 0) {
        throw new AppError(`No assets found under ${distDir}. Did you run 'expo export'?`);
    }

    return {
        metadata: metadata as unknown as Record<string, unknown>,
        expoConfig,
        runtimeVersion,
        platform: selectedPlatform,
        assets
    } as unknown as {
        metadata: IExpoMetadata;
        expoConfig: Record<string, unknown>;
        runtimeVersion: string;
        platform: TargetPlatform;
        assets: ICollectedAsset[];
    };
}
