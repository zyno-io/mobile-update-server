import { entity, PrimaryKey } from '@deepkit/type';
import { BaseEntity, UuidString } from '@zyno-io/dk-server-foundation';

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
