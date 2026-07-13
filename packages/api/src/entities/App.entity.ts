import { entity, PrimaryKey } from '@zyno-io/ts-server-foundation';
import { BaseEntity, UuidString } from '@zyno-io/ts-server-foundation';

@entity.name('apps')
export class AppEntity extends BaseEntity {
    id!: UuidString & PrimaryKey;
    name!: string;
    vcsId!: UuidString;
    projectPath!: string;
    vcsProjectId!: number;
    createdAt!: Date;
    deletedAt!: Date | null;
}
