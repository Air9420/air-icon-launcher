import { Context } from "cordis";
import { AppsService } from "./services/apps-service";
import { IpcService } from "./services/ipc-service";
import { MenuContributionService } from "./services/menu-service";
import { PluginHostService } from "./services/plugin-host-service";
import { SearchService } from "./services/search-service";
import { SettingsService } from "./services/settings-service";
import { StatsService } from "./services/stats-service";
import { ThemeService } from "./services/theme-service";
import { applyBootTheme, bootThemePlugin } from "./plugins/boot-theme";
import { hydrateSettingsPlugin } from "./plugins/hydrate-settings";
import { clipboardRuntimePlugin } from "./plugins/clipboard-runtime";
import { tauriBridgePlugin } from "./plugins/tauri-bridge";
import { updaterPlugin } from "./plugins/updater";
import { searchRuntimePlugin } from "./plugins/search-runtime";
import { windowEffectsBootPlugin } from "./plugins/window-effects-boot";
import { themeRuntimePlugin } from "./plugins/theme-runtime";
import { uiShellRuntimePlugin } from "./plugins/ui-shell-runtime";
import { statsEventSyncPlugin } from "./plugins/stats-event-sync";
import type { KernelContext } from "./types";

export function createKernel(): KernelContext {
  const ctx = new Context() as KernelContext;

  // Theme must apply before first paint to avoid FOUC.
  applyBootTheme();

  // Direct Service construction registers services synchronously
  // (root fiber is ACTIVE). ctx.plugin() defers construction to a microtask
  // and would race Vue mount.
  // Order: ipc → settings → theme → apps → search → stats → menus → pluginHost
  new IpcService(ctx);
  new SettingsService(ctx);
  new ThemeService(ctx);
  new AppsService(ctx);
  new SearchService(ctx);
  new StatsService(ctx);
  new MenuContributionService(ctx);
  new PluginHostService(ctx);

  ctx.plugin(bootThemePlugin);

  // P7 kernel runtime plugins — former App.vue onMounted side effects.
  ctx.plugin(hydrateSettingsPlugin);
  ctx.plugin(clipboardRuntimePlugin);
  // IR: legacy iframe plugin sync removed — Rust Host is the only plugin runtime.
  ctx.plugin(tauriBridgePlugin);
  ctx.plugin(updaterPlugin);
  ctx.plugin(searchRuntimePlugin);
  ctx.plugin(statsEventSyncPlugin);
  ctx.plugin(windowEffectsBootPlugin);
  ctx.plugin(themeRuntimePlugin);
  ctx.plugin(uiShellRuntimePlugin);

  window.__AIR_CTX__ = ctx;
  return ctx;
}
