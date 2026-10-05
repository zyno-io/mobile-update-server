import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './composables/useTheme';
import '@fortawesome/fontawesome-free/css/all.css';
import '@zyno-io/vue-foundation/dist/vue-foundation.css';
import './openapi-client';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './app.vue';
import router from './router';
import { setupVf } from './vf.setup';

const app = createApp(App);
setupVf(app);

const pinia = createPinia();
app.use(pinia);
app.use(router);

app.mount('#app');
