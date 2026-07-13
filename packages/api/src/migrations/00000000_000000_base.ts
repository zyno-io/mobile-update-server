import { createMigration } from '@zyno-io/ts-server-foundation';

export default createMigration(async db => {
    await db.schema.create('apps', t => {
        t.uuidString('id').primary();
        t.string('name', 255);
        t.uuidString('vcsId');
        t.string('projectPath', 255);
        t.integer('vcsProjectId').unsigned();
        t.dateTime('createdAt');
        t.dateTime('deletedAt').nullable();
    });

    await db.schema.create('binaryBuilds', t => {
        t.uuidString('id').primary();
        t.uuidString('appId');
        t.uuidString('channelId');
        t.enum('platform', ['ios', 'android']);
        t.string('binaryVersion', 255);
        t.string('fingerprint', 255);
        t.string('commitHash', 255);
        t.string('commitSubject', 255);
        t.string('commitAuthor', 255);
        t.string('ciJobId', 255);
        t.dateTime('createdAt');
        t.index(['channelId', 'platform', 'id'], 'binaryBuilds_channel_platform_idx');
    });

    await db.schema.create('channels', t => {
        t.uuidString('id').primary();
        t.uuidString('appId');
        t.string('name', 255);
        t.string('branchName', 255);
        t.string('iosBundleId', 255).nullable();
        t.string('androidPackageName', 255).nullable();
        t.boolean('iosTrackingEnabled');
        t.boolean('androidTrackingEnabled');
        t.dateTime('iosNativeUpdateRequiredAt').nullable();
        t.dateTime('androidNativeUpdateRequiredAt').nullable();
        t.string('iosStoreUrl', 255).nullable();
        t.string('androidStoreUrl', 255).nullable();
        t.json('stagingMembers').nullable();
        t.json('canaryMembers');
        t.dateTime('createdAt');
        t.dateTime('deletedAt').nullable();
    });

    await db.schema.create('deviceStates', t => {
        t.uuidString('id').primary();
        t.uuidString('appId');
        t.uuidString('channelId');
        t.string('deviceId', 255);
        t.enum('platform', ['ios', 'android']);
        t.string('runtimeVersion', 255);
        t.uuidString('currentUpdateId').nullable();
        t.dateTime('lastCheckInAt');
        t.unique(['appId', 'channelId', 'deviceId'], 'deviceStates_app_channel_device_idx');
    });

    await db.schema.create('storeVersions', t => {
        t.uuidString('id').primary();
        t.uuidString('appId');
        t.uuidString('channelId');
        t.enum('platform', ['ios', 'android']);
        t.string('version', 255);
        t.dateTime('firstDetectedAt');
    });

    await db.schema.create('updates', t => {
        t.uuidString('id').primary();
        t.uuidString('appId');
        t.uuidString('channelId');
        t.enum('platform', ['ios', 'android']);
        t.string('runtimeVersion', 255);
        t.string('otaVersion', 255).nullable();
        t.enum('status', ['draft', 'staging', 'canary', 'released', 'canceled', 'rolled-back']);
        t.string('commitHash', 255);
        t.string('commitSubject', 255);
        t.string('commitAuthor', 255);
        t.string('ciJobId', 255);
        t.string('ciTokenHash', 255).nullable();
        t.json('expoConfigJson').nullable();
        t.json('metadataJson').nullable();
        t.dateTime('createdAt');
        t.dateTime('releasedAt').nullable();
        t.uuidString('promotedById').nullable();
        t.dateTime('supersededAt').nullable();
        t.uuidString('supersededById').nullable();
        t.index(['channelId', 'platform', 'runtimeVersion', 'status', 'id'], 'updates_channel_platform_runtime_idx');
    });

    await db.schema.create('updateAssets', t => {
        t.uuidString('id').primary();
        t.uuidString('appId');
        t.uuidString('updateId');
        t.string('key', 255);
        t.string('contentType', 255);
        t.string('fileExtension', 255);
        t.string('sha256', 255);
        t.string('md5', 255);
        t.integer('size');
        t.boolean('isLaunchAsset');
        t.enum('platform', ['ios', 'android', 'all']);
        t.string('s3Key', 255);
        t.unique(['updateId', 'key', 'platform'], 'updateAssets_dedup_uidx');
    });

    await db.schema.create('users', t => {
        t.uuidString('id').primary();
        t.uuidString('vcsId');
        t.string('vcsUserId', 255);
        t.string('name', 255);
        t.boolean('isAdmin').default('0');
        t.dateTime('createdAt').defaultRaw('CURRENT_TIMESTAMP');
        t.dateTime('lastLoginAt');
        t.json('vcsSession').nullable();
        t.unique(['vcsId', 'vcsUserId'], 'users_vcs_user_uidx');
    });

    await db.schema.create('vcsIntegrations', t => {
        t.uuidString('id').primary();
        t.string('name', 255);
        t.string('platform', 255);
        t.json('config');
        t.dateTime('deletedAt').nullable();
    });
});
