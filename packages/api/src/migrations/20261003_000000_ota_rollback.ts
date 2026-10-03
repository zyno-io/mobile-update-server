import { createMigration } from '@zyno-io/ts-server-foundation';

export default createMigration(async db => {
    await db.rawExecuteUnsafe('ALTER TABLE updates ADD COLUMN rollbackSourceId varchar(36) NULL');
});
