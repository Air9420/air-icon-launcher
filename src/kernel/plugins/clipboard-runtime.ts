import type { Context, Plugin } from "cordis";
import { useClipboardStore, type ClipboardRecord } from "../../stores/clipboardStore";

/**
 * clipboard-runtime: register global Tauri listeners via `ctx.ipc.on`
 * (never `@tauri-apps/api/event` in App.vue).
 *
 * PERF-A: history preload + ClipboardHistory.vue prefetch are deferred to
 * idle so they do not compete with first paint / apps load / search sync.
 */
export const clipboardRuntimePlugin: Plugin.Object<void> = {
  name: "clipboard-runtime",
  inject: ["ipc"],
  apply(ctx: Context) {
    const clipboardStore = useClipboardStore();

    const scheduleIdle = (fn: () => void) => {
      if (typeof globalThis.requestIdleCallback === "function") {
        globalThis.requestIdleCallback(() => fn(), { timeout: 2000 });
        return;
      }
      setTimeout(fn, 0);
    };

    scheduleIdle(() => {
      console.log("[App] starting clipboard preload (idle)...");
      void clipboardStore
        .preloadHistory()
        .then(() => {
          console.log("[App] ✓ clipboard preload complete");
        })
        .catch(() => {});
    });

    scheduleIdle(() => {
      void import("../../components/ClipboardHistory.vue")
        .then(() => {
          console.log("[App] ✓ ClipboardHistory component preloaded (idle)");
        })
        .catch(() => {});
    });

    let skipNextClipboardChanged = false;

    const offSetFromHistory = ctx.ipc.on<boolean>("clipboard-set-from-history", (event) => {
      if (event.payload) {
        skipNextClipboardChanged = true;
      }
    });

    const offChanged = ctx.ipc.on<ClipboardRecord>("clipboard-changed", (event) => {
      if (skipNextClipboardChanged) {
        skipNextClipboardChanged = false;
        return;
      }
      clipboardStore.applyClipboardRecord(event.payload);
    });

    return () => {
      offSetFromHistory();
      offChanged();
    };
  },
};
