/**
 * Public store method bag factory — keeps launcherStore.ts a thin pinia shell.
 * All behavior is delegated to launcher/* helpers; no pinia store import here.
 */
import type { Ref } from "vue";
import type {
  AddPathsPayload,
  CreateItemPayload,
  ImportLauncherItemsOptions,
  ImportLauncherSnapshotPayload,
  LauncherItem,
  RecentUsedItem,
  RustSearchResult,
  ScenarioItemIds,
  ScenarioKey,
  ScenarioLaunchEntry,
  UpdateItemPatch,
} from "./types";
import type { LauncherItemRef } from "../../composables/useItemsHelper";
import type { ScannedAppInput } from "./import-utils";

export type LauncherStoreMethodDeps = {
  searchKeyword: Ref<string>;
  rustSearchResults: Ref<RustSearchResult[]>;
  launcherItemsByCategoryId: Ref<Record<string, LauncherItem[]>>;
  scenarioItemIds: Ref<ScenarioItemIds>;
  pinnedItemIds: Ref<string[]>;
  recentUsedItems: Ref<RecentUsedItem[]>;
  getSearchServiceClear: () => void;
  rustSearchViaService: ((keyword: string, limit: number) => Promise<unknown>) | null;
  searchLauncherItemsFallback: (args: {
    keyword: string;
    limit?: number;
  }) => Promise<RustSearchResult[]>;
  syncSearchIndexViaService: (() => Promise<unknown>) | null;
  applyRustSearchResults: (results: RustSearchResult[]) => void;
  syncSearchIndexViaHelper: () => Promise<void>;
  ops: {
    updateItem: (categoryId: string, itemId: string, patch: UpdateItemPatch) => void;
    updateItems: (
      categoryId: string,
      itemIds: string[],
      patch: Partial<Pick<LauncherItem, "launchDelaySeconds">>,
    ) => void;
    deleteItem: (categoryId: string, itemId: string) => void;
    deleteItems: (categoryId: string, itemIds: string[]) => void;
    moveItems: (
      sourceCategoryId: string,
      targetCategoryId: string,
      itemIds: string[],
    ) => void;
    addItems: (categoryId: string, payload: AddPathsPayload) => string[];
    addItemsBatched: (
      categoryId: string,
      payload: AddPathsPayload,
      batchSize?: number,
    ) => Promise<string[]>;
    applyDropIcons: (
      categoryId: string,
      paths: string[],
      iconBase64s: Array<string | null>,
    ) => void;
    addUrlItem: (
      categoryId: string,
      payload: { name: string; url: string; icon_base64?: string | null },
    ) => string;
    createItem: (categoryId: string, payload: CreateItemPayload) => string;
    updateItemIcon: (categoryId: string, itemId: string, iconBase64: string) => void;
    setItemIcon: (categoryId: string, itemId: string, iconBase64: string) => void;
    resetItemIcon: (categoryId: string, itemId: string) => void;
    setResolvedPath: (
      categoryId: string,
      itemId: string,
      resolvedPath: string | null | undefined,
    ) => boolean;
    deleteCategoryCleanup: (categoryId: string) => void;
  };
  scenario: {
    toggle: (scenario: ScenarioKey, itemId: string) => void;
    removeAll: (itemId: string) => void;
    contains: (scenario: ScenarioKey, itemId: string) => boolean;
    launchItems: (scenario: ScenarioKey) => ScenarioLaunchEntry[];
  };
  icons: {
    hasCustomIcon: (categoryId: string, itemId: string) => boolean;
    hydrateVisible: (
      targets: LauncherItemRef[],
      options?: { maxEdge?: number },
    ) => Promise<void>;
  };
  importItems: (
    items: Record<string, LauncherItem[]>,
    options?: ImportLauncherItemsOptions,
  ) => Promise<void>;
  importSnapshot: (
    snapshot: ImportLauncherSnapshotPayload,
    options?: ImportLauncherItemsOptions,
  ) => Promise<void>;
  recordConfirmedSearch: () => void;
  addScannedApp: (scannedApp: ScannedAppInput) => Promise<string>;
};

export function createLauncherStoreMethods(deps: LauncherStoreMethodDeps) {
  return {
    updateLauncherItem: deps.ops.updateItem,
    updateLauncherItems: deps.ops.updateItems,
    deleteLauncherItem: deps.ops.deleteItem,
    deleteLauncherItems: deps.ops.deleteItems,
    moveLauncherItems: deps.ops.moveItems,
    addLauncherItemsToCategory: deps.ops.addItems,
    addLauncherItemsToCategoryBatched: deps.ops.addItemsBatched,
    applyDropIcons: deps.ops.applyDropIcons,
    addUrlLauncherItemToCategory: deps.ops.addUrlItem,
    createLauncherItemInCategory: deps.ops.createItem,
    updateLauncherItemIcon: deps.ops.updateItemIcon,
    setLauncherItemIcon: deps.ops.setItemIcon,
    resetLauncherItemIcon: deps.ops.resetItemIcon,
    setLauncherItemResolvedPath: deps.ops.setResolvedPath,
    deleteCategoryCleanup: deps.ops.deleteCategoryCleanup,
    toggleScenarioItem: deps.scenario.toggle,
    removeItemFromAllScenarios: deps.scenario.removeAll,
    isItemInScenario: deps.scenario.contains,
    getScenarioLaunchItems: deps.scenario.launchItems,
    hasCustomIcon: deps.icons.hasCustomIcon,
    hydrateLauncherIconsForVisibleItems: deps.icons.hydrateVisible,
    importLauncherItems: deps.importItems,
    importLauncherSnapshot: deps.importSnapshot,
    recordConfirmedSearch: deps.recordConfirmedSearch,
    addScannedAppToLauncher: deps.addScannedApp,
    async syncSearchIndex() {
      if (deps.syncSearchIndexViaService) {
        await deps.syncSearchIndexViaService();
        return;
      }
      await deps.syncSearchIndexViaHelper();
    },
    async rustSearch(keyword: string, limit: number = 20): Promise<void> {
      if (deps.rustSearchViaService) {
        await deps.rustSearchViaService(keyword, limit);
        return;
      }
      deps.rustSearchResults.value = await deps.searchLauncherItemsFallback({
        keyword,
        limit,
      });
    },
    setRustSearchResults(results: RustSearchResult[]) {
      deps.applyRustSearchResults(results);
    },
    clearSearch() {
      deps.searchKeyword.value = "";
      deps.rustSearchResults.value = [];
      deps.getSearchServiceClear();
    },
  };
}
