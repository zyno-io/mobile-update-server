import type { ICIJobInfo } from '../ci.js';

import { MobileUpdateApi } from '../api.js';
import { buildUpdateUrl } from '../urls.js';

export interface PromoteOptions {
    serverUrl: string;
    appId: string;
    channelId: string;
    updateId: string;
    target?: 'canary' | 'released';
    jobInfo: ICIJobInfo;
}

export async function runPromote(opts: PromoteOptions): Promise<void> {
    const api = new MobileUpdateApi(opts.serverUrl, opts.appId, opts.channelId, opts.jobInfo);
    const targetLabel = opts.target ?? 'next tier';

    if (opts.updateId) {
        console.log(`Promoting update ${opts.updateId} to ${targetLabel}...`);
        const update = await api.promoteUpdate(opts.updateId, opts.target);
        console.log(`\n✓ Update ${update.id} promoted (status: ${update.status}).`);
        console.log(`  ${buildUpdateUrl(opts.serverUrl, opts.appId, opts.channelId, update.id)}`);
        return;
    }

    console.log(`Promoting updates from the current CI commit to ${targetLabel}...`);
    const updates = await api.promoteCurrentCommit(opts.target);

    if (updates.length === 1) {
        const [update] = updates;
        console.log(`\n✓ Update ${update.id} promoted (status: ${update.status}).`);
        console.log(`  ${buildUpdateUrl(opts.serverUrl, opts.appId, opts.channelId, update.id)}`);
        return;
    }

    console.log(`\n✓ Promoted ${updates.length} updates:`);
    for (const update of updates) {
        console.log(`  - ${update.platform}: ${update.id} (${update.status})`);
        console.log(`    ${buildUpdateUrl(opts.serverUrl, opts.appId, opts.channelId, update.id)}`);
    }
}
