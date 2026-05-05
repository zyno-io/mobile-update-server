import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

import { LOCAL_STORAGE_AUTH_KEY } from './openapi-client';
import AdminUsers from './screens/admin/users.vue';
import AdminVcsIntegrations from './screens/admin/vcs-integrations.vue';
import AppView from './screens/app.vue';
import Apps from './screens/apps.vue';
import Channel from './screens/channel.vue';
import Login from './screens/login.vue';
import UpdateView from './screens/update.vue';

const routes: RouteRecordRaw[] = [
    { path: '/', redirect: '/apps' },
    { path: '/login', name: 'login', component: Login, meta: { public: true } },
    { path: '/apps', name: 'apps', component: Apps },
    { path: '/apps/:appId', name: 'app', component: AppView },
    { path: '/apps/:appId/channels/:channelId', name: 'channel', component: Channel },
    {
        path: '/apps/:appId/channels/:channelId/updates/:updateId',
        name: 'update',
        component: UpdateView
    },
    {
        path: '/admin/vcs-integrations',
        name: 'admin-vcs-integrations',
        component: AdminVcsIntegrations
    },
    { path: '/admin/users', name: 'admin-users', component: AdminUsers }
];

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes
});

router.beforeEach(to => {
    if (to.meta.public) return;
    if (!localStorage.getItem(LOCAL_STORAGE_AUTH_KEY)) {
        return { name: 'login', query: { returnPath: to.fullPath } };
    }
});

export default router;
