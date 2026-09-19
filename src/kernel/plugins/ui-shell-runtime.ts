import type { Context, Plugin } from "cordis";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { storeToRefs } from "pinia";
import router from "../../router";
import { setPageUnloading, safeInvoke } from "../../utils/invoke-wrapper";
import {
  useSettingsStore,
  useGuideStore,
  useUIStore,
  useCategoryStore,
  Store,
} from "../../stores";
import { useWindowPosition } from "../../composables/useWindowPosition";
import { enumContextMenuType } from "../../menus/contextMenuTypes";
import { hideWindowAndStartMemoryRelease } from "../../utils/window-memory";
import {
  appIsTransitioning,
  autoHideIsCountingDown,
  dragDropLastDrop,
  dragDropProcessedIds,
} from "../runtime/ui-shell-state";
import { ensureSettingsBoot } from "./boot-coordination";
import { ipcRegistrar, type KernelEventRegistrar } from "./event-types";
import { getDropTargetInfoAtPoint } from "./drop-target";
import type { DropRecord, DropIconsEvent } from "../../composables/types";
import type { Disposer } from "../types";

const PROCESSED_DROP_TTL_MS = 5 * 60 * 1000;
const MAX_PROCESSED_DROP_IDS = 200;
const __DEV_LOG__ = false;

const processedDropTimestamps = new Map<string, number>();
const pendingDropPaths = new Map<string, { categoryId: string; paths: string[] }>();

function pruneProcessedDropIds(now: number = Date.now()): void {
  for (const [dropId, timestamp] of processedDropTimestamps.entries()) {
    if (now - timestamp > PROCESSED_DROP_TTL_MS) {
      processedDropTimestamps.delete(dropId);
      dragDropProcessedIds.delete(dropId);
    }
  }
  while (dragDropProcessedIds.size > MAX_PROCESSED_DROP_IDS) {
    const oldest = processedDropTimestamps.entries().next().value as
      | [string, number]
      | undefined;
    if (!oldest) break;
    processedDropTimestamps.delete(oldest[0]);
    dragDropProcessedIds.delete(oldest[0]);
  }
}

function registerDragDropListeners(on: KernelEventRegistrar): Disposer {
  const store = Store();
  const categoryStore = useCategoryStore();

  const offDrop = on<DropRecord>("drag-drop", async (event) => {
    dragDropLastDrop.value = event.payload;
    const { drop_id, position, paths, directories } = event.payload;
    pruneProcessedDropIds();
    const target = getDropTargetInfoAtPoint(position.x, position.y);
    await safeInvoke("report_drop_target", { dropId: drop_id, target });

    const menuType = target?.dataset?.menuType as enumContextMenuType | undefined;
    const categoryId = target?.dataset?.categoryId;

    if (
      (menuType === enumContextMenuType.IconView ||
        menuType === enumContextMenuType.IconItem ||
        menuType === enumContextMenuType.HomeGroupItem) &&
      categoryId &&
      paths?.length &&
      !dragDropProcessedIds.has(drop_id)
    ) {
      if (__DEV_LOG__) {
        console.log(`[拖拽添加] 开始添加 ${paths.length} 个启动项到分类 ${categoryId}`);
      }

      const ids = await store.addLauncherItemsToCategoryBatched(categoryId, {
        paths,
        directories,
        icon_base64s: paths.map(() => null),
      });

      pendingDropPaths.set(drop_id, { categoryId, paths });
      dragDropProcessedIds.add(drop_id);
      processedDropTimestamps.set(drop_id, Date.now());
      categoryStore.setCurrentCategory(categoryId);

      if (__DEV_LOG__) {
        const allItems = store.getLauncherItemsByCategoryId(categoryId);
        const idSet = new Set(allItems.map((i) => i.id));
        const hasCollision = idSet.size !== allItems.length;
        console.log(
          `[拖拽添加] 完成添加 ${ids.length} 个启动项，分类下共 ${allItems.length} 个` +
            (hasCollision ? " ⚠️ 检测到ID碰撞！" : ""),
        );
      }
    }
  });

  const offIcons = on<DropIconsEvent>("drag-drop-icons", (event) => {
    const { drop_id, icon_base64s } = event.payload;
    pruneProcessedDropIds();
    const pending = pendingDropPaths.get(drop_id);
    if (!pending) return;

    const { categoryId, paths } = pending;
    store.applyDropIcons(categoryId, paths, icon_base64s);
    pendingDropPaths.delete(drop_id);
  });

  return () => {
    offDrop();
    offIcons();
  };
}

/** Global DOM guards + ctrl-right-click hide. closeContextMenu via uiStore. */
function registerGlobalDomEvents(): Disposer {
  const uiStore = useUIStore();

  function closeContextMenu() {
    uiStore.closeContextMenu();
  }

  function preventRefreshShortcuts(e: KeyboardEvent) {
    if (import.meta.env.DEV) return;
    const key = e.key.toLowerCase();
    if ((key === "r" && e.ctrlKey) || key === "f5") {
      e.preventDefault();
      e.stopPropagation();
    }
    if (key === "f" && e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onContextMenu(ev: MouseEvent) {
    ev.preventDefault();
  }

  function onGlobalClick() {
    closeContextMenu();
  }

  function onWindowBlur() {
    closeContextMenu();
  }

  async function onGlobalMouseDown(event: MouseEvent) {
    const settingsStore = useSettingsStore();
    if (settingsStore.hideOnCtrlRightClick && event.ctrlKey && event.button === 2) {
      try {
        await hideWindowAndStartMemoryRelease(getCurrentWindow(), async () => {
          await safeInvoke("start_memory_release");
        });
      } catch (e) {
        console.error(e);
      }
    }
  }

  function onGlobalKeyDown(ev: KeyboardEvent) {
    if (ev.key === "Escape") closeContextMenu();
  }

  window.addEventListener("keydown", preventRefreshShortcuts, true);
  document.addEventListener("contextmenu", onContextMenu, { capture: true });
  window.addEventListener("click", onGlobalClick);
  window.addEventListener("keydown", onGlobalKeyDown);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("mousedown", onGlobalMouseDown);

  return () => {
    window.removeEventListener("keydown", preventRefreshShortcuts, true);
    document.removeEventListener("contextmenu", onContextMenu, { capture: true });
    window.removeEventListener("click", onGlobalClick);
    window.removeEventListener("keydown", onGlobalKeyDown);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("mousedown", onGlobalMouseDown);
  };
}

/** Ctrl+left-click window drag (settings-gated). */
function registerWindowDrag(): Disposer {
  const settingsStore = useSettingsStore();
  const { ctrlDragEnabled } = storeToRefs(settingsStore);

  function shouldExcludeFromDrag(element: HTMLElement | null): boolean {
    const interactiveTags = ["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A", "OPTION"];
    let current = element;
    let depth = 0;
    while (current && depth < 6) {
      if (interactiveTags.includes(current.tagName)) return true;
      if (current.hasAttribute("data-no-drag")) return true;
      const style = window.getComputedStyle(current);
      if (style.cursor === "pointer") return true;
      if (!current.parentElement || current.parentElement === document.body) break;
      current = current.parentElement;
      depth += 1;
    }
    return false;
  }

  function onGlobalMouseDown(event: MouseEvent) {
    if (!ctrlDragEnabled.value) return;
    if (!event.ctrlKey) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (shouldExcludeFromDrag(target)) return;
    event.preventDefault();
    void getCurrentWindow().startDragging();
  }

  window.addEventListener("mousedown", onGlobalMouseDown, true);
  return () => window.removeEventListener("mousedown", onGlobalMouseDown, true);
}

/**
 * ui-shell-runtime: headless UI shell side effects formerly in App.vue onMounted.
 *
 * Includes: transition flag, page-unloading guard, global DOM events, window
 * drag, position tracking, auto-hide focus listener, drag-drop, guide boot,
 * and first show_launcher.
 */
export const uiShellRuntimePlugin: Plugin.Object<void> = {
  name: "ui-shell-runtime",
  inject: ["ipc", "settings"],
  apply(ctx: Context) {
    // Sync first: tauri-bridge handlers may fire immediately after microtask.
    (window as unknown as Record<string, unknown>).__appIsTransitioning = appIsTransitioning;
    setPageUnloading(false);

    const disposers: Disposer[] = [];
    const on = ipcRegistrar(ctx);

    disposers.push(registerGlobalDomEvents());
    disposers.push(registerWindowDrag());
    disposers.push(registerDragDropListeners(on));

    const bootTask = (async () => {
      // Position tracking
      const { initializePositionTracking, cleanupPositionTracking, restoreWindowPosition } =
        useWindowPosition();
      await initializePositionTracking();
      disposers.push(cleanupPositionTracking);

      // Auto-hide focus listener
      const win = getCurrentWindow();
      const settingsStore = useSettingsStore();
      const { autoHideEnabled } = storeToRefs(settingsStore);

      let unlistenFocus: (() => void) | null = null;
      const cleanupFocus = () => {
        autoHideIsCountingDown.value = false;
        if (unlistenFocus) {
          unlistenFocus();
          unlistenFocus = null;
        }
      };
      cleanupFocus();
      unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        if (!autoHideEnabled.value) {
          autoHideIsCountingDown.value = false;
          return;
        }
        if (focused) {
          autoHideIsCountingDown.value = false;
        } else {
          autoHideIsCountingDown.value = true;
        }
      });
      disposers.push(cleanupFocus);

      const offWindowShown = ctx.ipc.on("window-shown", () => {
        autoHideIsCountingDown.value = false;
      });
      disposers.push(offWindowShown);

      // Settings-dependent boot: guide + show launcher
      await ensureSettingsBoot();

      const guideStore = useGuideStore();
      const store = Store();
      const hasLauncherItems = Object.values(store.launcherItemsByCategoryId).some(
        (items) => items.length > 0,
      );
      const { showGuideOnStartup } = storeToRefs(settingsStore);

      if (showGuideOnStartup.value && !guideStore.hasSeenOnboarding && !hasLauncherItems) {
        await router.replace("/ai-organizer");
      } else if (showGuideOnStartup.value && !guideStore.hasSeenOnboarding) {
        guideStore.startOnboarding();
      }

      const isAutostartResult = await ctx.ipc.invoke<boolean>("check_is_autostart_launch");
      const isAutostart = isAutostartResult.ok ? isAutostartResult.value : false;
      console.log("[App] onMounted", { isAutostart });
      if (!isAutostart) {
        try {
          const restored = await restoreWindowPosition();
          console.log("[App] calling show_launcher", { restored });
          await safeInvoke("show_launcher", restored ? { forceNoFollow: true } : {});
        } catch (e) {
          console.error("[App] Failed to show window:", e);
        }
      }
    })();

    return async () => {
      setPageUnloading(true);
      try {
        await bootTask;
      } catch {
        /* boot may have failed; still dispose listeners */
      }
      const { saveWindowPosition } = useWindowPosition();
      await saveWindowPosition();
      for (const dispose of disposers) dispose();
      delete (window as unknown as Record<string, unknown>).__appIsTransitioning;
    };
  },
};
