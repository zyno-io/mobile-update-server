<template>
    <AuthShell>
        <h2>Sign in</h2>
        <p class="lede">Manage apps, release updates, and keep your devices current.</p>
        <div v-if="isLoading" class="card-loading" role="status" aria-label="Loading sign-in providers">
            <i class="fa fa-spinner fa-spin" aria-hidden="true" />
        </div>
        <template v-else>
            <button v-for="provider in providers" :key="provider.id" class="btn primary lg" @click="login(provider)">
                <i class="fa-brands fa-gitlab" aria-hidden="true" /> Continue with {{ provider.name }}
            </button>
            <div v-if="!providers?.length" class="notice warning" role="status">
                <i class="fa-solid fa-circle-info" aria-hidden="true" />
                <div class="notice-body">No login providers configured.</div>
            </div>
        </template>
    </AuthShell>
</template>

<script lang="ts" setup>
import { dataFromAsync } from '@zyno-io/openapi-client-codegen';
import { handleErrorAndAlert } from '@zyno-io/vue-foundation';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { LOCAL_STORAGE_AUTH_KEY } from '@/openapi-client';
import { type ISessionProvider, SessionApi } from '@/openapi-client-generated';
import AuthShell from '@/shared/components/auth-shell.vue';
import { useStore } from '@/store';

const store = useStore();
const route = useRoute();
const router = useRouter();
const isLoading = ref(true);
const providers = ref<ISessionProvider[]>();

async function login(provider: ISessionProvider) {
    try {
        isLoading.value = true;
        const { url } = await dataFromAsync(
            SessionApi.getSessionGetProviderLoginUrl({
                path: { id: provider.id },
                query: {
                    redirectUri: `${window.location.origin}/login`,
                    returnPath: (route.query.returnPath as string | undefined) ?? '/'
                }
            })
        );
        location.href = url;
    } catch (err) {
        handleErrorAndAlert(err);
        isLoading.value = false;
    }
}

async function processCode(code: string) {
    try {
        const state = route.query.state as string | undefined;
        if (!state) throw new Error('Missing OAuth state');
        const { jwt, returnPath } = await dataFromAsync(SessionApi.postSessionLogin({ body: { code, state } }));
        localStorage.setItem(LOCAL_STORAGE_AUTH_KEY, jwt);
        store.sessionUser = await dataFromAsync(SessionApi.getSessionGetIdentity());
        await router.replace(returnPath ?? '/');
    } catch (err) {
        handleErrorAndAlert(err);
        await router.replace({ path: '/login', query: {} });
        await loadProviders();
    }
}

async function loadProviders() {
    try {
        providers.value = await dataFromAsync(SessionApi.getSessionGetProviders());
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        isLoading.value = false;
    }
}

onMounted(async () => {
    await router.isReady();
    if (route.query.code) {
        await processCode(route.query.code as string);
    } else {
        await loadProviders();
    }
});
</script>

<style lang="scss" scoped>
h2 {
    text-align: center;
}
.lede {
    color: var(--text-2);
    font-size: 13.5px;
    text-align: center;
    margin-bottom: 6px;
}
.card-loading {
    display: flex;
    justify-content: center;
    padding: 24px;
    color: var(--text-3);
    font-size: 24px;
}
</style>
