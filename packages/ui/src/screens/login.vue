<template>
    <div id="login">
        <div class="title">Mobile Update Server</div>

        <div class="card">
            <h2>Sign in</h2>

            <div v-if="isLoading" class="card-loading">
                <i class="fa fa-spinner fa-spin" />
            </div>

            <template v-else>
                <button v-for="provider in providers" :key="provider.id" class="primary" @click="login(provider)">
                    Continue with {{ provider.name }}
                </button>

                <div v-if="!providers?.length" class="empty">No login providers configured.</div>
            </template>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { dataFromAsync } from '@zyno-io/openapi-client-codegen';
import { handleErrorAndAlert } from '@zyno-io/vue-foundation';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { LOCAL_STORAGE_AUTH_KEY } from '@/openapi-client';
import { type ISessionProvider, SessionApi } from '@/openapi-client-generated';
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
@reference "tailwindcss";

#login {
    @apply flex-1 flex flex-col items-center justify-center gap-6 px-6;

    .title {
        @apply text-xl font-semibold tracking-tight select-none;
    }

    .card {
        @apply flex flex-col p-6 gap-3 border border-neutral-500/25 rounded-xl w-full max-w-sm shadow-sm bg-white/40;
    }

    h2 {
        @apply text-lg font-semibold mb-1 text-center;
    }

    .card-loading {
        @apply flex justify-center items-center py-8 text-2xl text-neutral-400;
    }

    .empty {
        @apply text-sm text-neutral-500 text-center py-4;
    }
}

html.dark #login .card {
    @apply bg-neutral-900/40 border-neutral-700/50;
}
</style>
