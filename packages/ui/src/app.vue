<template>
    <div id="app">
        <div v-if="globalError" id="global-error" v-text="globalError" />

        <div v-else-if="isReady === false" id="initial-loader">
            <i class="fa fa-spinner fa-spin" />
        </div>

        <Onboarding v-else-if="isOnboarded === false" @complete="isOnboarded = true" />

        <Login v-else-if="!store.sessionUser || $route.path === '/login'" />

        <Layout v-else>
            <router-view />
        </Layout>

        <OverlayContainer />
    </div>
</template>

<script lang="ts" setup>
import { dataFrom, dataFromAsync, OpenApiError } from '@zyno-io/openapi-client-codegen';
import { OverlayContainer } from '@zyno-io/vue-foundation';
import { onMounted, ref } from 'vue';

import { LOCAL_STORAGE_AUTH_KEY } from './openapi-client';
import { SessionApi } from './openapi-client-generated';
import Login from './screens/login.vue';
import Onboarding from './screens/onboarding.vue';
import Layout from './shared/components/layout.vue';
import { useStore } from './store';

const store = useStore();
const { globalError } = store;

const isReady = ref(false);
const isOnboarded = ref<boolean | null>(null);

onMounted(async () => {
    try {
        const { isOnboarded: status } = dataFrom(await SessionApi.getSessionGetOnboardingStatus());
        isOnboarded.value = status;
    } catch {
        isOnboarded.value = true;
    }

    if (localStorage.getItem(LOCAL_STORAGE_AUTH_KEY)) {
        try {
            store.sessionUser = await dataFromAsync(SessionApi.getSessionGetIdentity());
        } catch (err) {
            if (!(err instanceof OpenApiError && err.response?.status === 401)) {
                console.error(err);
            }
        }
    }

    isReady.value = true;
});
</script>

<style>
@import 'tailwindcss';
@custom-variant dark (&:where(.dark, .dark *));
</style>

<style lang="scss">
@use './shared/styles/base.scss' as *;
@reference "tailwindcss";

#app {
    @apply flex-1 flex;
}

#global-error {
    @apply flex-1 flex justify-center items-center bg-gray-800 text-2xl text-red-300;
}

#initial-loader {
    @apply flex-1 flex justify-center items-center text-3xl text-neutral-400;
}
</style>
