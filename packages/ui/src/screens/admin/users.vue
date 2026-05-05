<template>
    <div id="users">
        <h1>Users</h1>
        <LoaderModal v-if="isLoading" />
        <table v-else class="users">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>VCS</th>
                    <th>Created</th>
                    <th>Last login</th>
                    <th>Admin</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="u in users" :key="u.id">
                    <td>{{ u.name }}</td>
                    <td>{{ u.vcsName }}</td>
                    <td>{{ formatDate(u.createdAt) }}</td>
                    <td>{{ formatDate(u.lastLoginAt) }}</td>
                    <td><input type="checkbox" :checked="u.isAdmin" @change="toggle(u, ($event.target as HTMLInputElement).checked)" /></td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<script lang="ts" setup>
import { dataFromAsync } from '@zyno-io/openapi-client-codegen';
import { handleErrorAndAlert } from '@zyno-io/vue-foundation';
import { format } from 'date-fns';
import { onMounted, ref } from 'vue';

import { type IuserListResponse as IUserListResponse, UsersApi } from '@/openapi-client-generated';
import LoaderModal from '@/shared/components/loader-modal.vue';

const users = ref<IUserListResponse[]>();
const isLoading = ref(true);

async function load() {
    try {
        isLoading.value = true;
        users.value = await dataFromAsync(UsersApi.getUsersIndex());
    } catch (err) {
        handleErrorAndAlert(err);
    } finally {
        isLoading.value = false;
    }
}

async function toggle(user: IUserListResponse, isAdmin: boolean) {
    try {
        await dataFromAsync(UsersApi.putUsersUpdate({ path: { id: user.id }, body: { isAdmin } }));
        await load();
    } catch (err) {
        handleErrorAndAlert(err);
    }
}

function formatDate(d: string | Date): string {
    return format(new Date(d), 'PPp');
}

onMounted(load);
</script>

<style lang="scss" scoped>
@reference "tailwindcss";

#users {
    @apply flex flex-col gap-4;
}

table.users {
    @apply w-full text-sm border-collapse;
    th,
    td {
        @apply text-left px-3 py-2 border-b border-neutral-500/25;
    }
}
</style>
