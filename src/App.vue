<template>
  <div
    class="app-shell"
    :data-color-scheme="themeClass"
    :class="{ 'is-blur': windowEffect === 'blur', 'is-acrylic': windowEffect === 'acrylic' }"
  >
    <BackgroundEffect />
    <TopBar />
    <div class="app-body">
      <GlobalGuide />
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </div>
    <GlobalToast />
    <CountdownRing
      v-if="isCountingDown"
      :countdown-seconds="autoHideCountdownSeconds"
      :is-visible="isCountingDown"
      @complete="handleCountdownComplete"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, provide } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { useSearchStore } from "./stores/searchStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useLauncherStore } from "./stores/launcherStore";
import { useWindowPosition } from "./composables/useWindowPosition";
import { useAutoHideCountdown } from "./composables/useAutoHideCountdown";
import { initializeConfigSync } from "./utils/config-sync";
import TopBar from "./components/layout/TopBar.vue";
import BackgroundEffect from "./components/layout/BackgroundEffect.vue";
import GlobalGuide from "./components/guide/GlobalGuide.vue";
import GlobalToast from "./components/common/GlobalToast.vue";
import CountdownRing from "./components/common/CountdownRing.vue";
import { setupClickOutside } from "./composables/useClickOutside";

const router = useRouter();
const searchStore = useSearchStore();
const settingsStore = useSettingsStore();
const launcherStore = useLauncherStore();
const {
  searchQuery,
} = storeToRefs(searchStore);
const {
  themeClass,
  windowEffect,
  guideCompleted,
  autoHideEnabled,
  autoHideCountdownSeconds,
} = storeToRefs(settingsStore);

provide("searchQuery", searchQuery);
provide("guideCompleted", guideCompleted);

const { setupPositionListeners, cleanup: cleanupPosition } =
  useWindowPosition();

const {
  isCountingDown,
  stopCountdown,
  handleCountdownComplete,
  setupFocusListener,
} = useAutoHideCountdown({
  autoHideEnabled,
  countdownSeconds: autoHideCountdownSeconds,
});

const cleanupClickOutside = setupClickOutside(searchQuery, stopCountdown);

onMounted(async () => {
  searchStore.startListening();
  if (router.currentRoute.value.path !== "/") {
    router.replace("/");
  }
  await launcherStore.initialize();
  await initializeConfigSync(settingsStore);
  setupPositionListeners();
  await setupFocusListener();
});
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
</style>

<style scoped>
.app-shell {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  position: relative;
  color: var(--color-text-primary);
}

.app-shell[data-color-scheme="dark"] {
  --color-bg-primary: #1e1e2e;
  --color-bg-secondary: #2a2a3e;
  --color-bg-hover: #363650;
  --color-text-primary: #e0e0e0;
  --color-text-secondary: #a0a0b0;
  --color-accent: #6366f1;
}

.app-shell[data-color-scheme="light"] {
  --color-bg-primary: rgb(232 232 237);
  --color-bg-secondary: rgb(210 210 220);
  --color-bg-hover: rgb(195 195 210);
  --color-text-primary: #1e1e2e;
  --color-text-secondary: #5a5a6e;
  --color-accent: #6366f1;
}

.is-blur {
  background: rgba(30, 30, 46, 0.75);
}

.app-shell[data-color-scheme="light"].is-blur {
  background: rgba(230, 230, 240, 0.65);
}

.is-acrylic {
  background: rgba(30, 30, 46, 0.88);
  backdrop-filter: blur(30px) saturate(1.5);
  -webkit-backdrop-filter: blur(30px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.app-shell[data-color-scheme="light"].is-acrylic {
  background: rgba(240, 240, 248, 0.78);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.app-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 14px;
  position: relative;
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.15s ease;
}
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}
</style>