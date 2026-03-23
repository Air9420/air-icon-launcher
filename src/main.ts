import { createApp } from "vue";
import App from "./App.vue";
import Router from "./router";
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import './utils/storage-migrations';

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
createApp(App).use(Router).use(pinia).mount("#app");
