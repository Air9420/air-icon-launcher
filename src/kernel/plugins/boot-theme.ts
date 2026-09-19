import type { Context, Plugin } from "cordis";
import {
  normalizeThemeMode,
  readBootLocalSettingsData,
  type ThemeMode,
} from "../services/theme-service";

/** @deprecated Prefer normalizeThemeMode from theme-service. Kept for boot callers. */
export function normalizeBootThemeMode(value: unknown): ThemeMode {
  return normalizeThemeMode(value);
}

/** @deprecated Prefer readBootLocalSettingsData from theme-service. */
export function readBootSettingsData(): Record<string, unknown> | null {
  return readBootLocalSettingsData();
}

/**
 * Synchronous first-paint theme apply. MUST stay IPC-free and run in
 * createKernel() before Vue mount — FOUC invariant.
 *
 * Source: pinia versioned persist `__versioned_settings__` + legacy `settings`.
 * (Backend config hydrate happens later via SettingsService / settingsStore.)
 */
export function applyBootTheme(): void {
  const settingsData = readBootLocalSettingsData();
  const theme = normalizeThemeMode(settingsData?.theme);
  document.documentElement.setAttribute("data-theme", theme);

  if (typeof settingsData?.performanceMode === "boolean") {
    document.documentElement.setAttribute(
      "data-effects-disabled",
      String(settingsData.performanceMode)
    );
  }
}

/**
 * boot-theme plugin: after ThemeService is registered, seed it from the same
 * local source and re-assert DOM through ctx.theme (consumes Cordis services).
 * Falls back to raw localStorage apply if theme service is missing.
 */
export const bootThemePlugin: Plugin.Object<void> = {
  name: "boot-theme",
  apply(ctx: Context) {
    const themeService = ctx.theme;
    const settingsData = readBootLocalSettingsData();
    const mode = normalizeThemeMode(settingsData?.theme);
    const performanceMode =
      typeof settingsData?.performanceMode === "boolean"
        ? settingsData.performanceMode
        : undefined;

    if (themeService) {
      // Consume ctx.theme — single runtime source after bootstrap.
      themeService.seedFromLocal(mode, performanceMode);
      return;
    }

    applyBootTheme();
  },
};
