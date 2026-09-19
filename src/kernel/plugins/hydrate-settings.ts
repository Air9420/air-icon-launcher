import type { Context, Plugin } from "cordis";
import { ensureSettingsBoot } from "./boot-coordination";

/**
 * hydrate-settings: settings/apps initial load + override lookup + stats sanitize.
 *
 * Non-blocking start; other plugins await `ensureSettingsBoot()` via boot-coordination.
 * inject: settings service slot (kernel must have constructed SettingsService).
 */
export const hydrateSettingsPlugin: Plugin.Object<void> = {
  name: "hydrate-settings",
  inject: ["ipc", "settings"],
  apply(ctx: Context) {
    void ensureSettingsBoot().catch((e) => {
      ctx.logger.error("[hydrate-settings] boot hydrate failed", e);
    });
  },
};
