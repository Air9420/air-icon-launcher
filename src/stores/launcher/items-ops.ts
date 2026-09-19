/**
 * Thin adapter: pinia launcher store → shared domain ops.
 *
 * All CRUD/icon/lnk/import logic lives in `src/kernel/domain/apps-item-ops.ts`.
 * This module only maps store refs/helpers into an `AppsItemOpsState` and
 * forwards. No dual implementation paths — kernel-present writes go through
 * `ctx.apps` (which calls the same ops*); no-kernel tests use these forwards.
 */
import type { Ref } from "vue";
import {
  cacheOriginalIconForFileItem,
  getCachedOriginalIconForPath as getCachedOriginalIconForPathDefault,
  type LauncherItemRef,
} from "../../composables/useItemsHelper";
import { itemEventBus } from "../../events/itemEvents";
import type { AppsService } from "../../kernel/services/apps-service";
import {
  applyRemoveDependenciesMatching,
  applyRemapDependencyCategoryRefs,
  collectLnkTargetsFromEntries,
  opsAddFileItems,
  opsAddFileItemsBatched,
  opsAddUrlItem,
  opsApplyDropIcons,
  opsCreateItemInCategory,
  opsDeleteCategoryCleanup,
  opsMoveItems,
  opsQueueResolveLnkTargets,
  opsRemoveItem,
  opsRemoveItems,
  opsResetItemIcon,
  opsSetItemResolvedPath,
  opsUpdateItem,
  opsUpdateItemIcon,
  opsUpdateItems,
  type AppsItemOpsState,
  type DomainItemPatch,
} from "../../kernel/domain/apps-item-ops";
import type {
  AddPathsPayload,
  CreateItemPayload,
  LauncherItem,
  RecentUsedItem,
} from "./types";

export {
  applyRemoveDependenciesMatching,
  applyRemapDependencyCategoryRefs,
  collectLnkTargetsFromEntries,
  opsQueueResolveLnkTargets as queueResolveLnkTargets,
};

export type IconUpdateKind = "derived" | "custom";

export type ItemsOpsContext = {
  /** Kept for call-site compatibility; domain ops write `itemsByCategoryId` directly. */
  getItems?: (categoryId: string) => LauncherItem[];
  setItems?: (categoryId: string, items: LauncherItem[]) => void;
  getById?: (categoryId: string, itemId: string) => LauncherItem | null;
  createId: () => string;
  pinnedItemIds: Ref<string[]>;
  recentUsedItems: Ref<RecentUsedItem[]>;
  scenarioItemIds?: Ref<Record<string, string[]>>;
  getAppsService?: () => AppsService | undefined;
  removeItemFromAllScenarios: (itemId: string) => void;
  stats: {
    removeLaunchEventsForItems: (categoryId: string, itemIds: string[]) => void;
    removeLaunchEventsForCategory: (categoryId: string) => void;
    remapLaunchEventCategoryRefs: (
      mappings: Array<{ fromCategoryId: string; toCategoryId: string; itemId: string }>,
    ) => void;
    clearLaunchHistory: () => void;
    recordSearch: (keyword: string) => void;
  };
};

export type ItemsOpsHelpers = {
  cacheIcon: (path: string, icon: string) => void;
  getCachedOriginalIconForPath: (path: string) => string | null;
  hydrateMissingIconsForItems: (
    targets: LauncherItemRef[],
    options?: { forceReplace?: boolean; skipCache?: boolean; maxEdge?: number },
  ) => Promise<unknown>;
  refreshLauncherItemUrlFavicon: (
    categoryId: string,
    itemId: string,
    url: string,
    updateIcon: (categoryId: string, itemId: string, iconBase64: string) => void,
  ) => Promise<unknown> | void;
  removeCachedIconsForCategory: (categoryId: string) => void;
  itemsByCategoryId: Ref<Record<string, LauncherItem[]>>;
};

export function toAppsItemOpsState(
  ctx: ItemsOpsContext,
  helpers: ItemsOpsHelpers,
): AppsItemOpsState {
  return {
    itemsByCategoryId: helpers.itemsByCategoryId as AppsItemOpsState["itemsByCategoryId"],
    pinnedItemIds: ctx.pinnedItemIds,
    recentUsedItems: ctx.recentUsedItems as AppsItemOpsState["recentUsedItems"],
    createId: ctx.createId,
    emit: (event) => itemEventBus.emit(event),
    stats: ctx.stats,
    removeItemFromAllScenarios: ctx.removeItemFromAllScenarios,
    cacheOriginalIcon: cacheOriginalIconForFileItem,
    getCachedOriginalIconForPath:
      helpers.getCachedOriginalIconForPath ?? getCachedOriginalIconForPathDefault,
    cacheIcon: helpers.cacheIcon,
    hydrateMissingIconsForItems: helpers.hydrateMissingIconsForItems as
      AppsItemOpsState["hydrateMissingIconsForItems"],
    refreshLauncherItemUrlFavicon: helpers.refreshLauncherItemUrlFavicon as
      AppsItemOpsState["refreshLauncherItemUrlFavicon"],
    removeCachedIconsForCategory: helpers.removeCachedIconsForCategory,
  };
}

/** Bind store refs/helpers to shared domain ops — used by the pinia shell. */
export function bindItemsOps(ctx: ItemsOpsContext, helpers: ItemsOpsHelpers) {
  const state = toAppsItemOpsState(ctx, helpers);
  return {
    updateItem: (categoryId: string, itemId: string, patch: DomainItemPatch) =>
      opsUpdateItem(state, categoryId, itemId, patch),
    updateItems: (
      categoryId: string,
      itemIds: string[],
      patch: Partial<Pick<LauncherItem, "launchDelaySeconds">>,
    ) => opsUpdateItems(state, categoryId, itemIds, patch),
    deleteItem: (categoryId: string, itemId: string) =>
      opsRemoveItem(state, categoryId, itemId),
    deleteItems: (categoryId: string, itemIds: string[]) =>
      opsRemoveItems(state, categoryId, itemIds),
    moveItems: (source: string, target: string, itemIds: string[]) =>
      opsMoveItems(state, source, target, itemIds),
    addItems: (categoryId: string, payload: AddPathsPayload) =>
      opsAddFileItems(state, categoryId, payload),
    addItemsBatched: (categoryId: string, payload: AddPathsPayload, batchSize?: number) =>
      opsAddFileItemsBatched(state, categoryId, payload, batchSize),
    applyDropIcons: (
      categoryId: string,
      paths: string[],
      iconBase64s: Array<string | null>,
    ) => opsApplyDropIcons(state, categoryId, paths, iconBase64s),
    addUrlItem: (
      categoryId: string,
      payload: { name: string; url: string; icon_base64?: string | null },
    ) => opsAddUrlItem(state, categoryId, payload),
    createItem: (categoryId: string, payload: CreateItemPayload) =>
      opsCreateItemInCategory(state, categoryId, payload),
    updateItemIcon: (categoryId: string, itemId: string, icon: string) =>
      opsUpdateItemIcon(state, "derived", categoryId, itemId, icon),
    setItemIcon: (categoryId: string, itemId: string, icon: string) =>
      opsUpdateItemIcon(state, "custom", categoryId, itemId, icon),
    resetItemIcon: (categoryId: string, itemId: string) =>
      opsResetItemIcon(state, categoryId, itemId),
    setResolvedPath: (
      categoryId: string,
      itemId: string,
      resolvedPath: string | null | undefined,
    ) => opsSetItemResolvedPath(state, categoryId, itemId, resolvedPath),
    deleteCategoryCleanup: (categoryId: string) =>
      opsDeleteCategoryCleanup(state, categoryId),
  };
}
