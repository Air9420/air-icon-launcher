import { createApp } from "vue";
import App from "./App.vue";
import Router from "./router";
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import './utils/storage-migrations';
import { createKernel, CORDIS_INJECTION_KEY } from "./kernel";

const ctx = createKernel();

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
const app = createApp(App)
app.provide(CORDIS_INJECTION_KEY, ctx)
app.use(Router)
app.use(pinia)
app.mount("#app");
