import { http, HttpBadRequestError, HttpBody, HttpNotFoundError } from '@deepkit/http';
import { persistEntity } from '@zyno-io/dk-server-foundation';

import { AdminAuthMiddleware } from '../accessories/AuthMiddleware.accessory';
import { ApiController } from '../accessories/Controller.accessory';
import { DB } from '../database';
import { UserEntity } from '../entities/User.entity';
import { VcsIntegrationEntity } from '../entities/VcsIntegration.entity';

interface IUserListResponse {
    id: string;
    name: string;
    isAdmin: boolean;
    createdAt: Date;
    lastLoginAt: Date;
    vcsName: string;
}

interface IUserUpdateInput {
    isAdmin: boolean;
}

@ApiController('/api/admin/users')
@http.middleware(AdminAuthMiddleware)
export class UsersController {
    constructor(private db: DB) {}

    @http.GET()
    async index(): Promise<IUserListResponse[]> {
        const users = await UserEntity.query().orderBy('name').find();

        const vcsIds = [...new Set(users.map(u => u.vcsId))];
        const vcsIntegrations = await VcsIntegrationEntity.query()
            .filter({ id: { $in: vcsIds } })
            .find();
        const vcsMap = new Map(vcsIntegrations.map(v => [v.id, v.name]));

        return users.map(u => ({
            id: u.id,
            name: u.name,
            isAdmin: u.isAdmin,
            createdAt: u.createdAt,
            lastLoginAt: u.lastLoginAt,
            vcsName: vcsMap.get(u.vcsId) ?? ''
        }));
    }

    @http.PUT('/:id')
    async update(id: string, body: HttpBody<IUserUpdateInput>, currentUser: UserEntity): Promise<{ id: string; isAdmin: boolean }> {
        if (id === currentUser.id) {
            throw new HttpBadRequestError('Cannot modify your own admin status');
        }

        return this.db.transaction(async session => {
            // Serialize admin demotions so two concurrent demotes can't both pass the
            // "≥1 other admin" check and leave zero admins.
            await session.acquireSessionLock('mus:admin-demote');

            const user = await session.query(UserEntity).filter({ id }).findOneOrUndefined();
            if (!user) throw new HttpNotFoundError();

            if (user.isAdmin && !body.isAdmin) {
                const otherAdminCount = await session
                    .query(UserEntity)
                    .filter({ isAdmin: true, id: { $ne: user.id } })
                    .count();
                if (otherAdminCount === 0) {
                    throw new HttpBadRequestError('Cannot demote the last remaining admin');
                }
            }

            user.isAdmin = body.isAdmin;
            await persistEntity(user, session);

            return { id: user.id, isAdmin: user.isAdmin };
        });
    }
}
