import assert from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readExpoExport } from './expo-export.js';

test('readExpoExport deduplicates repeated asset metadata entries', async () => {
    const distDir = await writeExpoExport([
        { path: 'assets/shared', ext: 'png' },
        { path: 'assets/shared', ext: 'png' },
        { path: 'assets/other', ext: 'ttf' }
    ]);

    try {
        const exported = await readExpoExport(distDir, undefined, 'ios');

        assert.deepStrictEqual(
            exported.assets.map(asset => asset.key),
            ['_expo/static/js/ios/entry.hbc', 'assets/shared', 'assets/other']
        );
    } finally {
        await rm(distDir, { recursive: true, force: true });
    }
});

test('readExpoExport rejects duplicate asset keys with conflicting metadata', async () => {
    const distDir = await writeExpoExport([
        { path: 'assets/shared', ext: 'png' },
        { path: 'assets/shared', ext: 'jpg' }
    ]);

    try {
        await assert.rejects(() => readExpoExport(distDir, undefined, 'ios'), /conflicting duplicate asset ios\/assets\/shared/);
    } finally {
        await rm(distDir, { recursive: true, force: true });
    }
});

async function writeExpoExport(assets: { path: string; ext: string }[]): Promise<string> {
    const distDir = await mkdtemp(join(tmpdir(), 'mus-expo-export-'));

    await writeFile(
        join(distDir, 'metadata.json'),
        JSON.stringify({
            version: 0,
            bundler: 'metro',
            fileMetadata: {
                ios: {
                    bundle: '_expo/static/js/ios/entry.hbc',
                    assets
                }
            }
        })
    );
    await writeFile(join(distDir, 'expoConfig.json'), JSON.stringify({ runtimeVersion: '1.0.0' }));

    return distDir;
}
