import { existsSync } from 'node:fs';

import type { TargetPlatform } from '../api.js';
import type { ICIJobInfo } from '../ci.js';

import { MobileUpdateApi } from '../api.js';
import { AppError } from '../error.js';
import { readExpoExport } from '../expo-export.js';
import { buildUpdateUrl } from '../urls.js';

export interface PublishOptions {
    serverUrl: string;
    appId: string;
    channelId: string;
    distPath: string;
    runtimeVersion?: string;
    otaVersion?: string;
    platform?: TargetPlatform;
    jobInfo: ICIJobInfo;
}

export async function runPublish(opts: PublishOptions): Promise<void> {
    if (!existsSync(opts.distPath)) {
        throw new AppError(`Dist path "${opts.distPath}" does not exist. Run 'expo export' first.`);
    }

    console.log(`Reading expo export from ${opts.distPath}...`);
    const exported = await readExpoExport(opts.distPath, opts.runtimeVersion, opts.platform);
    console.log(`  runtimeVersion: ${exported.runtimeVersion}`);
    if (opts.otaVersion) console.log(`  otaVersion: ${opts.otaVersion}`);
    console.log(`  platform: ${exported.platform}`);
    console.log(`  ${exported.assets.length} assets`);

    const api = new MobileUpdateApi(opts.serverUrl, opts.appId, opts.channelId, opts.jobInfo);

    let updateId: string | undefined;

    try {
        console.log('\nCreating update...');
        const update = await api.createUpdate({
            runtimeVersion: exported.runtimeVersion,
            otaVersion: opts.otaVersion ?? null,
            platform: exported.platform,
            expoConfig: exported.expoConfig,
            metadata: exported.metadata as unknown as Record<string, unknown>
        });
        updateId = update.id;
        console.log(`Update ${update.id} created (status: ${update.status})`);

        for (const asset of exported.assets) {
            const label = `${asset.platform}/${asset.key}${asset.isLaunchAsset ? ' (launch)' : ''}`;
            console.log(`Uploading ${label}...`);
            await api.uploadAsset(update.id, {
                filePath: asset.absolutePath,
                key: asset.key,
                platform: asset.platform,
                isLaunchAsset: asset.isLaunchAsset,
                fileExtension: asset.fileExtension
            });
        }

        console.log('\nFinalizing update...');
        const finalized = await api.finalize(update.id);

        const updateUrl = buildUpdateUrl(opts.serverUrl, opts.appId, opts.channelId, update.id);
        if (finalized.status === 'released') {
            console.log(`\n✓ Update ${update.id} finalized and released.`);
        } else {
            console.log(`\n✓ Update ${update.id} finalized as ${finalized.status}.`);
            if (finalized.status === 'staging' || finalized.status === 'canary') {
                console.log("  Promote to the next tier from the UI when you're ready.");
            }
        }
        console.log(`  ${updateUrl}`);
    } catch (err) {
        if (updateId) {
            try {
                console.warn(`\nPublish failed; canceling draft update ${updateId}...`);
                await api.cancelDraft(updateId);
            } catch (cancelErr) {
                console.warn(`Could not cancel draft update ${updateId}: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`);
            }
        }
        throw err;
    }
}
