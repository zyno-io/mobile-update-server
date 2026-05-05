import { defineStore } from 'pinia';

import type { ISessionResponse } from './openapi-client-generated';

type SessionUser = ISessionResponse;

export const useStore = defineStore('root', {
    state: () => ({
        sessionUser: null as SessionUser | null,
        globalError: null as string | null
    }),

    getters: {
        isAdmin: state => state.sessionUser?.isAdmin ?? false
    }
});
