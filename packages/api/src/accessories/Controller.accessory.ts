import { http, HttpUnauthorizedError } from '@zyno-io/ts-server-foundation';
import { createCachingParameterResolver, resolveEntityFromRequestJwt } from '@zyno-io/ts-server-foundation';

import { UserEntity } from '../entities/User.entity';

export const UserResolver = createCachingParameterResolver(UserEntity, async context => {
    try {
        return await resolveEntityFromRequestJwt(context, UserEntity);
    } catch {
        throw new HttpUnauthorizedError();
    }
});

export function ApiController(path?: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function <T extends { new (...args: any[]): unknown }>(target: T) {
        http.controller(path)(target);
        http.resolveParameter(UserEntity, UserResolver)(target);
        return target;
    };
}
