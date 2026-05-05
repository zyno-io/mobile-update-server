import type { TargetPlatform } from '../api.js';
import type { ICIJobInfo } from '../ci.js';

import { MobileUpdateApi } from '../api.js';
import { AppError } from '../error.js';

export interface RecordBinaryOptions {
    serverUrl: string;
    appId: string;
    channelId: string;
    platform: TargetPlatform;
    binaryVersion: string;
    fingerprint: string;
    jobInfo: ICIJobInfo;
}

export async function runRecordBinary(opts: RecordBinaryOptions): Promise<void> {
    if (!opts.binaryVersion) throw new AppError('binary version is required (--binary-version or MUS_BINARY_VERSION)');
    if (!opts.fingerprint) throw new AppError('fingerprint is required (--fingerprint or MUS_FINGERPRINT)');

    const api = new MobileUpdateApi(opts.serverUrl, opts.appId, opts.channelId, opts.jobInfo);

    console.log(`Recording ${opts.platform} binary build v${opts.binaryVersion} (fingerprint: ${opts.fingerprint})...`);
    const build = await api.recordBinaryBuild({
        platform: opts.platform,
        binaryVersion: opts.binaryVersion,
        fingerprint: opts.fingerprint
    });

    console.log(`\n✓ Binary build ${build.id} recorded.`);
}
