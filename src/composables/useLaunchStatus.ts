import { shallowRef, triggerRef, type Ref, onScopeDispose } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

export type LaunchStatus = "launching" | "success";

export interface UseLaunchStatusOptions {
    autoHideAfterLaunch?: Ref<boolean>;
}

export function useLaunchStatus(options: UseLaunchStatusOptions = {}) {
    const { autoHideAfterLaunch } = options;
    const launchStatusMap = shallowRef<Map<string, LaunchStatus>>(new Map());

    let isCtrlPressed = false;
    let hasLaunchedWhileCtrlPressed = false;
    let hideTimeout: ReturnType<typeof setTimeout> | null = null;
    let unlistenCtrlReleased: (() => void) | null = null;

    // 监听后端 Ctrl 释放事件（全局钩子，不受焦点影响）
    listen("ctrl-released", () => {
        isCtrlPressed = false;
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        if (hasLaunchedWhileCtrlPressed && autoHideAfterLaunch?.value) {
            getCurrentWindow().hide();
        }
        hasLaunchedWhileCtrlPressed = false;
    }).then((unlisten) => {
        unlistenCtrlReleased = unlisten;
    });

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Control" || e.ctrlKey) {
            isCtrlPressed = true;
        }
    }

    function onKeyUp(e: KeyboardEvent) {
        if (e.key === "Control" || e.ctrlKey) {
            isCtrlPressed = false;
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            if (hasLaunchedWhileCtrlPressed && autoHideAfterLaunch?.value) {
                getCurrentWindow().hide();
            }
            hasLaunchedWhileCtrlPressed = false;
        }
    }

    if (typeof window !== "undefined") {
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
    }

    function setLaunchStatus(itemId: string, status: LaunchStatus) {
        launchStatusMap.value.set(itemId, status);
        triggerRef(launchStatusMap);
        if (status === "success") {
            if (isCtrlPressed) {
                hasLaunchedWhileCtrlPressed = true;
            }
            if (autoHideAfterLaunch?.value) {
                if (isCtrlPressed) {
                    if (hideTimeout) {
                        clearTimeout(hideTimeout);
                    }
                    hideTimeout = setTimeout(() => {
                        if (!isCtrlPressed && hasLaunchedWhileCtrlPressed) {
                            getCurrentWindow().hide();
                        }
                        hideTimeout = null;
                    }, 500);
                } else {
                    if (hideTimeout) {
                        clearTimeout(hideTimeout);
                        hideTimeout = null;
                    }
                    getCurrentWindow().hide();
                }
            }
            setTimeout(() => {
                launchStatusMap.value.delete(itemId);
                triggerRef(launchStatusMap);
            }, 2000);
        }
    }

    function clearLaunchStatus(itemId: string) {
        launchStatusMap.value.delete(itemId);
        triggerRef(launchStatusMap);
    }

    function getLaunchStatus(itemId: string): LaunchStatus | undefined {
        return launchStatusMap.value.get(itemId);
    }

    function isLaunching(itemId: string): boolean {
        return launchStatusMap.value.get(itemId) === "launching";
    }

    function isSuccess(itemId: string): boolean {
        return launchStatusMap.value.get(itemId) === "success";
    }

    function cleanup() {
        if (typeof window !== "undefined") {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        }
        if (unlistenCtrlReleased) {
            unlistenCtrlReleased();
            unlistenCtrlReleased = null;
        }
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
    }

    // Vue scope 自动清理
    onScopeDispose(() => {
        cleanup();
    });

    return {
        launchStatusMap,
        setLaunchStatus,
        clearLaunchStatus,
        getLaunchStatus,
        isLaunching,
        isSuccess,
        cleanup,
    };
}

export type LaunchStatusComposable = ReturnType<typeof useLaunchStatus>;
