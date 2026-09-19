import type { Context } from "cordis";
import type { IpcService, KernelContext } from "./index";
import type { AppsService } from "./services/apps-service";
import type { MenuContributionService } from "./services/menu-service";
import type { SearchService } from "./services/search-service";
import type { SettingsService } from "./services/settings-service";
import type { ThemeService } from "./services/theme-service";
import type { PluginHostService } from "./services/plugin-host-service";

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

export type KernelTypeAssertions = [
  // KernelContext exposes ipc
  Expect<Equal<KernelContext["ipc"], IpcService>>,
  // declare module 'cordis' merges ipc onto Context itself
  Expect<Equal<Context["ipc"], IpcService>>,
  // Reserved slots exist on KernelContext
  Expect<Equal<"pluginHost" extends keyof KernelContext ? true : false, true>>,
  Expect<Equal<"apps" extends keyof KernelContext ? true : false, true>>,
  Expect<Equal<"search" extends keyof KernelContext ? true : false, true>>,
  Expect<Equal<"settings" extends keyof KernelContext ? true : false, true>>,
  Expect<Equal<"theme" extends keyof KernelContext ? true : false, true>>,
  Expect<Equal<"menus" extends keyof KernelContext ? true : false, true>>,
  // Context also has reserved slots via module augmentation
  Expect<Equal<"pluginHost" extends keyof Context ? true : false, true>>,
  Expect<Equal<"apps" extends keyof Context ? true : false, true>>,
  Expect<Equal<"search" extends keyof Context ? true : false, true>>,
  Expect<Equal<"menus" extends keyof Context ? true : false, true>>,
  // P5/P6: real service types occupy apps/search/menus slots (optional on Context)
  Expect<Equal<KernelContext["apps"], AppsService | undefined>>,
  Expect<Equal<KernelContext["search"], SearchService | undefined>>,
  Expect<Equal<KernelContext["menus"], MenuContributionService | undefined>>,
  Expect<Equal<KernelContext["settings"], SettingsService | undefined>>,
  Expect<Equal<KernelContext["theme"], ThemeService | undefined>>,
  Expect<Equal<KernelContext["pluginHost"], PluginHostService | undefined>>,
];
