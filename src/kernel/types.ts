import type { Context } from "cordis";
import type { AppsService } from "./services/apps-service";
import type { IpcService } from "./services/ipc-service";
import type { MenuContributionService } from "./services/menu-service";
import type { PluginHostService } from "./services/plugin-host-service";
import type { SearchService } from "./services/search-service";
import type { SettingsService } from "./services/settings-service";
import type { StatsService } from "./services/stats-service";
import type { ThemeService } from "./services/theme-service";

export type Disposer = () => void;

export type { PluginHostService, IpcService };
// Real implementations — export classes from their service files (not here)
// to avoid TS2300 duplicate identifier re-exports.
export type { SettingsService, ThemeService };
export type { AppsService, SearchService };
export type { MenuContributionService, StatsService };

declare module "cordis" {
  interface Context {
    ipc: IpcService;
    apps?: AppsService;
    search?: SearchService;
    settings?: SettingsService;
    theme?: ThemeService;
    pluginHost?: PluginHostService;
    menus?: MenuContributionService;
    stats?: StatsService;
  }
}

/**
 * Facade context type for business code. Stable even if cordis
 * module-augmentation merge behaviour changes across RC versions.
 */
export interface KernelContext extends Context {
  ipc: IpcService;
  apps?: AppsService;
  search?: SearchService;
  settings?: SettingsService;
  theme?: ThemeService;
  pluginHost?: PluginHostService;
  menus?: MenuContributionService;
  stats?: StatsService;
}

declare global {
  interface Window {
    __AIR_CTX__?: Context;
  }
}

export type { Context };
