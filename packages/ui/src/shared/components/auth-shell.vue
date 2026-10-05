<template>
    <div class="auth-shell">
        <div class="backdrop" aria-hidden="true" />
        <div class="corner"><ThemeMenu /></div>
        <main class="auth-card card" :class="{ wide }">
            <div class="mark" aria-hidden="true"><i class="fa-solid fa-mobile-screen" /></div>
            <h1>Mobile Update Server</h1>
            <slot />
        </main>
    </div>
</template>

<script lang="ts" setup>
import ThemeMenu from './theme-menu.vue';

defineProps<{ wide?: boolean }>();
</script>

<style lang="scss" scoped>
.auth-shell {
    position: relative;
    isolation: isolate;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 16px 32px;
}

.backdrop {
    position: absolute;
    inset: 0;
    z-index: -1;
    background:
        radial-gradient(circle at 50% -10%, var(--accent-soft), transparent 55%),
        linear-gradient(var(--border) 1px, transparent 1px) 0 0 / 32px 32px,
        linear-gradient(90deg, var(--border) 1px, transparent 1px) 0 0 / 32px 32px;
    mask-image: radial-gradient(ellipse at 50% 35%, #000 20%, transparent 70%);
    opacity: 0.7;
}

.corner {
    position: absolute;
    top: 14px;
    right: 16px;

    :deep(.icon-trigger) {
        justify-content: center;
        width: 32px;
        padding: 0;
    }
}

.auth-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    max-width: 400px;
    padding: 32px 30px 28px;
    box-shadow: var(--shadow-lg);

    &.wide {
        max-width: 480px;
    }

    > h1 {
        font-size: 20px;
        font-weight: 650;
        letter-spacing: -0.015em;
        text-align: center;
    }
}

.mark {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: 0 auto 2px;
    border-radius: 12px;
    background: var(--text);
    color: var(--bg);
    font-size: 19px;
}

@media (max-width: 480px) {
    .auth-card {
        padding: 24px 20px;
    }
}
</style>
