import type { Context, Plugin } from "cordis";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { storeToRefs } from "pinia";
import router from "../../router";
import { safeInvoke } from "../../utils/invoke-wrapper";
import { useWindowPosition } from "../../composables/useWindowPosition";
import { useSettingsStore } from "../../stores";
import { showToast } from "../../composables/useGlobalToast";
import { useStatsStore } from "../../stores/statsStore";
import { hideWindowAndStartMemoryRelease } from "../../utils/window-memory";
import { appIsTransitioning } from "../runtime/ui-shell-state";
import { ipcRegistrar, type KernelEventRegistrar } from "./event-types";
import type { Disposer } from "../types";

type SystemProcessLaunchedEvent = {
  name: string;
  path: string;
  iconBase64?: string | null;
  source?: string;
  usedAt?: number;
};

/**
 * Register tray / hotkey / display Tauri events onto stores + router.
 * Exported for testability; tauri-bridge plugin supplies `ctx.ipc.on`.
 */
export function registerTauriBridgeEvents(on: KernelEventRegistrar): Disposer {
  const disposers: Disposer[] = [];

  disposers.push(
    on("tray-open-settings", async () => {
      void router.push("/settings");
    }),
  );

  disposers.push(
    on("toggle-clipboard", async () => {
      appIsTransitioning.value = true;
      await router.push("/clipboard");
      await safeInvoke("show_launcher");
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            appIsTransitioning.value = false;
            resolve();
          });
        });
      });
    }),
  );

  disposers.push(
    on("toggle-main", async () => {
      const currentRoute = router.currentRoute.value.path;
      const win = getCurrentWindow();
      const isVisible = await win.isVisible();
      const isFocused = await win.isFocused();
      const { saveWindowPosition, restoreWindowPosition } = useWindowPosition();
      const settingsStore = useSettingsStore();
      const { followMouseOnShow } = storeToRefs(settingsStore);

      console.log("[toggle-main] received", { currentRoute, isVisible, isFocused });

      if (currentRoute === "/categories" && isVisible && isFocused) {
        console.log("[toggle-main] hiding window");
        await saveWindowPosition();
        await hideWindowAndStartMemoryRelease(win, async () => {
          await safeInvoke("start_memory_release");
        });
      } else {
        appIsTransitioning.value = true;
        void router.push("/categories");
        const restored = !followMouseOnShow.value && (await restoreWindowPosition());
        await safeInvoke("show_launcher", restored ? { forceNoFollow: true } : {});
        await emit("window-shown", null);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              appIsTransitioning.value = false;
              resolve();
            });
          });
        });
      }
    }),
  );

  disposers.push(
    on("corner-hotspot-triggered", async () => {
      appIsTransitioning.value = true;
      void router.push("/categories");
      await emit("window-shown", null);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            appIsTransitioning.value = false;
            resolve();
          });
        });
      });
    }),
  );

  disposers.push(
    on("display-no-external-monitor", async () => {
      showToast("当前只有一个显示器，无法切换投影模式", { type: "info", duration: 3000 });
    }),
  );

  disposers.push(
    on("navigate-to-icc-settings", async () => {
      const currentRoute = router.currentRoute.value.path;
      const win = getCurrentWindow();
      const isVisible = await win.isVisible();
      const isFocused = await win.isFocused();
      const { saveWindowPosition, restoreWindowPosition } = useWindowPosition();
      const settingsStore = useSettingsStore();
      const { followMouseOnShow } = storeToRefs(settingsStore);

      console.log("[navigate-to-icc-settings] received", { currentRoute, isVisible, isFocused });

      if (currentRoute === "/settings/display" && isVisible && isFocused) {
        console.log("[navigate-to-icc-settings] hiding window");
        await saveWindowPosition();
        await hideWindowAndStartMemoryRelease(win, async () => {
          await safeInvoke("start_memory_release");
        });
      } else {
        appIsTransitioning.value = true;
        void router.push("/settings/display");
        const restored = !followMouseOnShow.value && (await restoreWindowPosition());
        await safeInvoke("show_launcher", restored ? { forceNoFollow: true } : {});
        await emit("window-shown", null);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              appIsTransitioning.value = false;
              resolve();
            });
          });
        });
      }
    }),
  );

  disposers.push(
    on<SystemProcessLaunchedEvent>("system-process-launched", ({ payload }) => {
      if (!payload?.path || !payload?.name) return;
      const statsStore = useStatsStore();
      statsStore.recordExternalLaunch({
        path: payload.path,
        name: payload.name,
        source: payload.source ?? "系统启动",
        iconBase64: payload.iconBase64 ?? null,
        usedAt: payload.usedAt,
      });
    }),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/**
 * tauri-bridge: Tauri global events → stores / router / window UX.
 * All event registration goes through `ctx.ipc.on`.
 */
export const tauriBridgePlugin: Plugin.Object<void> = {
  name: "tauri-bridge",
  inject: ["ipc", "settings"],
  apply(ctx: Context) {
    return registerTauriBridgeEvents(ipcRegistrar(ctx));
  },
};
