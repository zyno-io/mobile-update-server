<template>
    <AuthShell wide>
        <div id="onboarding">
            <h2>Welcome</h2>
            <p>Configure your first GitLab integration to get started.</p>

            <form @submit.prevent="submit">
                <label>
                    Integration name
                    <input class="input" v-model="form.name" type="text" required />
                </label>
                <label>
                    GitLab URL
                    <input class="input" v-model="form.url" type="url" placeholder="https://gitlab.example.com" required />
                </label>
                <label>
                    OAuth Client ID
                    <input class="input" v-model="form.clientId" type="text" required />
                </label>
                <label>
                    OAuth Client Secret
                    <input class="input" v-model="form.clientSecret" type="password" autocomplete="new-password" required />
                </label>

                <div class="redirect-url">
                    <span>OAuth Redirect URI</span>
                    <code>{{ redirectUrl }}</code>
                    <p class="hint">Configure this redirect URI when creating your GitLab OAuth application.</p>
                </div>

                <button type="submit" class="btn primary" :disabled="isSubmitting">
                    {{ isSubmitting ? 'Creating...' : 'Create integration' }}
                </button>
            </form>
        </div>
    </AuthShell>
</template>

<script lang="ts" setup>
import { dataFromAsync } from '@zyno-io/openapi-client-codegen';
import { handleErrorAndAlert } from '@zyno-io/vue-foundation';
import { computed, reactive, ref } from 'vue';

import { SessionApi } from '@/openapi-client-generated';
import AuthShell from '@/shared/components/auth-shell.vue';

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
#onboarding {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
h2,
#onboarding > p {
    text-align: center;
}
#onboarding > p {
    color: var(--text-2);
    font-size: 13.5px;
}
form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 6px;
}
.redirect-url {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    code {
        font-size: 12px;
        overflow-wrap: anywhere;
    }
    .hint {
        color: var(--text-3);
        font-size: 12px;
    }
}
</style>
