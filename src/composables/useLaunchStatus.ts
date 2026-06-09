import { shallowRef, triggerRef, type Ref, onScopeDispose } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
    let unlistenFocus: (() => void) | null = null;

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

    // 焦点变化时，如果按住 Ctrl 且已启动过应用，抢回焦点
    function onFocusChanged(focused: boolean) {
        if (!focused && isCtrlPressed && hasLaunchedWhileCtrlPressed) {
            console.log("[Ctrl-Multi] focus lost, grabbing back");
            getCurrentWindow().setFocus();
        }
    }

    async function startFocusListener() {
        if (unlistenFocus) return;
        const win = getCurrentWindow();
        console.log("[Ctrl-Multi] registering onFocusChanged listener");
        unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
            console.log("[Ctrl-Multi] onFocusChanged triggered, focused:", focused);
            onFocusChanged(focused);
        });
        console.log("[Ctrl-Multi] onFocusChanged listener registered");
    }

    function stopFocusListener() {
        if (unlistenFocus) {
            unlistenFocus();
            unlistenFocus = null;
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
