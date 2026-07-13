import { OpenApiError } from '@zyno-io/openapi-client-codegen';
import { configureVfOpenApiClient, UserError } from '@zyno-io/vue-foundation';

import { client } from './openapi-client-generated/client.gen';
import { useStore } from './store';

export const LOCAL_STORAGE_AUTH_KEY = 'mus:jwt';

client.setConfig({
    baseUrl: import.meta.env.VITE_APP_API_URL,
    credentials: 'include'
});

configureVfOpenApiClient(client, {
    headers() {
        const jwt = localStorage.getItem(LOCAL_STORAGE_AUTH_KEY);
        return jwt ? { Authorization: `Bearer ${jwt}` } : {};
    },

    onError(err) {
        if (err instanceof OpenApiError) {
            if (err.response?.status === 401) {
                localStorage.removeItem(LOCAL_STORAGE_AUTH_KEY);
                useStore().sessionUser = null;
                return err;
            }
        }
        if (!(err instanceof UserError)) {
            console.error(err);
        }
    }
});
