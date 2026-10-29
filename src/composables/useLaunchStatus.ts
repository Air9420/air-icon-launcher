import { shallowRef, triggerRef, type Ref, onScopeDispose } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeInvoke } from "../utils/invoke-wrapper";
import { hideWindowAndStartMemoryRelease } from "../utils/window-memory";

export type LaunchStatus = "launching" | "success";

export interface UseLaunchStatusOptions {
    /** 开启后，点击启动项立即隐藏窗口，不再等待启动结果。 */
    autoHideAfterLaunch?: Ref<boolean>;
}

/** 成功标记在图标上停留的时长（只有按住 Ctrl 连续启动时才看得到）。 */
const SUCCESS_STATUS_DURATION_MS = 2000;

/** Ctrl 物理状态轮询间隔：keyup 丢失时的兜底，越短越及时，但不要过密。 */
const CTRL_WATCH_INTERVAL_MS = 120;

export function useLaunchStatus(options: UseLaunchStatusOptions = {}) {
    const { autoHideAfterLaunch } = options;
    const launchStatusMap = shallowRef<Map<string, LaunchStatus>>(new Map());

    let isCtrlPressed = false;
    let hasLaunchedWhileCtrlPressed = false;
    /** 窗口当前是否因启动动作而隐藏，用于启动失败时还原。 */
    let hiddenByLaunch = false;
    /** 已排队的隐藏任务，启动失败时可取消。 */
    let pendingHide: { cancel: () => void } | null = null;
    let unlistenFocus: (() => void) | null = null;
    let focusPollInterval: ReturnType<typeof setInterval> | null = null;
    let ctrlWatchInterval: ReturnType<typeof setInterval> | null = null;

    function hideWindowNow() {
        hiddenByLaunch = true;
        void hideWindowAndStartMemoryRelease(getCurrentWindow(), async () => {
            await safeInvoke("start_memory_release");
        }).catch(console.error);
    }

    /**
     * 点击启动项即隐藏窗口，不再等启动成功。
     *
     * 用微任务而不是 setTimeout：启动项（尤其冷启动的 Steam）会把焦点抢走，
     * 窗口失焦后 WebView2 会节流定时器，0ms 的 setTimeout 可能被拖成几百毫秒，
     * 表现出来就是「首次启动要等一会儿才隐藏」。微任务不受节流影响。
     */
    function hideForLaunch() {
        if (pendingHide) return;
        let cancelled = false;
        pendingHide = { cancel: () => { cancelled = true; } };
        void Promise.resolve().then(() => {
            pendingHide = null;
            if (cancelled) return;
            hideWindowNow();
        });
    }

    /** 启动失败时把因「点击即隐藏」藏起来的窗口还原，让用户看到错误提示。 */
    function restoreAfterFailedLaunch() {
        if (pendingHide) {
            // 窗口还没真正隐藏，取消即可。
            pendingHide.cancel();
            pendingHide = null;
            return;
        }
        if (!hiddenByLaunch) return;
        hiddenByLaunch = false;
        void safeInvoke("show_launcher", { forceNoFollow: true });
    }

    function recordLaunchStatus(itemId: string, status: LaunchStatus) {
        launchStatusMap.value.set(itemId, status);
        triggerRef(launchStatusMap);
    }

    function clearRecordedStatus(itemId: string, expected?: LaunchStatus) {
        if (!launchStatusMap.value.has(itemId)) return;
        if (expected && launchStatusMap.value.get(itemId) !== expected) return;
        launchStatusMap.value.delete(itemId);
        triggerRef(launchStatusMap);
    }

    function onKeyDown(e: KeyboardEvent) {
        // 以键盘事件的修饰键状态为准，避免窗口失焦期间按下 Ctrl 被漏掉。
        const ctrlHeld = e.key === "Control" || e.ctrlKey;
        // 兜底：keyup 丢失后，任何「事件里已无 Ctrl」的按键都说明 Ctrl 松开了。
        if (isCtrlPressed && !ctrlHeld) {
            handleCtrlRelease();
        }
        isCtrlPressed = ctrlHeld;
    }

    /**
     * Ctrl 松开后的收尾：停掉焦点保持、按需隐藏窗口。
     *
     * 抽成函数是因为「松开 Ctrl」不止 keyup 一条来源——窗口失焦时 keyup
     * 会丢，需要物理状态轮询和指针事件兜底，三条路径必须走同一套收尾逻辑。
     */
    function handleCtrlRelease() {
        isCtrlPressed = false;
        stopFocusListener();
        stopCtrlWatch();
        if (hasLaunchedWhileCtrlPressed && autoHideAfterLaunch?.value) {
            hideWindowNow();
        }
        hasLaunchedWhileCtrlPressed = false;
    }

    function onKeyUp(e: KeyboardEvent) {
        if (e.key !== "Control") return;
        handleCtrlRelease();
    }

    function onPointerDown(e: PointerEvent) {
        // 鼠标事件同样携带修饰键状态：Ctrl 在窗口外按下时不会触发 keydown。
        // 若记录为按下、但事件里已无 Ctrl，说明 keyup 丢了（窗口失焦期间松开），
        // 这里补一次收尾，否则窗口会一直停在「等松开」的状态。
        if (isCtrlPressed && !e.ctrlKey) {
            handleCtrlRelease();
            return;
        }
        isCtrlPressed = e.ctrlKey;
    }

    /**
     * 物理按键状态兜底轮询。
     *
     * 按住 Ctrl 连续启动时，启动项会把焦点抢走，此时松开 Ctrl 的 keyup
     * 不会送到本窗口，`isCtrlPressed` 就会一直停在 true，窗口也就永远不隐藏。
     * 轮询 Rust 侧的 GetAsyncKeyState 可以拿到不受焦点影响的真实状态。
     *
     * 只在窗口失焦时才真的发 IPC：有焦点时 keyup 一定送得到，无需兜底。
     */
    function startCtrlWatch() {
        if (ctrlWatchInterval) return;
        ctrlWatchInterval = setInterval(() => {
            if (!isCtrlPressed || !hasLaunchedWhileCtrlPressed) {
                stopCtrlWatch();
                return;
            }
            // 有焦点时 keyup 正常送达，跳过 IPC。
            if (typeof document !== "undefined" && document.hasFocus()) return;

            void safeInvoke<boolean>("is_ctrl_key_pressed").then((pressed) => {
                // 仅在明确读到「已松开」时收尾；读取失败返回 null 时保持现状。
                if (pressed === false && isCtrlPressed) {
                    handleCtrlRelease();
                }
            });
        }, CTRL_WATCH_INTERVAL_MS);
    }

    function stopCtrlWatch() {
        if (ctrlWatchInterval) {
            clearInterval(ctrlWatchInterval);
            ctrlWatchInterval = null;
        }
    }

    async function startFocusListener() {
        if (unlistenFocus) return;
        const win = getCurrentWindow();

        // Tauri 焦点事件（主要机制）：按住 Ctrl 连续启动期间保持窗口焦点。
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
        window.addEventListener("pointerdown", onPointerDown, true);
    }

    /**
     * 更新启动状态。
     *
     * 启动动画（转圈 / ✓）只在按住 Ctrl 连续启动时出现；
     * 未按住 Ctrl 时点击启动项不显示任何动画，若开启「启动即隐藏」则直接隐藏窗口。
     */
    function setLaunchStatus(itemId: string, status: LaunchStatus) {
        if (status === "launching") {
            if (isCtrlPressed) {
                hasLaunchedWhileCtrlPressed = true;
                startFocusListener();
                startCtrlWatch();
                recordLaunchStatus(itemId, "launching");
                return;
            }

            // 非 Ctrl 启动：清掉可能残留的「Ctrl 连续启动」标记，避免松开 Ctrl 时误隐藏。
            hasLaunchedWhileCtrlPressed = false;
            if (autoHideAfterLaunch?.value) {
                hideForLaunch();
            }
            return;
        }

        if (isCtrlPressed) {
            recordLaunchStatus(itemId, "success");
            setTimeout(() => clearRecordedStatus(itemId, "success"), SUCCESS_STATUS_DURATION_MS);
            return;
        }

        // 未按住 Ctrl：不展示成功动画（窗口可能已被隐藏），顺手清掉残留状态。
        clearRecordedStatus(itemId);
        hiddenByLaunch = false;
    }

    /** 启动失败时调用：清除状态，并在窗口因本次启动被隐藏时还原窗口。 */
    function clearLaunchStatus(itemId: string) {
        clearRecordedStatus(itemId);
        restoreAfterFailedLaunch();
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
            window.removeEventListener("pointerdown", onPointerDown, true);
        }
        stopFocusListener();
        stopCtrlWatch();
        if (pendingHide) {
            pendingHide.cancel();
            pendingHide = null;
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
