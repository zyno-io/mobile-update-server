<template>
    <div id="page-wrapper">
        <nav>
            <a class="title" @click="$router.push('/')">Mobile Update Server</a>
            <div class="nav-right">
                <a class="nav-icon" :title="isDark ? 'Light mode' : 'Dark mode'" @click="toggleTheme">
                    <i :class="isDark ? 'fa fa-sun' : 'fa fa-moon'" />
                </a>
                <div v-if="store.isAdmin" class="admin-dropdown">
                    <i class="fa fa-gear" />
                    <div class="dropdown-menu">
                        <RouterLink to="/admin/vcs-integrations" class="dropdown-item">VCS Integrations</RouterLink>
                        <RouterLink to="/admin/users" class="dropdown-item">Users</RouterLink>
                    </div>
                </div>
                <a class="logout" @click="logout">Logout</a>
            </div>
        </nav>
        <main>
            <slot />
        </main>
    </div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue';

import { LOCAL_STORAGE_AUTH_KEY } from '@/openapi-client';
import { useStore } from '@/store';

const store = useStore();
const THEME_OVERRIDE_KEY = 'mus:theme';
const isDark = ref(document.documentElement.classList.contains('dark'));

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(dark: boolean) {
    isDark.value = dark;
    document.documentElement.classList.toggle('dark', dark);
}

function toggleTheme() {
    const next = !isDark.value;
    const sysIsDark = mediaQuery.matches;
    if ((next && sysIsDark) || (!next && !sysIsDark)) {
        localStorage.removeItem(THEME_OVERRIDE_KEY);
    } else {
        localStorage.setItem(THEME_OVERRIDE_KEY, next ? 'dark' : 'light');
    }
    applyTheme(next);
}

function onSystemThemeChange(e: MediaQueryListEvent) {
    if (!localStorage.getItem(THEME_OVERRIDE_KEY)) applyTheme(e.matches);
}

function logout() {
    store.sessionUser = null;
    localStorage.removeItem(LOCAL_STORAGE_AUTH_KEY);
}

onMounted(() => mediaQuery.addEventListener('change', onSystemThemeChange));
onUnmounted(() => mediaQuery.removeEventListener('change', onSystemThemeChange));
</script>

<style lang="scss" scoped>
@reference "tailwindcss";

#page-wrapper {
    @apply flex-1 flex flex-col;
}

nav {
    @apply px-6 py-4 border-b border-neutral-500/25 flex justify-between items-center;

    .title {
        @apply text-lg font-semibold cursor-pointer select-none;
    }

    .nav-right {
        @apply flex items-center gap-5;
    }

    .nav-icon,
    .logout {
        @apply cursor-pointer text-neutral-500 hover:text-neutral-700;
    }

    .admin-dropdown {
        @apply relative cursor-pointer;
        > i {
            @apply text-neutral-500 hover:text-neutral-700;
        }

        .dropdown-menu {
            @apply absolute right-0 top-full z-50 mt-2 py-1 bg-white border border-neutral-500/25 rounded-md shadow-lg min-w-[180px] opacity-0 invisible transition-all duration-100;
        }
        &:hover .dropdown-menu {
            @apply opacity-100 visible;
        }
        .dropdown-item {
            @apply block px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100;
        }
    }
}

main {
    @apply flex-1 p-6 max-w-6xl w-full mx-auto;
}

html.dark nav .nav-icon,
html.dark nav .logout,
html.dark nav .admin-dropdown > i {
    @apply text-neutral-400 hover:text-neutral-200;
}

html.dark nav .admin-dropdown .dropdown-menu {
    @apply bg-neutral-800 border-neutral-700;
}

html.dark nav .admin-dropdown .dropdown-item {
    @apply text-neutral-200 hover:bg-neutral-700;
}
</style>
