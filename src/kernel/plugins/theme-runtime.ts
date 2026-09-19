import type { Context, Plugin } from "cordis";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "../../stores";
import { ensureSettingsBoot } from "./boot-coordination";

/**
 * theme-runtime: after settings hydrate, re-assert DOM theme + watch system
 * prefers-color-scheme. Mode changes themselves are owned by ThemeService
 * (shared refs with settingsStore); this plugin covers boot re-apply and
 * system-theme media query parity with pre-P7 useTheme.watchThemeChanges.
 */
export const themeRuntimePlugin: Plugin.Object<void> = {
  name: "theme-runtime",
  inject: ["theme", "settings"],
  apply(ctx: Context) {
    let mediaQuery: MediaQueryList | null = null;
    let handleSystemThemeChange: (() => void) | null = null;

    const task = (async () => {
      await ensureSettingsBoot();

      const settingsStore = useSettingsStore();
      const { theme, windowEffectsEnabled } = storeToRefs(settingsStore);
      const themeService = ctx.theme;

      // Boot re-apply (ThemeService already watches mode; this is parity with App.vue).
      if (themeService) {
        themeService.applyDom();
      } else {
        document.documentElement.setAttribute("data-theme", theme.value);
        document.documentElement.setAttribute(
          "data-effects-disabled",
          String(!windowEffectsEnabled.value),
        );
      }

      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      handleSystemThemeChange = () => {
        if (theme.value === "system") {
          document.documentElement.setAttribute("data-theme", "system");
          themeService?.applyDom();
        }
      };
      mediaQuery.addEventListener("change", handleSystemThemeChange);
    })();

    return () => {
      void task.then(() => {
        if (mediaQuery && handleSystemThemeChange) {
          mediaQuery.removeEventListener("change", handleSystemThemeChange);
        }
      });
    };
  },
};
