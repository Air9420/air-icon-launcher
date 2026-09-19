/**
 * Headless drop-target probe (DOM only). Shared by kernel ui-shell-runtime
 * and composables/useDragDrop.
 */
export type DropTargetProbe = {
  tag_name: string;
  id: string | null;
  class_list: string[];
  dataset: Record<string, string>;
};

export function getDropTargetInfoAtPoint(x: number, y: number): DropTargetProbe | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;

  const dataset: Record<string, string> = {};
  const baseEl = el instanceof HTMLElement ? el.closest("[data-menu-type]") ?? el : el;
  if (baseEl instanceof HTMLElement) {
    for (const [k, v] of Object.entries(baseEl.dataset)) {
      if (typeof v === "string") dataset[k] = v;
    }
  }

  return {
    tag_name: baseEl.tagName,
    id: baseEl.id ? baseEl.id : null,
    class_list: Array.from(baseEl.classList),
    dataset,
  };
}
