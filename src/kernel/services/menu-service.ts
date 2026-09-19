import { Service, type Context } from "cordis";
import type { enumContextMenuType } from "../../menus/contextMenuTypes";
import type { ContextMenuItemInput } from "../../menus/contextMenuRegistry";
import {
  clearContextMenuItemsByPlugin,
  getContextMenuContributions,
  registerContextMenuItems,
  unregisterContextMenuItems,
  type RegisteredContextMenuItem,
} from "../../menus/contextMenuRegistry";
import type { Disposer } from "../types";

/**
 * Cordis menu contribution service bound to `ctx.menus` (P6).
 *
 * Extension point for host / kernel / future Worker or Rust menu contributions.
 * Internally this is a **typed facade over `src/menus/contextMenuRegistry`** —
 * the single contribution Map — so `buildContextMenuModel` keeps a
 * **single contribution list**. Do not introduce a second registry.
 *
 * Contribution merge rules (documented):
 * - Built-in items keep order band `0–999` (as declared in `contextMenu.ts`).
 * - Registry / Cordis contributions are shifted by `+1000` when converted
 *   to render models (`contributionToMenuItem`), then sorted by
 *   `order → id`, then `before`/`after` anchors are applied.
 * - Duplicate ids across sources: last write wins in the registry Map
 *   (same pluginId+menuType replaces prior items for that source).
 *
 * Recommended usage from a Cordis plugin / host bootstrap:
 * ```ts
 * ctx.effect(() => ctx.menus.register("host:boot", menuType, items));
 * // or
 * ctx.menus.registerWithEffect("host:boot", menuType, items);
 * ```
 *
 * Business code must not `import from 'cordis'`. Vue/components use
 * `useCordis().menus`; adapters may use `getKernelContext()?.menus`.
 */
export class MenuContributionService extends Service {
  constructor(ctx: Context) {
    super(ctx, "menus");
  }

  /**
   * Register menu items for one source + menuType.
   * Returns a disposer that unregisters only that (sourceId, menuType) pair.
   *
   * Prefer wrapping with `ctx.effect` / `registerWithEffect` so Cordis
   * fiber disposal cleans contributions automatically.
   */
  register(
    sourceId: string,
    menuType: enumContextMenuType,
    items: ContextMenuItemInput[],
  ): Disposer {
    registerContextMenuItems(sourceId, menuType, items);
    return () => {
      unregisterContextMenuItems(sourceId, menuType);
    };
  }

  /**
   * Register + bind cleanup to the current Cordis fiber via `ctx.effect`.
   * Preferred entry for host/kernel plugins (P7 App.vue thinning).
   */
  registerWithEffect(
    sourceId: string,
    menuType: enumContextMenuType,
    items: ContextMenuItemInput[],
  ): Disposer {
    let dispose: Disposer | null = null;
    this.ctx.effect(() => {
      dispose = this.register(sourceId, menuType, items);
      return () => {
        dispose?.();
        dispose = null;
      };
    });
    return () => dispose?.();
  }

  /** Unregister one menuType (or all types for the source). */
  unregister(sourceId: string, menuType?: enumContextMenuType): void {
    unregisterContextMenuItems(sourceId, menuType);
  }

  /** Clear every contribution from a source (unload / error recovery). */
  clearBySource(sourceId: string): void {
    clearContextMenuItemsByPlugin(sourceId);
  }

  /**
   * Read contributions for a menu type from the single registry backend.
   * Same data `buildContextMenuModel` consumes — not a parallel list.
   */
  getContributions(menuType: enumContextMenuType): RegisteredContextMenuItem[] {
    return getContextMenuContributions(menuType);
  }
}
