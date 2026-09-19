export { createKernel } from "./bootstrap";
export { CORDIS_INJECTION_KEY, useCordis } from "./vue";
export { getKernelContext } from "./context-access";
export { AppsService } from "./services/apps-service";
export { IpcService } from "./services/ipc-service";
export { MenuContributionService } from "./services/menu-service";
export { PluginHostService } from "./services/plugin-host-service";
export { SearchService } from "./services/search-service";
export { SettingsService } from "./services/settings-service";
export { StatsService } from "./services/stats-service";
export { ThemeService } from "./services/theme-service";
export {
  applyBootTheme,
  bootThemePlugin,
  normalizeBootThemeMode,
  readBootSettingsData,
} from "./plugins/boot-theme";
export { hydrateSettingsPlugin } from "./plugins/hydrate-settings";
export { clipboardRuntimePlugin } from "./plugins/clipboard-runtime";
export { tauriBridgePlugin } from "./plugins/tauri-bridge";
export { updaterPlugin } from "./plugins/updater";
export { searchRuntimePlugin } from "./plugins/search-runtime";
export { windowEffectsBootPlugin } from "./plugins/window-effects-boot";
export { themeRuntimePlugin } from "./plugins/theme-runtime";
export { uiShellRuntimePlugin } from "./plugins/ui-shell-runtime";
export { ensureSettingsBoot } from "./plugins/boot-coordination";
export {
  appIsTransitioning,
  autoHideIsCountingDown,
  dragDropLastDrop,
  dragDropProcessedIds,
  stopAutoHideCountdown,
  startAutoHideCountdown,
} from "./runtime/ui-shell-state";

export type {
  Context,
  KernelContext,
  Disposer,
} from "./types";

export type {
  AppsCategory,
  AppsItemPatch,
  AppsLaunchDependency,
  AppsLauncherItem,
  AppsRecentUsedItem,
  AppsUpsertItemPayload,
  PersistedAppsLauncherData,
} from "./services/apps-service";

export type {
  AppsItemOpsState,
  DomainAddPathsPayload,
  DomainCreateItemPayload,
  DomainImportSnapshotPayload,
  DomainItemPatch,
  DomainLauncherItem,
  DomainLnkTarget,
} from "./domain/apps-item-ops";
export {
  opsAddFileItems,
  opsAddFileItemsBatched,
  opsAddUrlItem,
  opsCreateItemInCategory,
  opsRemoveItems,
  opsUpdateItem,
  opsUpsertItem,
} from "./domain/apps-item-ops";

export type {
  RustSearchMatchType,
  RustSearchResult,
  SearchIndexChangesPayload,
  SearchIndexItemPayload,
} from "./services/search-service";

export type {
  ThemeMode,
  WindowEffectType,
  WindowEffectSupportInfo,
  WindowEffectCompatibilityResult,
} from "./services/theme-service";

export type {
  AppUsageStats,
  SearchKeywordRecord,
  LaunchEventRecord,
  ExternalRecentLaunchRecord,
  BlockedExternalLaunchRecord,
  LegacyUsageSnapshotRecord,
} from "../stores/stats-helpers";

export type { InvokeResult } from "../utils/invoke-wrapper";
export type { AppConfigSnapshot } from "../utils/config-sync";

export type {
  PluginHostManifest,
  PluginHostRuntimeInfo,
  PluginHostEventPayload,
  PluginHostContributes,
} from "../types/plugin-host";
