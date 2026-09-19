import { ref } from "vue";
import type { DropRecord } from "../../composables/types";

/**
 * Shared UI-shell runtime state between kernel plugins and App.vue.
 *
 * App.vue binds these refs in the template; plugins mutate them via
 * headless listeners. Avoids business logic living in App.vue while
 * keeping component-scoped rendering intact.
 */

/** Route/window transition opacity flag. Also mirrored on `window.__appIsTransitioning`. */
export const appIsTransitioning = ref(false);

/** Auto-hide countdown visibility for CountdownRing. */
export const autoHideIsCountingDown = ref(false);

/** Drag-drop last drop record (menu actions read this). */
export const dragDropLastDrop = ref<DropRecord | null>(null);

/** Processed drop ids (dedupe). Shared with useMenuActions. */
export const dragDropProcessedIds = new Set<string>();

export function stopAutoHideCountdown(): void {
  autoHideIsCountingDown.value = false;
}

export function startAutoHideCountdown(): void {
  autoHideIsCountingDown.value = true;
}
