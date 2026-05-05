import { entity, PrimaryKey } from '@deepkit/type';
import { BaseEntity, UuidString } from '@zyno-io/dk-server-foundation';

export interface IGitLabConfig {
    url: string;
    clientId: string;
    clientSecret: string;
}

@entity.name('vcsIntegrations')
export class VcsIntegrationEntity extends BaseEntity {
    id!: UuidString & PrimaryKey;
    name!: string;
    platform!: 'gitlab';
    config!: IGitLabConfig;
    deletedAt!: Date | null;
}
