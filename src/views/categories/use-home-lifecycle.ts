import { ref, watch, type Ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { PinnedMergedItem } from "../../stores";
import type { HomeRecentDisplayItem } from "../../composables/useHomePageState";
import { getSearchShortcutIndex, getHomeShortcutTarget } from "../../utils/search-ui";
import {
    hasSameRecentKeyOrder,
    isExternalToInternalPathReplacement,
    collectVisibleHomeHydrationTargets,
    getHomeIconMaxEdge,
    getDocumentVisibilityHints,
} from "./home-hydration-helpers";
import { shouldSkipVisibleHydration } from "../../utils/window-visibility";

const RECENT_STABILIZE_DELAY_MS = 280;
const HOME_PINNED_ICON_HYDRATION_BUFFER = 2;
const HOME_RECENT_ICON_HYDRATION_BUFFER = 2;

export function stabilizeRecentDisplayItems(
    next: HomeRecentDisplayItem[],
    previous: HomeRecentDisplayItem[]
): { items: HomeRecentDisplayItem[]; delayed: boolean } {
    if (next.length < previous.length) {
        return { items: [...next], delayed: false };
    }
    if (previous.length === 0 || next.length === 0) {
        return { items: [...next], delayed: false };
    }
    if (hasSameRecentKeyOrder(previous, next)) {
        return { items: [...next], delayed: false };
    }
    if (isExternalToInternalPathReplacement(previous, next)) {
        return { items: [...next], delayed: false };
    }
    return { items: [...next], delayed: true };
}

export type HomeKeyboardDeps = {
    searchKeyword: Ref<string>;
    homeSearchViewState: Ref<string>;
    showShortcutHints: Ref<boolean>;
    showSearchHistoryPanel: Ref<boolean>;
    pinnedMergedItems: Ref<PinnedMergedItem[]>;
    stableRecentDisplayItems: Ref<HomeRecentDisplayItem[]>;
    totalSearchItemCount: Ref<number>;
    selectedIndex: Ref<number>;
    closeSearchHistoryPanel: () => void;
    clearSearchForEscape: () => void;
    triggerSearchSelectionAt: (index: number) => void;
    launchPinned: (item: PinnedMergedItem) => void;
    launchRecent: (item: HomeRecentDisplayItem) => void;
    rotateHomeTabCycle: (reverse?: boolean) => void;
    isHomeKeyboardNavActive: () => boolean;
    moveHomeSelectionByKey: (key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight") => void;
    triggerHomeSelection: () => void;
};

export function createHomeKeyboardHandlers(deps: HomeKeyboardDeps) {
    function onKeydown(e: KeyboardEvent) {
        const hasBlockingDialog = !!document.querySelector(".confirm-overlay, .input-overlay");
        if (e.key === "Escape" && deps.showSearchHistoryPanel.value) {
            deps.closeSearchHistoryPanel();
            return;
        }

        if (e.key === "Escape" && deps.searchKeyword.value.trim() && !hasBlockingDialog) {
            e.preventDefault();
            deps.clearSearchForEscape();
            return;
        }

        if (e.key === "Control") {
            deps.showShortcutHints.value = true;
            return;
        }

        if (e.ctrlKey && !e.altKey && !e.metaKey) {
            deps.showShortcutHints.value = true;
            const shortcutIndex = getSearchShortcutIndex(e);
            if (shortcutIndex !== null) {
                if (!deps.searchKeyword.value.trim()) {
                    e.preventDefault();
                    const target = getHomeShortcutTarget(
                        shortcutIndex,
                        deps.pinnedMergedItems.value.length,
                        deps.stableRecentDisplayItems.value.length
                    );
                    if (target) {
                        if (target.type === "pinned") {
                            deps.launchPinned(deps.pinnedMergedItems.value[target.index]);
                        } else if (target.type === "recent") {
                            deps.launchRecent(deps.stableRecentDisplayItems.value[target.index]);
                        }
                    }
                    return;
                }

                e.preventDefault();
                if (shortcutIndex >= deps.totalSearchItemCount.value) {
                    return;
                }
                deps.selectedIndex.value = shortcutIndex;
                deps.triggerSearchSelectionAt(shortcutIndex);
                return;
            }
        }

        const isSearchMode = !!deps.searchKeyword.value.trim();

        if (!isSearchMode && deps.homeSearchViewState.value === "home") {
            if (e.key === "Tab") {
                e.preventDefault();
                deps.rotateHomeTabCycle(e.shiftKey);
                return;
            }

            if (
                e.key === "ArrowDown"
                || e.key === "ArrowUp"
                || e.key === "ArrowLeft"
                || e.key === "ArrowRight"
            ) {
                if (!deps.isHomeKeyboardNavActive()) return;
                e.preventDefault();
                deps.moveHomeSelectionByKey(e.key as "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight");
                return;
            }

            if (e.key === "Enter") {
                if (!deps.isHomeKeyboardNavActive()) return;
                e.preventDefault();
                deps.triggerHomeSelection();
                return;
            }
        }

        if (!isSearchMode || deps.totalSearchItemCount.value === 0) {
            return;
        }

        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab") {
            return;
        }
    }

    function onKeyup(e: KeyboardEvent) {
        if (e.key === "Control" || !e.ctrlKey) {
            deps.showShortcutHints.value = false;
        }
    }

    return { onKeydown, onKeyup };
}

export type HomeWindowSetupOptions = {
    onKeydown: (e: KeyboardEvent) => void;
    onKeyup: (e: KeyboardEvent) => void;
    onDocumentMouseDown: (e: MouseEvent) => void;
    onWindowBlur: () => void;
    hydrateVisibleSearchResultIcons: () => void;
    applyWindowShownReset: () => void;
    applyFocusGained: () => void;
    applyFocusLost: () => void;
    setWindowFocused: (v: boolean) => void;
    setWindowVisibility: (v: "visible" | "hidden") => void;
    resetHomeKeyboardNav: () => void;
    externalConvertEvent: string;
    onExternalConvertDragStart: EventListener;
    onExternalConvertPointerMove: EventListener;
    onExternalConvertPointerUp: EventListener;
    cancelExternalConvertDrag: () => void;
    onWindowFocusChangedCleanup?: () => void;
};

export async function setupHomeWindowListeners(options: HomeWindowSetupOptions): Promise<() => void> {
    const win = getCurrentWindow();
    try {
        options.setWindowVisibility((await win.isVisible()) ? "visible" : "hidden");
        options.setWindowFocused(await win.isFocused());
    } catch {
        options.setWindowVisibility("visible");
        options.setWindowFocused(true);
    }

    document.addEventListener("keydown", options.onKeydown);
    document.addEventListener("keyup", options.onKeyup);
    document.addEventListener("mousedown", options.onDocumentMouseDown, true);

    const unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        options.setWindowFocused(focused);
        if (!focused) {
            options.applyFocusLost();
            return;
        }
        options.applyFocusGained();
    });

    const unlistenShow = await listen("window-shown", () => {
        options.applyWindowShownReset();
    });

    window.addEventListener(options.externalConvertEvent, options.onExternalConvertDragStart);
    window.addEventListener("pointermove", options.onExternalConvertPointerMove, true);
    window.addEventListener("pointerup", options.onExternalConvertPointerUp, true);
    window.addEventListener("pointercancel", options.cancelExternalConvertDrag, true);
    window.addEventListener("blur", options.onWindowBlur);
    window.addEventListener("scroll", options.hydrateVisibleSearchResultIcons, true);

    return () => {
        unlistenFocus();
        unlistenShow();
        document.removeEventListener("keydown", options.onKeydown);
        document.removeEventListener("keyup", options.onKeyup);
        document.removeEventListener("mousedown", options.onDocumentMouseDown, true);
        window.removeEventListener("blur", options.onWindowBlur);
        window.removeEventListener("scroll", options.hydrateVisibleSearchResultIcons, true);
        window.removeEventListener(options.externalConvertEvent, options.onExternalConvertDragStart);
        window.removeEventListener("pointermove", options.onExternalConvertPointerMove, true);
        window.removeEventListener("pointerup", options.onExternalConvertPointerUp, true);
        window.removeEventListener("pointercancel", options.cancelExternalConvertDrag, true);
        options.cancelExternalConvertDrag();
    };
}

export function watchHomeIconHydration(options: {
    pinnedMergedItems: Ref<PinnedMergedItem[]>;
    mergedRecentDisplayItems: Ref<HomeRecentDisplayItem[]>;
    searchKeyword: Ref<string>;
    windowVisibility: Ref<string>;
    isWindowFocused: Ref<boolean>;
    uiStore: { getHomeSectionLimit: (section: "pinned" | "recent") => number };
    store: {
        hydrateLauncherIconsForVisibleItems: (
            targets: Array<{ categoryId: string; itemId: string }>,
            opts?: { maxEdge?: number }
        ) => unknown;
    };
    syncVisibleHydrationState: () => void;
}) {
    watch(
        [options.pinnedMergedItems, options.mergedRecentDisplayItems, options.searchKeyword],
        ([pinned, recent, keyword]) => {
            if (keyword.trim()) return;
            options.syncVisibleHydrationState();
            if (shouldSkipVisibleHydration(
                options.windowVisibility.value as "visible" | "hidden",
                options.isWindowFocused.value,
                getDocumentVisibilityHints()
            )) return;
            const limits = {
                pinned: Math.max(options.uiStore.getHomeSectionLimit("pinned"), 0) + HOME_PINNED_ICON_HYDRATION_BUFFER,
                recent: Math.max(options.uiStore.getHomeSectionLimit("recent"), 0) + HOME_RECENT_ICON_HYDRATION_BUFFER,
            };
            const targets = collectVisibleHomeHydrationTargets(pinned, recent, limits);
            void options.store.hydrateLauncherIconsForVisibleItems(targets, {
                maxEdge: getHomeIconMaxEdge(),
            });
        },
        { immediate: true }
    );
}

export function createRecentStabilizer(
    mergedRecentDisplayItems: Ref<HomeRecentDisplayItem[]>,
    stableRecentDisplayItems: Ref<HomeRecentDisplayItem[]>
): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = watch(mergedRecentDisplayItems, (next) => {
        const previous = stableRecentDisplayItems.value;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        const result = stabilizeRecentDisplayItems(next, previous);
        if (!result.delayed) {
            stableRecentDisplayItems.value = result.items;
            return;
        }
        timer = setTimeout(() => {
            stableRecentDisplayItems.value = result.items;
            timer = null;
        }, RECENT_STABILIZE_DELAY_MS);
    }, { immediate: true });

    return () => {
        stop();
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
}

// re-export for parent convenience
export { ref };
