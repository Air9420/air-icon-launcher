/**
 * @fileoverview Tauri 事件监听与管理
 * 
 * 本模块提供 Tauri 后端事件的统一监听和管理功能，包括：
 * - 托盘菜单事件处理
 * - 剪贴板快捷键事件处理
 * - 主窗口切换事件处理
 * 
 * @module composables/useTauriEvents
 * 
 * @requires @tauri-apps/api/event - Tauri 事件 API
 * @requires @tauri-apps/api/core - Tauri 核心 API
 * @requires @tauri-apps/api/window - Tauri 窗口 API
 * @requires vue-router - Vue Router
 * @requires ../stores - Pinia Store
 * 
 * @example
 * ```typescript
 * import { useTauriEvents } from './composables/useTauriEvents';
 * 
 * const { initializeTauriEvents, cleanupTauriEvents } = useTauriEvents();
 * 
 * // 在 onMounted 中初始化
 * onMounted(async () => {
 *   await initializeTauriEvents();
 * });
 * 
 * // 在 onBeforeUnmount 中清理
 * onBeforeUnmount(() => {
 *   cleanupTauriEvents();
 * });
 * ```
 */

import { listen } from "@tauri-apps/api/event";
import { safeInvoke } from "../utils/invoke-wrapper";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { useRouter } from "vue-router";
import { useWindowPosition } from "./useWindowPosition";
import { useSettingsStore } from "../stores";
import { storeToRefs } from "pinia";
import { showToast } from "./useGlobalToast";
import { useStatsStore } from "../stores/statsStore";

type SystemProcessLaunchedEvent = {
    name: string;
    path: string;
    iconBase64?: string | null;
    source?: string;
    usedAt?: number;
};

/**
 * Tauri 事件监听 Composable
 * 
 * 提供 Tauri 后端事件的统一监听和管理功能。
 * 监听的事件包括：
 * - `tray-open-settings`：托盘菜单打开设置
 * - `open-clipboard`：打开剪贴板页面
 * - `toggle-main`：切换主窗口显示/隐藏
 * 
 * @returns {Object} Tauri 事件处理相关方法
 * @returns {Function} returns.initializeTauriEvents - 初始化事件监听
 * @returns {Function} returns.cleanupTauriEvents - 清理事件监听
 * 
 * @example
 * ```typescript
 * const { initializeTauriEvents, cleanupTauriEvents } = useTauriEvents();
 * 
 * onMounted(async () => {
 *   await initializeTauriEvents();
 * });
 * 
 * onBeforeUnmount(() => {
 *   cleanupTauriEvents();
 * });
 * ```
 * 
 * @remarks
 * - 所有事件监听器都会被收集到 unlisteners 数组中
 * - 调用 cleanupTauriEvents 会移除所有监听器
 */
export function useTauriEvents() {
    const router = useRouter();

    const unlisteners: (() => void)[] = [];

    /**
     * 初始化 Tauri 事件监听
     * 
     * 注册以下事件监听器：
     * - `tray-open-settings`：托盘图标点击打开设置页面
     * - `open-clipboard`：剪贴板快捷键触发打开剪贴板页面
     * - `toggle-main`：全局快捷键触发切换主窗口
     * 
     * @returns {Promise<void>}
     * 
     * @example
     * ```typescript
     * await initializeTauriEvents();
     * ```
     * 
     * @remarks
     * - 应在组件 onMounted 中调用
     * - 所有监听器会被收集以便后续清理
     */
    async function initializeTauriEvents() {
        const unlistenTraySettings = await listen("tray-open-settings", async () => {
            router.push("/settings");
        });
        unlisteners.push(unlistenTraySettings);

        const unlistenClipboard = await listen("toggle-clipboard", async () => {
            router.push("/clipboard");
        });
        unlisteners.push(unlistenClipboard);

        const unlistenToggleMain = await listen("toggle-main", async () => {
            const currentRoute = router.currentRoute.value.path;
            const win = getCurrentWindow();
            const isVisible = await win.isVisible();
            const isFocused = await win.isFocused();
            const { saveWindowPosition, restoreWindowPosition } = useWindowPosition();
            const settingsStore = useSettingsStore();
            const { followMouseOnShow } = storeToRefs(settingsStore);

            if (currentRoute === "/categories" && isVisible && isFocused) {
                await saveWindowPosition();
                await win.hide();
            } else {
                router.push("/categories");
                if (followMouseOnShow.value) {
                    await safeInvoke("show_window_with_follow_mouse");
                } else {
                    const restored = await restoreWindowPosition();
                    if (!restored) {
                        await safeInvoke("show_window_with_follow_mouse");
                    } else {
                        await win.show();
                        await win.setFocus();
                    }
                }
                await emit("window-shown", null);
            }
        });
        unlisteners.push(unlistenToggleMain);

        const unlistenCornerHotspot = await listen("corner-hotspot-triggered", async () => {
            router.push("/categories");
            await emit("window-shown", null);
        });
        unlisteners.push(unlistenCornerHotspot);

        const unlistenNoExternalMonitor = await listen("display-no-external-monitor", async () => {
            showToast("当前只有一个显示器，无法切换投影模式", { type: "info", duration: 3000 });
        });
        unlisteners.push(unlistenNoExternalMonitor);

        const unlistenSystemProcessLaunched = await listen<SystemProcessLaunchedEvent>(
            "system-process-launched",
            ({ payload }) => {
                if (!payload?.path || !payload?.name) return;
                const statsStore = useStatsStore();
                statsStore.recordExternalLaunch({
                    path: payload.path,
                    name: payload.name,
                    source: payload.source ?? "系统启动",
                    iconBase64: payload.iconBase64 ?? null,
                    usedAt: payload.usedAt,
                });
            }
        );
        unlisteners.push(unlistenSystemProcessLaunched);

    }

    /**
     * 清理 Tauri 事件监听
     * 
     * 移除所有通过 initializeTauriEvents 注册的事件监听器。
     * 
     * @example
     * ```typescript
     * cleanupTauriEvents();
     * ```
     * 
     * @remarks
     * - 应在组件 onBeforeUnmount 中调用
     * - 防止内存泄漏和重复监听
     */
    function cleanupTauriEvents() {
        unlisteners.forEach((unlisten) => unlisten());
        unlisteners.length = 0;
    }

    return {
        initializeTauriEvents,
        cleanupTauriEvents,
    };
}

/**
 * useTauriEvents 返回值类型
 * 
 * @typedef {Object} TauriEventsComposable
 */
export type TauriEventsComposable = ReturnType<typeof useTauriEvents>;
