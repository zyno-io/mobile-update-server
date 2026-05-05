#!/usr/bin/env node
import type { TargetPlatform } from './api.js';

import { parseFlags } from './args.js';
import { getJobInfo } from './ci.js';
import { runPromote } from './commands/promote.js';
import { runPublish } from './commands/publish.js';
import { runRecordBinary } from './commands/record-binary.js';
import { AppError, handleError } from './error.js';

process.on('unhandledRejection', handleError);
process.on('uncaughtException', handleError);

const HELP = `Usage:
  mobile-update publish [<dist-path>] --platform=<ios|android> [--runtime-version=<v>] [--ota-version=<v>]
      Upload an OTA update from an expo-export directory.
      Defaults to ./dist (or MUS_DIST_PATH).
      --platform selects which platform from the export to publish.
      --runtime-version overrides expo.runtimeVersion (or MUS_RUNTIME_VERSION).
      --ota-version attaches a human-readable version (e.g. v42) shown in the UI.
        Falls back to MUS_OTA_VERSION env var.

  mobile-update record-binary --platform=<ios|android> --binary-version=<v> --fingerprint=<fp>
      Record that a new native binary has been published.
      Falls back to MUS_PLATFORM / MUS_BINARY_VERSION / MUS_FINGERPRINT env vars.

  mobile-update promote [--update-id=<id>] [--target=<canary|released>]
      Promote staging/canary updates for the current CI commit one tier (default)
      or jump straight to a specific target.
      Optional --update-id / MUS_UPDATE_ID targets one update explicitly.
      Optional --target / MUS_PROMOTE_TARGET = canary | released.

Required environment in all modes:
  MUS_SERVER_URL    base URL of the update server
  MUS_APP_ID        app UUID (from the UI)
  MUS_CHANNEL_ID    channel UUID (from the UI)
  CI_JOB_TOKEN      injected by GitLab CI
  CI_PROJECT_URL    injected by GitLab CI`;

const [, , subcommand, ...rest] = process.argv;

if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(HELP);
    process.exit(subcommand ? 0 : 1);
}

if (subcommand !== 'publish' && subcommand !== 'record-binary' && subcommand !== 'promote') {
    console.error(`Unknown subcommand: ${subcommand}\n`);
    console.error(HELP);
    process.exit(1);
}

const serverUrl = process.env.MUS_SERVER_URL;
const appId = process.env.MUS_APP_ID;
const channelId = process.env.MUS_CHANNEL_ID;

if (!serverUrl) throw new AppError('MUS_SERVER_URL environment variable is not set');
if (!appId) throw new AppError('MUS_APP_ID environment variable is not set');
if (!channelId) throw new AppError('MUS_CHANNEL_ID environment variable is not set (find it in the UI)');

const jobInfo = getJobInfo();
if (!jobInfo) throw new AppError('No CI job info found. Run inside GitLab CI (CI_JOB_TOKEN + CI_PROJECT_URL).');

if (subcommand === 'publish') {
    const { positional, flags } = parseFlags(rest);
    const distPath = positional[0] ?? process.env.MUS_DIST_PATH ?? './dist';
    if (flags['runtime-version'] === 'true') {
        // parseFlags returns 'true' for bare value-less --flag; for runtime-version that's almost
        // certainly user error (forgot the value or used the next-flag form without `=`).
        throw new AppError('--runtime-version requires a value, e.g. --runtime-version=1.0.0');
    }
    if (flags['ota-version'] === 'true') {
        throw new AppError('--ota-version requires a value, e.g. --ota-version=v42');
    }
    const runtimeVersion = flags['runtime-version'] ?? process.env.MUS_RUNTIME_VERSION;
    const otaVersion = flags['ota-version'] ?? process.env.MUS_OTA_VERSION;
    const platform = parsePlatform(flags.platform ?? process.env.MUS_PLATFORM);
    await runPublish({ serverUrl, appId, channelId, distPath, runtimeVersion, otaVersion, platform, jobInfo });
} else if (subcommand === 'record-binary') {
    const { flags } = parseFlags(rest);
    const platform = parsePlatform(flags.platform ?? process.env.MUS_PLATFORM);
    const binaryVersion = flags['binary-version'] ?? process.env.MUS_BINARY_VERSION ?? '';
    const fingerprint = flags['fingerprint'] ?? process.env.MUS_FINGERPRINT ?? '';
    await runRecordBinary({
        serverUrl,
        appId,
        channelId,
        platform,
        binaryVersion,
        fingerprint,
        jobInfo
    });
} else {
    const { flags } = parseFlags(rest);
    const updateId = flags['update-id'] ?? process.env.MUS_UPDATE_ID ?? '';
    const target = parsePromoteTarget(flags['target'] ?? process.env.MUS_PROMOTE_TARGET);
    await runPromote({ serverUrl, appId, channelId, updateId, target, jobInfo });
}

function parsePlatform(value: string | undefined): TargetPlatform {
    if (value === 'ios' || value === 'android') return value;
    throw new AppError('--platform is required and must be ios or android');
}

function parsePromoteTarget(value: string | undefined): 'canary' | 'released' | undefined {
    if (value === undefined || value === '') return undefined;
    if (value === 'canary' || value === 'released') return value;
    throw new AppError('--target must be canary or released');
}
