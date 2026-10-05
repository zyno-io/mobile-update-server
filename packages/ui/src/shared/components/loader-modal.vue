<template>
    <div class="loader" :class="size" role="status" aria-label="Loading">
        <i class="fa fa-spinner fa-spin" aria-hidden="true" />
    </div>
</template>

<script lang="ts" setup>
defineProps<{ size?: string }>();
</script>

<style lang="scss" scoped>
@reference "tailwindcss";

.loader {
    @apply flex items-center justify-center py-8 text-(--text-3);
    i {
        @apply text-xl;
    }
    &.\32 xl i {
        @apply text-3xl;
    }
}
</style>
