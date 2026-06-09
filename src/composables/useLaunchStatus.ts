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
    let unlistenFocusChanged: (() => void) | null = null;

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Control" || e.ctrlKey) {
            isCtrlPressed = true;
            console.log("[Ctrl-Multi] Ctrl pressed");
        }
    }

    function onKeyUp(e: KeyboardEvent) {
        if (e.key === "Control" || e.ctrlKey) {
            console.log("[Ctrl-Multi] Ctrl released, hasLaunched:", hasLaunchedWhileCtrlPressed);
            isCtrlPressed = false;
            stopFocusListener();
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            if (hasLaunchedWhileCtrlPressed && autoHideAfterLaunch?.value) {
                console.log("[Ctrl-Multi] hiding window");
                getCurrentWindow().hide();
            }
            hasLaunchedWhileCtrlPressed = false;
        }
    }

    async function startFocusListener() {
        if (unlistenFocusChanged) return;
        const win = getCurrentWindow();
        
        // 监听后端的焦点变化事件（WinAPI SetWinEventHook，更可靠）
        unlistenFocusChanged = await listen("focus-changed", async () => {
            if (isCtrlPressed && hasLaunchedWhileCtrlPressed) {
                const focused = await win.isFocused();
                if (!focused) {
                    console.log("[Ctrl-Multi] focus lost via WinAPI event");
                    win.setFocus();
                }
            }
        });
    }

    function stopFocusListener() {
        if (unlistenFocusChanged) {
            unlistenFocusChanged();
            unlistenFocusChanged = null;
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
            console.log("[Ctrl-Multi] launch success, isCtrlPressed:", isCtrlPressed);
            if (isCtrlPressed) {
                hasLaunchedWhileCtrlPressed = true;
                console.log("[Ctrl-Multi] starting focus listener");
                startFocusListener();
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
        stopFocusListener();
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
    }

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
