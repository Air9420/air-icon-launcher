type HideableWindow = {
    hide: () => Promise<void>;
};

/**
 * 窗口隐藏时在前端派发的事件名。
 *
 * 号标（Ctrl 数字角标）只在窗口可见时才有意义，但它的显隐只跟随 Ctrl 的
 * keydown/keyup。Ctrl+右键隐藏时 Ctrl 仍按着，窗口一隐藏就再也收不到 keyup，
 * 号标会一直残留。若等到唤起后再清，托盘这类「先显示窗口、后通知前端」的
 * 路径会先画出带号标的一帧，表现为闪烁。
 *
 * 因此在真正 hide() 之前同步派发该事件，让所有唤起路径的首帧都是干净的。
 */
export const APP_WINDOW_HIDDEN_EVENT = "app-window-hidden";

export async function hideWindowAndStartMemoryRelease(
    target: HideableWindow,
    startMemoryRelease: () => Promise<void> | void,
): Promise<void> {
    // 同步派发：必须发生在 hide() 之前，且不 await，
    // 保证号标在窗口消失前就被清掉。
    if (typeof globalThis.dispatchEvent === "function") {
        globalThis.dispatchEvent(new CustomEvent(APP_WINDOW_HIDDEN_EVENT));
    }
    await target.hide();
    await startMemoryRelease();
}
