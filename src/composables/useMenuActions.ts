/**
 * @fileoverview 右键菜单动作处理与分发
 *
 * 本模块提供右键菜单动作的统一处理机制。领域实现已拆至
 * `src/composables/menu-actions/**`，本文件保持对外 API 不变：
 * `useMenuActions(options) => { onMenuAction, lastAction, ... }`
 *
 * @module composables/useMenuActions
 *
 * @example
 * ```typescript
 * import { useMenuActions } from './composables/useMenuActions';
 *
 * const { onMenuAction } = useMenuActions({ ... });
 * await onMenuAction(action, context);
 * ```
 */
import { ref } from "vue";
import { useRouter } from "vue-router";
import { Store } from "../stores";
import { useCategoryStore } from "../stores/categoryStore";
import { useClipboardStore } from "../stores/clipboardStore";
import { useStatsStore } from "../stores/statsStore";
import { useUIStore } from "../stores/uiStore";
import { useGlobalToast } from "./useGlobalToast";
import { menuInvoke } from "./menu-actions/menu-invoke";
import { createAppsActions } from "./menu-actions/apps-actions";
import { createCategoryActions } from "./menu-actions/category-actions";
import { createClipboardActions } from "./menu-actions/clipboard-actions";
import { createSystemActions } from "./menu-actions/system-actions";
import { createDisplayActions } from "./menu-actions/display-actions";
import { createMenuActionDispatch } from "./menu-actions/dispatch";
import type { MenuActionDeps, UseMenuActionsOptions } from "./menu-actions/types";

export type { UseMenuActionsOptions } from "./menu-actions/types";

/**
 * 菜单动作处理 Composable
 *
 * 提供右键菜单动作的统一处理和分发功能。
 * 所有菜单动作都通过 `onMenuAction` 函数进行分发。
 */
export function useMenuActions(options: UseMenuActionsOptions) {
    const store = Store();
    const clipboardStore = useClipboardStore();
    const statsStore = useStatsStore();
    const uiStore = useUIStore();
    const categoryStore = useCategoryStore();
    const router = useRouter();
    const lastAction = ref<string>("");
    const { showToast } = useGlobalToast();

    const deps: MenuActionDeps = {
        options,
        store,
        categoryStore,
        clipboardStore,
        statsStore,
        uiStore,
        router,
        lastAction,
        closeContextMenu: options.closeContextMenu,
        showToast: (message, opts) => {
            showToast(message, opts);
        },
        menuInvoke,
    };

    const apps = createAppsActions(deps);
    const category = createCategoryActions(deps);
    const clipboard = createClipboardActions(deps);
    const system = createSystemActions(deps);
    const display = createDisplayActions(deps);
    const onMenuAction = createMenuActionDispatch(deps, {
        apps,
        category,
        clipboard,
        system,
        display,
    });

    return {
        onMenuAction,
        lastAction,
        onDeleteClipboardItem: clipboard.onDeleteClipboardItem,
        onLocateClipboardItemInHistory: clipboard.onLocateClipboardItemInHistory,
    };
}

/**
 * useMenuActions 返回值类型
 */
export type MenuActionsComposable = ReturnType<typeof useMenuActions>;
