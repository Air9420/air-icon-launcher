import { initOverrideLookupFromStore } from "../../utils/classification/pipeline";
import { useSettingsStore } from "../../stores";
import { useStatsStore } from "../../stores/statsStore";

let settingsBootPromise: Promise<void> | null = null;

/**
 * One-shot settings/apps boot hydrate shared by kernel plugins.
 *
 * Order matches pre-P7 App.vue onMounted:
 * 1. override lookup (classification)
 * 2. stats external-history sanitize
 * 3. settings hydratePersistedConfig
 * 4. refreshAutostartStatus
 *
 * Plugins that need hydrated settings (window effects, show launcher, guide)
 * must `await ensureSettingsBoot()`.
 */
export function ensureSettingsBoot(): Promise<void> {
  if (settingsBootPromise) return settingsBootPromise;

  settingsBootPromise = (async () => {
    initOverrideLookupFromStore();
    try {
      useStatsStore().sanitizeExternalRecentLaunchHistory();
    } catch (e) {
      console.error("[hydrate-settings] stats sanitize failed:", e);
    }

    const settingsStore = useSettingsStore();
    await settingsStore.hydratePersistedConfig();
    await settingsStore.refreshAutostartStatus();
  })();

  return settingsBootPromise;
}

/** Test-only: clear memoized boot promise. */
export function resetSettingsBootForTests(): void {
  settingsBootPromise = null;
}
