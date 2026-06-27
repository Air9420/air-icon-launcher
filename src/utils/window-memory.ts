type HideableWindow = {
    hide: () => Promise<void>;
};

export async function hideWindowAndStartMemoryRelease(
    window: HideableWindow,
    startMemoryRelease: () => Promise<void> | void,
): Promise<void> {
    await window.hide();
    await startMemoryRelease();
}
