import type { DropTargetInfo } from "./types";
import { getDropTargetInfoAtPoint as probeDropTarget } from "../kernel/plugins/drop-target";
import {
  dragDropLastDrop,
  dragDropProcessedIds,
} from "../kernel/runtime/ui-shell-state";

export interface UseDragDropOptions {
    getDropTargetInfoAtPoint: (x: number, y: number) => DropTargetInfo | null;
}

/**
 * Drag-drop state adapter for App.vue menu actions.
 *
 * Initialization (Tauri listeners) lives in kernel `ui-shell-runtime` plugin (P7).
 * State refs are module-level so App.vue and the plugin share the same objects.
 */
export function useDragDrop(_options?: UseDragDropOptions) {
    const lastDrop = dragDropLastDrop;
    const processedDropIds = dragDropProcessedIds;

    function initializeDragDrop() {
        // no-op: owned by kernel ui-shell-runtime plugin (P7)
    }

    function cleanupDragDrop() {
        // no-op: owned by kernel ui-shell-runtime plugin (P7)
    }

    return {
        lastDrop,
        processedDropIds,
        initializeDragDrop,
        cleanupDragDrop,
    };
}

export type DragDropComposable = ReturnType<typeof useDragDrop>;

/** Re-export probe for callers that still use the composable API. */
export function getDropTargetInfoAtPoint(x: number, y: number): DropTargetInfo | null {
    return probeDropTarget(x, y) as DropTargetInfo | null;
}
