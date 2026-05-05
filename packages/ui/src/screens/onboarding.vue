<template>
    <div id="onboarding">
        <a class="title">Mobile Update Server</a>

        <div class="card">
            <h2>Welcome</h2>
            <p>Configure your first GitLab integration to get started.</p>

            <form @submit.prevent="submit">
                <label>
                    Integration name
                    <input v-model="form.name" type="text" required />
                </label>
                <label>
                    GitLab URL
                    <input v-model="form.url" type="url" placeholder="https://gitlab.example.com" required />
                </label>
                <label>
                    OAuth Client ID
                    <input v-model="form.clientId" type="text" required />
                </label>
                <label>
                    OAuth Client Secret
                    <input v-model="form.clientSecret" type="password" autocomplete="new-password" required />
                </label>

                <div class="redirect-url">
                    <span>OAuth Redirect URI</span>
                    <code>{{ redirectUrl }}</code>
                    <p class="hint">Configure this redirect URI when creating your GitLab OAuth application.</p>
                </div>

                <button type="submit" class="primary" :disabled="isSubmitting">
                    {{ isSubmitting ? 'Creating...' : 'Create integration' }}
                </button>
            </form>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { dataFromAsync } from '@zyno-io/openapi-client-codegen';
import { handleErrorAndAlert } from '@zyno-io/vue-foundation';
import { computed, reactive, ref } from 'vue';

import { SessionApi } from '@/openapi-client-generated';

const emit = defineEmits<{ complete: [] }>();

const form = reactive({
    name: '',
    url: '',
    clientId: '',
    clientSecret: ''
});
const isSubmitting = ref(false);
const redirectUrl = computed(() => `${window.location.origin}/login`);

async function submit() {
    try {
        isSubmitting.value = true;
        await dataFromAsync(
            SessionApi.postSessionCreateOnboardingVcsIntegration({
                body: {
                    name: form.name,
                    platform: 'gitlab',
                    config: {
                        url: form.url.replace(/\/$/, ''),
                        clientId: form.clientId,
                        clientSecret: form.clientSecret
                    }
                }
            })
        );
        emit('complete');
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        isSubmitting.value = false;
    }
}
</script>

<style lang="scss" scoped>
@reference "tailwindcss";

#onboarding {
    @apply flex-1 flex flex-col items-center justify-center p-6;

    .card {
        @apply flex flex-col gap-3 p-6 border border-neutral-500/25 rounded-lg w-[480px];
    }
    .title {
        @apply text-lg cursor-pointer mb-4 text-center;
    }
    form {
        @apply flex flex-col gap-3 mt-2;
    }
    .redirect-url {
        @apply flex flex-col gap-1 p-3 bg-neutral-100 rounded-md;
        code {
            @apply text-xs font-mono break-all;
        }
        .hint {
            @apply text-xs text-neutral-500;
        }
    }
}

html.dark #onboarding .redirect-url {
    @apply bg-neutral-800;
}
</style>
