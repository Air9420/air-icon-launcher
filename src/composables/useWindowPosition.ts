import { storeToRefs } from "pinia";
import { getCurrentWindow, availableMonitors, primaryMonitor, type Monitor } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { useSettingsStore, type WindowPosition } from "../stores/settingsStore";
import { getCurrentMonitorFingerprint } from "../utils/system-commands";

const POSITION_SAVE_DEBOUNCE_MS = 400;

function buildMonitorFingerprint(monitor: Monitor): string {
    return `${monitor.name ?? "unknown"}::${monitor.position.x}:${monitor.position.y}::${monitor.size.width}x${monitor.size.height}::${monitor.scaleFactor.toFixed(3)}`;
}

export function useWindowPosition() {
    const settingsStore = useSettingsStore();
    const { windowPosition } = storeToRefs(settingsStore);

    const unlisteners: UnlistenFn[] = [];
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    async function saveWindowPosition(): Promise<void> {
        try {
            const win = getCurrentWindow();
            const position = await win.outerPosition();
            const monitor = await getCurrentMonitorFingerprint();
            
            const pos: WindowPosition = {
                x: position.x,
                y: position.y,
                monitorId: monitor?.fingerprint ?? null,
                monitorName: monitor?.name ?? undefined,
                savedAt: Date.now(),
            };
            
            settingsStore.setWindowPosition(pos);
        } catch (e) {
            console.error("[WindowPosition] Failed to save position:", e);
        }
    }

    function debouncedSave(): void {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        saveTimeout = setTimeout(() => {
            void saveWindowPosition();
        }, POSITION_SAVE_DEBOUNCE_MS);
    }

    async function restoreWindowPosition(): Promise<boolean> {
        if (!windowPosition.value) {
            return false;
        }

        try {
            const win = getCurrentWindow();
            const monitors = await availableMonitors();
            const savedMonitor = monitors.find((m) => {
                const monitorId = buildMonitorFingerprint(m);
                return monitorId === windowPosition.value!.monitorId;
            });

            if (!savedMonitor && windowPosition.value.monitorId) {
                return false;
            }

            const targetMonitor = savedMonitor || await primaryMonitor();
            if (!targetMonitor) {
                return false;
            }

            const workArea = targetMonitor.workArea;
            const windowSize = await win.outerSize();
            let x = windowPosition.value.x;
            let y = windowPosition.value.y;

            const minX = workArea.position.x;
            const maxX = workArea.position.x + workArea.size.width - windowSize.width;
            const minY = workArea.position.y;
            const maxY = workArea.position.y + workArea.size.height - windowSize.height;

            x = Math.max(minX, Math.min(x, maxX));
            y = Math.max(minY, Math.min(y, maxY));

            await win.setPosition(new PhysicalPosition({ x, y }));
            return true;
        } catch (e) {
            console.error("[WindowPosition] Failed to restore position:", e);
            return false;
        }
    }

    async function initializePositionTracking(): Promise<void> {
        const win = getCurrentWindow();

        const unlistenMove = await win.onMoved(() => {
            debouncedSave();
        });
        unlisteners.push(unlistenMove);

        const unlistenClose = await win.onCloseRequested(async () => {
            if (saveTimeout) {
                clearTimeout(saveTimeout);
                saveTimeout = null;
            }
            await saveWindowPosition();
        });
        unlisteners.push(unlistenClose);

        const unlistenFocus = await win.onFocusChanged(async ({ payload: focused }) => {
            if (!focused) {
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                    saveTimeout = null;
                }
                await saveWindowPosition();
            }
        });
        unlisteners.push(unlistenFocus);

        window.addEventListener("beforeunload", saveWindowPosition);
    }

    function cleanupPositionTracking(): void {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
        unlisteners.forEach((unlisten) => unlisten());
        unlisteners.length = 0;
        window.removeEventListener("beforeunload", saveWindowPosition);
    }

    return {
        saveWindowPosition,
        restoreWindowPosition,
        initializePositionTracking,
        cleanupPositionTracking,
    };
}

export type WindowPositionComposable = ReturnType<typeof useWindowPosition>;
