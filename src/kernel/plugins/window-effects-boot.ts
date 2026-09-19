import type { Context, Plugin } from "cordis";
import { useSettingsStore } from "../../stores";
import { showToast } from "../../composables/useGlobalToast";
import { ensureSettingsBoot } from "./boot-coordination";

const WINDOW_EFFECT_BOOT_MARK_KEY = "__air_window_effect_boot_mark__";

function shouldSkipWindowEffectApplyOnThisBoot(): boolean {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
    return false;
  }
  try {
    if (sessionStorage.getItem(WINDOW_EFFECT_BOOT_MARK_KEY) === "1") {
      return true;
    }
    sessionStorage.setItem(WINDOW_EFFECT_BOOT_MARK_KEY, "1");
    return false;
  } catch {
    return false;
  }
}

/**
 * window-effects-boot: after settings hydrate, apply window effect state once
 * per browser session (sessionStorage mark avoids double-apply on reload).
 */
export const windowEffectsBootPlugin: Plugin.Object<void> = {
  name: "window-effects-boot",
  inject: ["settings", "theme", "ipc"],
  apply(ctx: Context) {
    return (async () => {
      await ensureSettingsBoot();
      const settingsStore = useSettingsStore();
      const skipEffectApplyForReloadBoot = shouldSkipWindowEffectApplyOnThisBoot();
      if (skipEffectApplyForReloadBoot) return;

      try {
        const windowEffectResult = await settingsStore.applyCurrentWindowEffectState();
        if (windowEffectResult.changed && windowEffectResult.message) {
          showToast(windowEffectResult.message, { type: "info", duration: 5000 });
        }
      } catch (e) {
        ctx.logger.error("[window-effects-boot] apply failed", e);
      }
    })();
  },
};
