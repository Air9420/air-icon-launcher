import { createApp } from "vue";
import App from "./App.vue";
import Router from "./router";
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import './utils/storage-migrations';

type BootThemeMode = "light" | "dark" | "system" | "transparent";

function normalizeBootThemeMode(value: unknown): BootThemeMode {
  if (value === "light" || value === "dark" || value === "transparent") {
    return value;
  }
  return "system";
}

function readBootSettingsData(): Record<string, unknown> | null {
  try {
    const versionedRaw = localStorage.getItem("__versioned_settings__");
    if (versionedRaw) {
      const parsed = JSON.parse(versionedRaw) as { data?: unknown } | null;
      if (parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object") {
        return parsed.data as Record<string, unknown>;
      }
    }

    const legacyRaw = localStorage.getItem("settings");
    if (!legacyRaw) return null;
    const legacyParsed = JSON.parse(legacyRaw);
    if (!legacyParsed || typeof legacyParsed !== "object") return null;
    return legacyParsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function applyBootTheme(): void {
  const settingsData = readBootSettingsData();
  const theme = normalizeBootThemeMode(settingsData?.theme);
  document.documentElement.setAttribute("data-theme", theme);

  if (typeof settingsData?.performanceMode === "boolean") {
    document.documentElement.setAttribute(
      "data-effects-disabled",
      String(settingsData.performanceMode)
    );
  }
}

applyBootTheme();

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
createApp(App).use(Router).use(pinia).mount("#app");
