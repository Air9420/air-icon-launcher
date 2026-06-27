import { shallowRef, triggerRef, type Ref, onScopeDispose } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeInvoke } from "../utils/invoke-wrapper";
import { hideWindowAndStartMemoryRelease } from "../utils/window-memory";

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
    let focusPollInterval: ReturnType<typeof setInterval> | null = null;

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Control" || e.ctrlKey) {
            isCtrlPressed = true;
        }
    }

    function onKeyUp(e: KeyboardEvent) {
        if (e.key === "Control" || e.ctrlKey) {
            isCtrlPressed = false;
            stopFocusListener();
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
            if (hasLaunchedWhileCtrlPressed && autoHideAfterLaunch?.value) {
                void hideWindowAndStartMemoryRelease(getCurrentWindow(), async () => {
                    await safeInvoke("start_memory_release");
                })
                    .catch(console.error);
            }
            hasLaunchedWhileCtrlPressed = false;
        }
    }

    async function startFocusListener() {
        if (unlistenFocus) return;
        const win = getCurrentWindow();

        // Tauri 焦点事件（主要机制）
        unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
            if (!focused && isCtrlPressed && hasLaunchedWhileCtrlPressed) {
                win.setFocus();
            }
        });

        // 轮询备份（启动后 2 秒内，每 16ms 检查一次，约 60 帧）
        let elapsed = 0;
        const duration = 2000;
        const interval = 16;
        focusPollInterval = setInterval(() => {
            elapsed += interval;
            if (elapsed >= duration || !isCtrlPressed || !hasLaunchedWhileCtrlPressed) {
                stopFocusListener();
                return;
            }
            // 异步检查焦点，不阻塞轮询
            win.isFocused().then(focused => {
                if (!focused && isCtrlPressed && hasLaunchedWhileCtrlPressed) {
                    win.setFocus();
                }
            });
        }, interval);
    }

    function stopFocusListener() {
        if (unlistenFocus) {
            unlistenFocus();
            unlistenFocus = null;
        }
        if (focusPollInterval) {
            clearInterval(focusPollInterval);
            focusPollInterval = null;
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
                startFocusListener();
            }
            if (autoHideAfterLaunch?.value) {
                if (isCtrlPressed) {
                    if (hideTimeout) {
                        clearTimeout(hideTimeout);
                    }
                    hideTimeout = setTimeout(() => {
                        if (!isCtrlPressed && hasLaunchedWhileCtrlPressed) {
                            void hideWindowAndStartMemoryRelease(getCurrentWindow(), async () => {
                                await safeInvoke("start_memory_release");
                            })
                                .catch(console.error);
                        }
                        hideTimeout = null;
                    }, 500);
                } else {
                    if (hideTimeout) {
                        clearTimeout(hideTimeout);
                        hideTimeout = null;
                    }
                    void hideWindowAndStartMemoryRelease(getCurrentWindow(), async () => {
                        await safeInvoke("start_memory_release");
                    })
                        .catch(console.error);
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
