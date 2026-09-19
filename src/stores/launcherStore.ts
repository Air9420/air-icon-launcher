import { defineStore } from "pinia";
import { computed, ref, type Ref } from "vue";
import { useCategoryStore } from "./categoryStore";
import { useStatsStore } from "./statsStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import { mergeRustSearchResults } from "./launcher-search";
import { itemEventBus } from "../events/itemEvents";
import { getKernelContext } from "../kernel/context-access";
import type { AppsService } from "../kernel/services/apps-service";
import type { SearchService } from "../kernel/services/search-service";
import {
  getCachedOriginalIconForPath,
  getNameFromPath,
  normalizeHasCustomIcon,
  useItemsHelper,
  type LauncherItemRef,
} from "../composables/useItemsHelper";
import { useSearchSync } from "../composables/useSearchSync";
import { usePinningHelper } from "../composables/usePinningHelper";

// Public types re-exported for `from "./launcherStore"` compatibility.
export type {
  LauncherItem,
  LaunchDependency,
  ScenarioKey,
  ScenarioItemIds,
  GlobalSearchResult,
  GlobalSearchMergedResult,
  RecentUsedItem,
  RecentUsedMergedItem,
  PinnedMergedItem,
  RustSearchMatchType,
  RustSearchResult,
  ImportLauncherItemsOptions,
  ImportLauncherSnapshotPayload,
} from "./launcher/types";

import type {
  GlobalSearchMergedResult,
  ImportLauncherItemsOptions,
  ImportLauncherSnapshotPayload,
  LauncherItem,
  RecentUsedItem,
  RustSearchResult,
  ScenarioItemIds,
} from "./launcher/types";
import {
  consumePendingDerivedIconRefresh,
  markPendingDerivedIconRefresh,
} from "./launcher/icon-queue";
import {
  buildScannedAppInsertPlan,
  normalizeImportedCategoryItems,
  withCategoryId,
  type ScannedAppInput,
} from "./launcher/import-utils";
import { compactDerivedFileIcon } from "./launcher/path-utils";
import {
  filterScenarioIds,
  getScenarioLaunchItemsFromMaps,
  isItemInScenarioIds,
  removeItemFromAllScenariosIds,
  toggleScenarioItemIds,
} from "./launcher/scenario-utils";
import {
  bindItemsOps,
  type ItemsOpsContext,
} from "./launcher/items-ops";
import { createLauncherStoreMethods } from "./launcher/store-methods";

function getAppsService(): AppsService | undefined {
  return getKernelContext()?.apps;
}

function getSearchService(): SearchService | undefined {
  return getKernelContext()?.search;
}

export const useLauncherStore = defineStore(
  "launcher",
  () => {
    const searchKeyword = ref<string>("");
    const appsService = getAppsService();
    const searchService = getSearchService();

    const pinnedItemIds =
      (appsService?.pinnedItemIds as Ref<string[]> | undefined) ?? ref<string[]>([]);
    const recentUsedItems =
      (appsService?.recentUsedItems as Ref<RecentUsedItem[]> | undefined) ??
      ref<RecentUsedItem[]>([]);
    const launcherItemsByCategoryId =
      (appsService?.itemsByCategoryId as Ref<Record<string, LauncherItem[]>> | undefined) ??
      ref<Record<string, LauncherItem[]>>({});
    const scenarioItemIds = ref<ScenarioItemIds>({ work: [], dev: [], play: [] });
    const rustSearchResults =
      (searchService?.results as Ref<RustSearchResult[]> | undefined) ??
      ref<RustSearchResult[]>([]);
    const isRustSearchReady = searchService?.isReady ?? ref(false);

    function createLauncherItemId() {
      return getAppsService()?.createItemId() ?? `item-${crypto.randomUUID()}`;
    }
    function getLauncherItemsByCategoryId(categoryId: string) {
      return launcherItemsByCategoryId.value[categoryId] || [];
    }
    function setLauncherItemsByCategoryId(categoryId: string, items: LauncherItem[]) {
      const apps = getAppsService();
      if (apps) {
        apps.setItemsByCategoryId(categoryId, items as never);
        return;
      }
      launcherItemsByCategoryId.value = {
        ...launcherItemsByCategoryId.value,
        [categoryId]: items,
      };
    }
    function mergeLauncherItemsByCategoryId(itemsByCategoryId: Record<string, LauncherItem[]>) {
      if (Object.keys(itemsByCategoryId).length === 0) return;
      launcherItemsByCategoryId.value = {
        ...launcherItemsByCategoryId.value,
        ...itemsByCategoryId,
      };
    }
    function getLauncherItemById(categoryId: string, itemId: string) {
      return getLauncherItemsByCategoryId(categoryId).find((x) => x.id === itemId) || null;
    }

    const itemsHelper = useItemsHelper(
      getLauncherItemsByCategoryId,
      getLauncherItemById,
      mergeLauncherItemsByCategoryId,
    );
    const searchHelper = useSearchSync(
      getLauncherItemsByCategoryId,
      getLauncherItemById,
      pinnedItemIds,
      recentUsedItems,
      isRustSearchReady,
    );
    const pinning = usePinningHelper(
      getLauncherItemsByCategoryId,
      getLauncherItemById,
      pinnedItemIds,
      recentUsedItems,
    );

    const opsCtx: ItemsOpsContext = {
      createId: createLauncherItemId,
      pinnedItemIds,
      recentUsedItems,
      removeItemFromAllScenarios: (itemId: string) => {
        scenarioItemIds.value = removeItemFromAllScenariosIds(scenarioItemIds.value, itemId);
      },
      stats: {
        removeLaunchEventsForItems: (categoryId: string, itemIds: string[]) =>
          s_stats().removeLaunchEventsForItems(categoryId, itemIds),
        removeLaunchEventsForCategory: (categoryId: string) =>
          s_stats().removeLaunchEventsForCategory(categoryId),
        remapLaunchEventCategoryRefs: (
          mappings: Array<{ fromCategoryId: string; toCategoryId: string; itemId: string }>,
        ) => s_stats().remapLaunchEventCategoryRefs(mappings),
        clearLaunchHistory: () => s_stats().clearLaunchHistory(),
        recordSearch: (keyword: string) => s_stats().recordSearch(keyword),
      },
    };

    function s_stats() {
      return useStatsStore();
    }

    async function hydrateLauncherIconsForVisibleItems(
      targets: LauncherItemRef[],
      options: { maxEdge?: number } = {},
    ): Promise<void> {
      const forcedTargets = consumePendingDerivedIconRefresh(targets);
      if (forcedTargets.length > 0) {
        await itemsHelper.hydrateMissingIconsForItems(forcedTargets, {
          forceReplace: true,
          skipCache: true,
          maxEdge: options.maxEdge,
        });
      }
      const forcedKeys = new Set(
        forcedTargets.map((t) => `${t.categoryId}:${t.itemId}`),
      );
      const normalTargets = targets.filter(
        (t) => !forcedKeys.has(`${t.categoryId}:${t.itemId}`),
      );
      if (normalTargets.length > 0) {
        await itemsHelper.hydrateMissingIconsForItems(normalTargets, {
          maxEdge: options.maxEdge,
        });
      }
    }

    async function importLauncherItems(
      items: Record<string, LauncherItem[]>,
      options: ImportLauncherItemsOptions = {},
    ) {
      const nextItems: Record<string, LauncherItem[]> = {};
      const refreshTargets: LauncherItemRef[] = [];
      for (const [categoryId, categoryItems] of Object.entries(items)) {
        const normalized = normalizeImportedCategoryItems(categoryItems, options);
        nextItems[categoryId] = normalized.items;
        if (options.refreshDerivedIcons && normalized.refreshTargets.length > 0) {
          refreshTargets.push(...withCategoryId(normalized.refreshTargets, categoryId));
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const apps = getAppsService();
      if (apps) {
        apps.importItems(nextItems as never, { emitEvents: !options.suppressEvents });
      } else {
        launcherItemsByCategoryId.value = nextItems;
        if (!options.suppressEvents) {
          for (const [categoryId, categoryItems] of Object.entries(items)) {
            for (const item of categoryItems) {
              itemEventBus.emit({ type: "item:created", categoryId, item });
            }
          }
        }
      }
      if (options.refreshDerivedIcons && refreshTargets.length > 0) {
        markPendingDerivedIconRefresh(refreshTargets);
      }
    }

    async function importLauncherSnapshot(
      snapshot: ImportLauncherSnapshotPayload,
      options: ImportLauncherItemsOptions = {},
    ) {
      await importLauncherItems(snapshot.items, { ...options, suppressEvents: true });
      const validItemIds = new Set(
        Object.values(snapshot.items).flatMap((items) => items.map((item) => item.id)),
      );
      scenarioItemIds.value = {
        work: filterScenarioIds(validItemIds, scenarioItemIds.value.work ?? []),
        dev: filterScenarioIds(validItemIds, scenarioItemIds.value.dev ?? []),
        play: filterScenarioIds(validItemIds, scenarioItemIds.value.play ?? []),
      };
      pinnedItemIds.value = [...new Set(snapshot.pinnedItemIds ?? [])];
      recentUsedItems.value = [...(snapshot.recentUsedItems ?? [])];
      useStatsStore().clearLaunchHistory();
    }

    function recordConfirmedSearch() {
      const keyword = searchKeyword.value.trim();
      if (keyword.length >= 2) useStatsStore().recordSearch(keyword);
    }

    function addScannedAppToLauncher(scannedApp: ScannedAppInput): Promise<string> {
      return (async () => {
        const apps = getAppsService();
        if (apps) return apps.addScannedApp(scannedApp);
        const plan = buildScannedAppInsertPlan(scannedApp);
        const categoryStore = useCategoryStore();
        let targetCategoryId = categoryStore.categories.find(
          (c) => c.name === plan.categoryName,
        )?.id;
        if (!targetCategoryId) {
          targetCategoryId = categoryStore.createCategoryId();
          categoryStore.categories.push({
            id: targetCategoryId,
            name: plan.categoryName,
            customIconBase64: null,
          });
        }
        const newItem = compactDerivedFileIcon({
          id: createLauncherItemId(),
          ...plan.fallbackItemWithoutId,
        });
        const existing = getLauncherItemsByCategoryId(targetCategoryId);
        setLauncherItemsByCategoryId(targetCategoryId, [...existing, newItem]);
        itemEventBus.emit({
          type: "item:created",
          categoryId: targetCategoryId,
          item: newItem,
        });
        return newItem.id;
      })();
    }

    function setRustSearchResultsWithService(results: RustSearchResult[]) {
      rustSearchResults.value = results;
      const search = getSearchService();
      if (search) search.results.value = results;
    }

    const fallbackOps = bindItemsOps(opsCtx, {
      cacheIcon: itemsHelper.cacheIcon,
      getCachedOriginalIconForPath,
      hydrateMissingIconsForItems: itemsHelper.hydrateMissingIconsForItems,
      refreshLauncherItemUrlFavicon: itemsHelper.refreshLauncherItemUrlFavicon,
      removeCachedIconsForCategory: itemsHelper.removeCachedIconsForCategory,
      itemsByCategoryId: launcherItemsByCategoryId,
    });

    const apps = getAppsService();
    const ops = apps
      ? {
          updateItem: (categoryId: string, itemId: string, patch: Parameters<typeof apps.updateItem>[2]) =>
            apps.updateItem(categoryId, itemId, patch),
          updateItems: (
            categoryId: string,
            itemIds: string[],
            patch: Partial<Pick<LauncherItem, "launchDelaySeconds">>,
          ) => apps.updateItems(categoryId, itemIds, patch),
          deleteItem: (categoryId: string, itemId: string) =>
            apps.removeItem(categoryId, itemId),
          deleteItems: (categoryId: string, itemIds: string[]) =>
            apps.removeItems(categoryId, itemIds),
          moveItems: (source: string, target: string, itemIds: string[]) =>
            apps.moveItems(source, target, itemIds),
          addItems: (categoryId: string, payload: Parameters<typeof apps.addFileItems>[1]) =>
            apps.addFileItems(categoryId, payload),
          addItemsBatched: (
            categoryId: string,
            payload: Parameters<typeof apps.addFileItems>[1],
            batchSize?: number,
          ) => apps.addFileItemsBatched(categoryId, payload, batchSize),
          applyDropIcons: (
            categoryId: string,
            paths: string[],
            iconBase64s: Array<string | null>,
          ) => apps.applyDropIcons(categoryId, paths, iconBase64s),
          addUrlItem: (
            categoryId: string,
            payload: { name: string; url: string; icon_base64?: string | null },
          ) => apps.addUrlItem(categoryId, payload),
          createItem: (categoryId: string, payload: Parameters<typeof apps.createItemInCategory>[1]) =>
            apps.createItemInCategory(categoryId, payload),
          updateItemIcon: (categoryId: string, itemId: string, iconBase64: string) =>
            apps.updateItemIcon(categoryId, itemId, iconBase64),
          setItemIcon: (categoryId: string, itemId: string, iconBase64: string) =>
            apps.setItemIcon(categoryId, itemId, iconBase64),
          resetItemIcon: (categoryId: string, itemId: string) =>
            apps.resetItemIcon(categoryId, itemId),
          setResolvedPath: (
            categoryId: string,
            itemId: string,
            resolvedPath: string | null | undefined,
          ) => apps.setItemResolvedPath(categoryId, itemId, resolvedPath),
          deleteCategoryCleanup: (categoryId: string) =>
            apps.deleteCategoryCleanup(categoryId),
        }
      : fallbackOps;

    const methods = createLauncherStoreMethods({
      searchKeyword,
      rustSearchResults,
      launcherItemsByCategoryId,
      scenarioItemIds,
      pinnedItemIds,
      recentUsedItems,
      getSearchServiceClear: () => getSearchService()?.clear(),
      rustSearchViaService: searchService
        ? (keyword, limit) => searchService.search(keyword, limit)
        : null,
      searchLauncherItemsFallback: searchHelper.searchLauncherItems,
      syncSearchIndexViaService: searchService ? () => searchService.syncIndex() : null,
      applyRustSearchResults: setRustSearchResultsWithService,
      syncSearchIndexViaHelper: searchHelper.syncSearchIndex,
      ops,
      scenario: {
        toggle: (scenario, itemId) => {
          scenarioItemIds.value = toggleScenarioItemIds(
            scenarioItemIds.value,
            scenario,
            itemId,
          );
        },
        removeAll: (itemId) => {
          scenarioItemIds.value = removeItemFromAllScenariosIds(
            scenarioItemIds.value,
            itemId,
          );
        },
        contains: (scenario, itemId) =>
          isItemInScenarioIds(scenarioItemIds.value, scenario, itemId),
        launchItems: (scenario) =>
          getScenarioLaunchItemsFromMaps(
            scenarioItemIds.value,
            launcherItemsByCategoryId.value,
            scenario,
          ),
      },
      icons: {
        hasCustomIcon: (categoryId, itemId) => {
          const item = getLauncherItemById(categoryId, itemId);
          if (!item) return false;
          return normalizeHasCustomIcon(item.hasCustomIcon);
        },
        hydrateVisible: hydrateLauncherIconsForVisibleItems,
      },
      importItems: importLauncherItems,
      importSnapshot: importLauncherSnapshot,
      recordConfirmedSearch,
      addScannedApp: addScannedAppToLauncher,
    });

    const rustSearchMergedResults = computed<GlobalSearchMergedResult[]>(() => {
      const categoryStore = useCategoryStore();
      return mergeRustSearchResults(
        rustSearchResults.value,
        (categoryId) => categoryStore.getCategoryById(categoryId),
        getLauncherItemById,
      );
    });

    return {
      searchKeyword,
      pinnedItemIds,
      recentUsedItems,
      launcherItemsByCategoryId,
      scenarioItemIds,
      rustSearchResults,
      isRustSearchReady,
      createLauncherItemId,
      getNameFromPath,
      getLauncherItemsByCategoryId,
      setLauncherItemsByCategoryId,
      getLauncherItemById,
      rustSearchMergedResults,
      getLauncherItemMergeKey: pinning.getLauncherItemMergeKey,
      togglePinned: pinning.togglePinned,
      isItemPinned: pinning.isItemPinned,
      recordItemUsage: pinning.recordItemUsage,
      clearRecentUsed: pinning.clearRecentUsed,
      importPinnedItemIds: pinning.importPinnedItemIds,
      reorderPinnedItemIds: pinning.reorderPinnedItemIds,
      importRecentUsedItems: pinning.importRecentUsedItems,
      getRecentUsedItems: pinning.getRecentUsedItems,
      getRecentUsedItemInfo: pinning.getRecentUsedItemInfo,
      getRecentUsedMergedItems: pinning.getRecentUsedMergedItems,
      getPinnedMergedItems: pinning.getPinnedMergedItems,
      hydrateMissingIconsForItems: itemsHelper.hydrateMissingIconsForItems,
      searchLauncherItems: searchHelper.searchLauncherItems,
      getSmartSortedItems: (categoryId: string) =>
        pinning.getSmartSortedItems(categoryId, launcherItemsByCategoryId.value),
      ...methods,
    };
  },
  {
    persist: createVersionedPersistConfig("launcher", [
      "launcherItemsByCategoryId",
      "pinnedItemIds",
      "recentUsedItems",
      "scenarioItemIds",
    ]),
  },
);
