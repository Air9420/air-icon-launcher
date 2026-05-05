import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useCategoryStore, type Category } from "./categoryStore";
import { useStatsStore } from "./statsStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import { mergeRustSearchResults } from "./launcher-search";
import { itemEventBus } from "../events/itemEvents";
import { invoke } from "../utils/invoke-wrapper";
import {
  normalizeIconBase64,
  normalizeHasCustomIcon,
  normalizeDelaySeconds,
  normalizeLaunchDependencies,
  getNameFromPath,
  cacheOriginalIconForFileItem,
  getCachedOriginalIconForPath,
  applyCachedOriginalIcon,
  shouldRefreshDerivedIcon,
  normalizeImportedLauncherItem,
  useItemsHelper,
  type LauncherItemRef,
} from "../composables/useItemsHelper";
import { useSearchSync } from "../composables/useSearchSync";
import { usePinningHelper } from "../composables/usePinningHelper";

export type LauncherItem = {
  id: string;
  name: string;
  path: string;
  resolvedPath?: string;
  url?: string;
  itemType: "file" | "url";
  isDirectory: boolean;
  iconBase64: string | null;
  hasCustomIcon?: boolean;
  isFavorite?: boolean;
  lastUsedAt?: number;
  launchDependencies: LaunchDependency[];
  launchDelaySeconds: number;
};

export type LaunchDependency = {
  categoryId: string;
  itemId: string;
  delayAfterSeconds: number;
};

export type ScenarioKey = "work" | "dev" | "play";
export type ScenarioItemIds = Record<ScenarioKey, string[]>;

export type GlobalSearchResult = {
  item: LauncherItem;
  categoryId: string;
  categoryName: string;
};

export type GlobalSearchMergedResult = {
  key: string;
  item: LauncherItem;
  primaryCategoryId: string;
  categories: Category[];
  matchType: RustSearchMatchType;
};

export type RecentUsedItem = {
  categoryId: string;
  itemId: string;
  usedAt: number;
  usageCount: number;
};

export type RecentUsedMergedItem = {
  key: string;
  usedAt: number;
  recent: RecentUsedItem;
  item: LauncherItem;
  categories: Category[];
};

export type PinnedMergedItem = {
  key: string;
  item: LauncherItem;
  primaryCategoryId: string;
  categories: Category[];
};

export type RustSearchMatchType =
  | "exact"
  | "prefix"
  | "substring"
  | "pinyin_full"
  | "pinyin_initial"
  | "fuzzy";

export type RustSearchResult = {
  id: string;
  name: string;
  path: string;
  category_id: string;
  match_type: RustSearchMatchType;
  fuzzy_score: number;
  matched_pinyin_initial: boolean;
  matched_pinyin_full: boolean;
  rank_score: number;
};

type ImportLauncherItemsOptions = {
  refreshDerivedIcons?: boolean;
  suppressEvents?: boolean;
};

type ImportLauncherSnapshotPayload = {
  items: Record<string, LauncherItem[]>;
  pinnedItemIds?: string[];
  recentUsedItems?: RecentUsedItem[];
};

function normalizeOptionalPath(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isLnkPath(path: string | null | undefined): boolean {
  const normalizedPath = normalizeOptionalPath(path);
  return !!normalizedPath && normalizedPath.toLowerCase().endsWith(".lnk");
}

export const useLauncherStore = defineStore(
  "launcher",
  () => {
    const searchKeyword = ref<string>("");
    const pinnedItemIds = ref<string[]>([]);
    const recentUsedItems = ref<RecentUsedItem[]>([]);
    const launcherItemsByCategoryId = ref<Record<string, LauncherItem[]>>({});
    const scenarioItemIds = ref<ScenarioItemIds>({
      work: [],
      dev: [],
      play: [],
    });

    const rustSearchResults = ref<RustSearchResult[]>([]);
    const isRustSearchReady = ref(false);

    function createLauncherItemId() {
      return `item-${crypto.randomUUID()}`;
    }

    function getLauncherItemsByCategoryId(categoryId: string) {
      return launcherItemsByCategoryId.value[categoryId] || [];
    }

    function setLauncherItemsByCategoryId(
      categoryId: string,
      items: LauncherItem[],
    ) {
      launcherItemsByCategoryId.value = {
        ...launcherItemsByCategoryId.value,
        [categoryId]: items,
      };
    }

    function mergeLauncherItemsByCategoryId(
      itemsByCategoryId: Record<string, LauncherItem[]>,
    ) {
      if (Object.keys(itemsByCategoryId).length === 0) return;

      launcherItemsByCategoryId.value = {
        ...launcherItemsByCategoryId.value,
        ...itemsByCategoryId,
      };
    }

    function getLauncherItemById(categoryId: string, itemId: string) {
      return (
        getLauncherItemsByCategoryId(categoryId).find((x) => x.id === itemId) ||
        null
      );
    }

    const {
      hydrateMissingIconsForItems,
      refreshLauncherItemUrlFavicon,
      removeCachedIconsForCategory,
      cacheIcon,
    } = useItemsHelper(
      getLauncherItemsByCategoryId,
      getLauncherItemById,
      mergeLauncherItemsByCategoryId,
    );

    const {
      syncSearchIndex,
      searchLauncherItems,
    } = useSearchSync(
      getLauncherItemsByCategoryId,
      getLauncherItemById,
      pinnedItemIds,
      recentUsedItems,
      isRustSearchReady,
    );

    const {
      togglePinned,
      isItemPinned,
      recordItemUsage,
      clearRecentUsed,
      importPinnedItemIds,
      reorderPinnedItemIds,
      importRecentUsedItems,
      getRecentUsedItems,
      getRecentUsedItemInfo,
      getRecentUsedMergedItems,
      getPinnedMergedItems,
      getSmartSortedItems,
      getLauncherItemMergeKey,
    } = usePinningHelper(
      getLauncherItemsByCategoryId,
      getLauncherItemById,
      pinnedItemIds,
      recentUsedItems,
    );

    function updateLauncherItem(
      categoryId: string,
      itemId: string,
      patch: Partial<
        Pick<
          LauncherItem,
          | "name"
          | "url"
          | "path"
          | "resolvedPath"
          | "launchDependencies"
          | "launchDelaySeconds"
        >
      >,
    ) {
      const list = getLauncherItemsByCategoryId(categoryId);
      const index = list.findIndex((x) => x.id === itemId);
      if (index === -1) return;
      const next = [...list];
      const currentItem = next[index];
      const nextPath =
        patch.path !== undefined
          ? patch.path
          : currentItem.path;
      const explicitResolvedPath =
        patch.resolvedPath !== undefined
          ? normalizeOptionalPath(patch.resolvedPath)
          : undefined;
      let nextResolvedPath = currentItem.resolvedPath;
      let shouldResolveLnkPath = false;
      if (currentItem.itemType === "file") {
        if (patch.resolvedPath !== undefined) {
          nextResolvedPath = explicitResolvedPath;
        } else if (patch.path !== undefined) {
          if (isLnkPath(nextPath)) {
            nextResolvedPath = undefined;
            shouldResolveLnkPath = true;
          } else {
            nextResolvedPath = normalizeOptionalPath(nextPath);
          }
        }
      }
      next[index] = {
        ...currentItem,
        ...patch,
        resolvedPath: currentItem.itemType === "file" ? nextResolvedPath : undefined,
        launchDependencies:
          patch.launchDependencies !== undefined
            ? normalizeLaunchDependencies(patch.launchDependencies, {
                categoryId,
                itemId,
              })
            : next[index].launchDependencies,
        launchDelaySeconds:
          patch.launchDelaySeconds !== undefined
            ? normalizeDelaySeconds(patch.launchDelaySeconds)
            : currentItem.launchDelaySeconds,
      };
      setLauncherItemsByCategoryId(categoryId, next);
      itemEventBus.emit({ type: 'item:updated', categoryId, item: next[index] });
      if (shouldResolveLnkPath) {
        queueResolveLnkTargets(categoryId, [{ itemId, path: nextPath }]);
      }
    }

    function removeDependenciesMatching(
      predicate: (dependency: LaunchDependency) => boolean,
    ) {
      const nextByCategoryId: Record<string, LauncherItem[]> = {};

      for (const [categoryId, items] of Object.entries(
        launcherItemsByCategoryId.value,
      )) {
        nextByCategoryId[categoryId] = items.map((item) => {
          const nextDependencies = item.launchDependencies.filter(
            (dependency) => !predicate(dependency),
          );

          if (nextDependencies.length === item.launchDependencies.length) {
            return item;
          }

          return {
            ...item,
            launchDependencies: nextDependencies,
          };
        });
      }

      launcherItemsByCategoryId.value = nextByCategoryId;
    }

    function remapDependencyCategoryRefs(
      mappings: Array<{
        fromCategoryId: string;
        toCategoryId: string;
        itemId: string;
      }>,
    ) {
      if (mappings.length === 0) return;

      const categoryIdByDependencyKey = new Map(
        mappings.map((mapping) => [
          `${mapping.fromCategoryId}:${mapping.itemId}`,
          mapping.toCategoryId,
        ]),
      );

      let changed = false;
      const nextByCategoryId: Record<string, LauncherItem[]> = {};

      for (const [categoryId, items] of Object.entries(
        launcherItemsByCategoryId.value,
      )) {
        nextByCategoryId[categoryId] = items.map((item) => {
          let itemChanged = false;
          const nextDependencies = item.launchDependencies.map((dependency) => {
            const nextCategoryId = categoryIdByDependencyKey.get(
              `${dependency.categoryId}:${dependency.itemId}`,
            );
            if (!nextCategoryId || nextCategoryId === dependency.categoryId) {
              return dependency;
            }

            itemChanged = true;
            return {
              ...dependency,
              categoryId: nextCategoryId,
            };
          });

          if (!itemChanged) {
            return item;
          }

          changed = true;
          return {
            ...item,
            launchDependencies: nextDependencies,
          };
        });
      }

      if (changed) {
        launcherItemsByCategoryId.value = nextByCategoryId;
      }
    }

    function toggleScenarioItem(scenario: ScenarioKey, itemId: string) {
      const current = scenarioItemIds.value[scenario] ?? [];
      const exists = current.includes(itemId);
      const nextIds = exists
        ? current.filter((id) => id !== itemId)
        : [...new Set([...current, itemId])];
      scenarioItemIds.value = {
        ...scenarioItemIds.value,
        [scenario]: nextIds,
      };
    }

    function removeItemFromAllScenarios(itemId: string) {
      let changed = false;
      const next: ScenarioItemIds = {
        work: scenarioItemIds.value.work,
        dev: scenarioItemIds.value.dev,
        play: scenarioItemIds.value.play,
      };

      (["work", "dev", "play"] as const).forEach((scenario) => {
        const filtered = next[scenario].filter((id) => id !== itemId);
        if (filtered.length !== next[scenario].length) {
          changed = true;
          next[scenario] = filtered;
        }
      });

      if (changed) {
        scenarioItemIds.value = next;
      }
    }

    function isItemInScenario(scenario: ScenarioKey, itemId: string) {
      return scenarioItemIds.value[scenario].includes(itemId);
    }

    function getScenarioLaunchItems(
      scenario: ScenarioKey,
    ): Array<{ categoryId: string; item: LauncherItem }> {
      const result: Array<{ categoryId: string; item: LauncherItem }> = [];
      const ids = scenarioItemIds.value[scenario];

      for (const itemId of ids) {
        for (const [categoryId, items] of Object.entries(
          launcherItemsByCategoryId.value,
        )) {
          const item = items.find((candidate) => candidate.id === itemId);
          if (!item) continue;
          result.push({ categoryId, item });
          break;
        }
      }

      return result;
    }

    function deleteLauncherItem(categoryId: string, itemId: string) {
      const list = getLauncherItemsByCategoryId(categoryId);
      const index = list.findIndex((x) => x.id === itemId);
      if (index === -1) return;
      const stats = useStatsStore();
      const next = [...list];
      next.splice(index, 1);
      setLauncherItemsByCategoryId(categoryId, next);
      pinnedItemIds.value = pinnedItemIds.value.filter((id) => id !== itemId);
      recentUsedItems.value = recentUsedItems.value.filter(
        (x) => !(x.categoryId === categoryId && x.itemId === itemId),
      );
      stats.removeLaunchEventsForItems(categoryId, [itemId]);
      removeDependenciesMatching(
        (dependency) =>
          dependency.categoryId === categoryId && dependency.itemId === itemId,
      );
      removeItemFromAllScenarios(itemId);
      itemEventBus.emit({ type: 'item:deleted', categoryId, itemId });
    }

    function deleteLauncherItems(categoryId: string, itemIds: string[]) {
      const targetIds = new Set(itemIds);
      if (targetIds.size === 0) return;

      const list = getLauncherItemsByCategoryId(categoryId);
      const removedItems = list.filter((item) => targetIds.has(item.id));
      if (removedItems.length === 0) return;
      const stats = useStatsStore();

      setLauncherItemsByCategoryId(
        categoryId,
        list.filter((item) => !targetIds.has(item.id)),
      );

      pinnedItemIds.value = pinnedItemIds.value.filter(
        (id) => !targetIds.has(id),
      );
      recentUsedItems.value = recentUsedItems.value.filter(
        (item) =>
          !(item.categoryId === categoryId && targetIds.has(item.itemId)),
      );
      stats.removeLaunchEventsForItems(categoryId, [...targetIds]);
      removeDependenciesMatching(
        (dependency) =>
          dependency.categoryId === categoryId &&
          targetIds.has(dependency.itemId),
      );
      for (const itemId of targetIds) {
        removeItemFromAllScenarios(itemId);
      }
      for (const item of removedItems) {
        itemEventBus.emit({ type: 'item:deleted', categoryId, itemId: item.id });
      }
    }

    function updateLauncherItems(
      categoryId: string,
      itemIds: string[],
      patch: Partial<Pick<LauncherItem, "launchDelaySeconds">>,
    ) {
      const targetIds = new Set(itemIds);
      if (targetIds.size === 0) return;

      const list = getLauncherItemsByCategoryId(categoryId);
      const updatedItems: LauncherItem[] = [];
      let changed = false;

      const next = list.map((item) => {
        if (!targetIds.has(item.id)) return item;

        const updatedItem: LauncherItem = {
          ...item,
          launchDelaySeconds:
            patch.launchDelaySeconds !== undefined
              ? normalizeDelaySeconds(patch.launchDelaySeconds)
              : item.launchDelaySeconds,
        };

        updatedItems.push(updatedItem);
        changed = true;
        return updatedItem;
      });

      if (!changed) return;

      setLauncherItemsByCategoryId(categoryId, next);
      for (const item of updatedItems) {
        itemEventBus.emit({ type: 'item:updated', categoryId, item });
      }
    }

    function moveLauncherItems(
      sourceCategoryId: string,
      targetCategoryId: string,
      itemIds: string[],
    ) {
      if (sourceCategoryId === targetCategoryId) return;

      const requestedIds = new Set(itemIds);
      if (requestedIds.size === 0) return;

      const sourceItems = getLauncherItemsByCategoryId(sourceCategoryId);
      const targetItems = getLauncherItemsByCategoryId(targetCategoryId);
      const targetItemIds = new Set(targetItems.map((item) => item.id));
      const movedItems = sourceItems.filter(
        (item) => requestedIds.has(item.id) && !targetItemIds.has(item.id),
      );

      if (movedItems.length === 0) return;

      const stats = useStatsStore();
      const movedIds = new Set(movedItems.map((item) => item.id));
      setLauncherItemsByCategoryId(
        sourceCategoryId,
        sourceItems.filter((item) => !movedIds.has(item.id)),
      );
      setLauncherItemsByCategoryId(targetCategoryId, [
        ...targetItems,
        ...movedItems,
      ]);

      recentUsedItems.value = recentUsedItems.value.map((recentItem) => {
        if (
          recentItem.categoryId !== sourceCategoryId ||
          !movedIds.has(recentItem.itemId)
        ) {
          return recentItem;
        }

        return {
          ...recentItem,
          categoryId: targetCategoryId,
        };
      });

      remapDependencyCategoryRefs(
        movedItems.map((item) => ({
          fromCategoryId: sourceCategoryId,
          toCategoryId: targetCategoryId,
          itemId: item.id,
        })),
      );
      stats.remapLaunchEventCategoryRefs(
        movedItems.map((item) => ({
          fromCategoryId: sourceCategoryId,
          toCategoryId: targetCategoryId,
          itemId: item.id,
        })),
      );

      itemEventBus.emit({ type: 'item:moved', fromCategoryId: sourceCategoryId, toCategoryId: targetCategoryId, itemIds });
    }

    function addLauncherItemsToCategory(
      categoryId: string,
      payload: {
        paths: string[];
        directories: string[];
        icon_base64s: Array<string | null>;
        itemTypes?: Array<"file" | "url">;
      },
    ): string[] {
      const existing = getLauncherItemsByCategoryId(categoryId);
      const directorySet = new Set(payload.directories);
      const resolveTargets: Array<{ itemId: string; path: string }> = [];

      const nextItems: LauncherItem[] = payload.paths.map((path, index) => {
        const iconBase64 = normalizeIconBase64(
          payload.icon_base64s[index] !== undefined
            ? payload.icon_base64s[index]
            : null,
        );
        const itemType = payload.itemTypes?.[index] ?? "file";
        const itemPath = itemType === "url" ? "" : path;
        cacheOriginalIconForFileItem(itemType, itemPath, iconBase64);
        const nextItem: LauncherItem = {
          id: createLauncherItemId(),
          name: getNameFromPath(path),
          path: itemPath,
          resolvedPath:
            itemType === "file" && !isLnkPath(itemPath)
              ? normalizeOptionalPath(itemPath)
              : undefined,
          url: itemType === "url" ? path : undefined,
          itemType,
          isDirectory: directorySet.has(path),
          iconBase64,
          hasCustomIcon: false,
          launchDependencies: [],
          launchDelaySeconds: 0,
        };
        if (itemType === "file" && isLnkPath(itemPath)) {
          resolveTargets.push({ itemId: nextItem.id, path: itemPath });
        }
        return nextItem;
      });

      setLauncherItemsByCategoryId(categoryId, [...existing, ...nextItems]);
      for (const item of nextItems) {
        itemEventBus.emit({ type: 'item:created', categoryId, item });
      }
      queueResolveLnkTargets(categoryId, resolveTargets);
      return nextItems.map((item) => item.id);
    }

    async function addLauncherItemsToCategoryBatched(
      categoryId: string,
      payload: {
        paths: string[];
        directories: string[];
        icon_base64s: Array<string | null>;
        itemTypes?: Array<"file" | "url">;
      },
      batchSize: number = 20,
    ): Promise<string[]> {
      const { paths, directories, icon_base64s, itemTypes } = payload;
      const directorySet = new Set(directories);
      const allIds: string[] = [];
      const totalBatches = Math.ceil(paths.length / batchSize);
      const resolveTargets: Array<{ itemId: string; path: string }> = [];

      for (let batch = 0; batch < totalBatches; batch++) {
        const start = batch * batchSize;
        const end = Math.min(start + batchSize, paths.length);

        const existing = getLauncherItemsByCategoryId(categoryId);
        const batchItems: LauncherItem[] = [];

        for (let i = start; i < end; i++) {
          const iconBase64 = normalizeIconBase64(icon_base64s[i] ?? null);
          const itemType = itemTypes?.[i] ?? "file";
          const itemPath = itemType === "url" ? "" : paths[i];
          cacheOriginalIconForFileItem(itemType, itemPath, iconBase64);
          const id = createLauncherItemId();
          allIds.push(id);
          batchItems.push({
            id,
            name: getNameFromPath(paths[i]),
            path: itemPath,
            resolvedPath:
              itemType === "file" && !isLnkPath(itemPath)
                ? normalizeOptionalPath(itemPath)
                : undefined,
            url: itemType === "url" ? paths[i] : undefined,
            itemType,
            isDirectory: directorySet.has(paths[i]),
            iconBase64,
            hasCustomIcon: false,
            launchDependencies: [],
            launchDelaySeconds: 0,
          });
          if (itemType === "file" && isLnkPath(itemPath)) {
            resolveTargets.push({ itemId: id, path: itemPath });
          }
        }

        setLauncherItemsByCategoryId(categoryId, [...existing, ...batchItems]);
        for (const item of batchItems) {
          itemEventBus.emit({ type: 'item:created', categoryId, item });
        }

        if (batch < totalBatches - 1) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
      }

      queueResolveLnkTargets(categoryId, resolveTargets);
      return allIds;
    }

    function applyDropIcons(
      categoryId: string,
      paths: string[],
      iconBase64s: Array<string | null>,
    ) {
      const list = getLauncherItemsByCategoryId(categoryId);
      const pathToIcon = new Map<string, string>();
      for (let i = 0; i < paths.length; i++) {
        const icon = normalizeIconBase64(iconBase64s[i]);
        if (!icon) continue;
        pathToIcon.set(paths[i], icon);
        cacheIcon(paths[i], icon);
      }

      if (pathToIcon.size === 0) return;

      let changed = false;
      const updatedItems: LauncherItem[] = [];
      const next = list.map((item) => {
        const icon = pathToIcon.get(item.path);
        if (icon === undefined) return item;
        changed = true;
        const updated = { ...item, iconBase64: icon, hasCustomIcon: false };
        updatedItems.push(updated);
        return updated;
      });

      if (changed) {
        setLauncherItemsByCategoryId(categoryId, next);
        for (const item of updatedItems) {
          itemEventBus.emit({ type: 'item:updated', categoryId, item });
        }
      }
    }

    function addUrlLauncherItemToCategory(
      categoryId: string,
      payload: {
        name: string;
        url: string;
        icon_base64?: string | null;
      },
    ): string {
      const existing = getLauncherItemsByCategoryId(categoryId);
      const iconBase64 = normalizeIconBase64(payload.icon_base64 ?? null);
      const newItem: LauncherItem = {
        id: createLauncherItemId(),
        name: payload.name,
        path: "",
        resolvedPath: undefined,
        url: payload.url,
        itemType: "url",
        isDirectory: false,
        iconBase64,
        hasCustomIcon: iconBase64 !== null,
        launchDependencies: [],
        launchDelaySeconds: 0,
      };
      setLauncherItemsByCategoryId(categoryId, [...existing, newItem]);
      itemEventBus.emit({ type: 'item:created', categoryId, item: newItem });
      return newItem.id;
    }

    function createLauncherItemInCategory(
      categoryId: string,
      payload: {
        name: string;
        path?: string;
        url?: string;
        itemType: "file" | "url";
        isDirectory?: boolean;
        iconBase64?: string | null;
        launchDependencies?: LaunchDependency[];
        launchDelaySeconds?: number;
      },
    ): string {
      const existing = getLauncherItemsByCategoryId(categoryId);
      const iconBase64 = normalizeIconBase64(payload.iconBase64 ?? null);
      const id = createLauncherItemId();

      if (payload.itemType === "file" && payload.path) {
        cacheOriginalIconForFileItem(
          payload.itemType,
          payload.path,
          iconBase64,
        );
      }

      const newItem: LauncherItem = {
        id,
        name: payload.name,
        path: payload.itemType === "url" ? "" : (payload.path ?? ""),
        resolvedPath:
          payload.itemType === "file" && !isLnkPath(payload.path ?? "")
            ? normalizeOptionalPath(payload.path ?? "")
            : undefined,
        url: payload.itemType === "url" ? payload.url : undefined,
        itemType: payload.itemType,
        isDirectory:
          payload.itemType === "file" ? !!payload.isDirectory : false,
        iconBase64,
        hasCustomIcon: iconBase64 !== null,
        launchDependencies: normalizeLaunchDependencies(
          payload.launchDependencies,
          {
            categoryId,
            itemId: id,
          },
        ),
        launchDelaySeconds: normalizeDelaySeconds(payload.launchDelaySeconds),
      };

      setLauncherItemsByCategoryId(categoryId, [...existing, newItem]);
      itemEventBus.emit({ type: 'item:created', categoryId, item: newItem });
      if (newItem.itemType === "file" && isLnkPath(newItem.path)) {
        queueResolveLnkTargets(categoryId, [{ itemId: newItem.id, path: newItem.path }]);
      }

      return id;
    }

    function updateLauncherItemIcon(
      categoryId: string,
      itemId: string,
      iconBase64: string,
    ) {
      const list = getLauncherItemsByCategoryId(categoryId);
      const index = list.findIndex((x) => x.id === itemId);
      if (index === -1) return;
      const normalizedIcon = normalizeIconBase64(iconBase64);
      const currentItem = list[index];
      if (currentItem.itemType === "file") {
        cacheOriginalIconForFileItem(
          currentItem.itemType,
          currentItem.path,
          normalizedIcon,
        );
      }
      const next = [...list];
      next[index] = {
        ...currentItem,
        iconBase64: normalizedIcon,
        hasCustomIcon: false,
      };
      setLauncherItemsByCategoryId(categoryId, next);
      itemEventBus.emit({ type: 'item:iconUpdated', categoryId, itemId, iconBase64: normalizedIcon });
    }

    function setLauncherItemResolvedPath(
      categoryId: string,
      itemId: string,
      resolvedPath: string | null | undefined,
    ): boolean {
      const list = getLauncherItemsByCategoryId(categoryId);
      const index = list.findIndex((x) => x.id === itemId);
      if (index === -1) return false;
      const currentItem = list[index];
      if (currentItem.itemType !== "file") return false;

      const normalized = normalizeOptionalPath(resolvedPath);
      if ((currentItem.resolvedPath ?? undefined) === normalized) {
        return false;
      }

      const next = [...list];
      next[index] = {
        ...currentItem,
        resolvedPath: normalized,
      };
      setLauncherItemsByCategoryId(categoryId, next);
      itemEventBus.emit({ type: "item:updated", categoryId, item: next[index] });
      return true;
    }

    function queueResolveLnkTargets(
      categoryId: string,
      targets: Array<{ itemId: string; path: string }>,
    ) {
      if (targets.length === 0) return;
      for (const target of targets) {
        const normalizedPath = normalizeOptionalPath(target.path);
        if (!normalizedPath || !isLnkPath(normalizedPath)) continue;
        void invoke<string | null>("resolve_lnk_target", { path: normalizedPath })
          .then((result) => {
            const resolved = result.ok ? normalizeOptionalPath(result.value ?? undefined) : undefined;
            setLauncherItemResolvedPath(categoryId, target.itemId, resolved);
          })
          .catch(() => {});
      }
    }

    function deleteCategoryCleanup(categoryId: string) {
      const next = { ...launcherItemsByCategoryId.value };
      const removedItems = next[categoryId] || [];
      const removedItemIds = removedItems.map((x) => x.id);
      const stats = useStatsStore();
      delete next[categoryId];
      launcherItemsByCategoryId.value = next;
      removeCachedIconsForCategory(categoryId);
      if (removedItemIds.length) {
        const removedSet = new Set(removedItemIds);
        pinnedItemIds.value = pinnedItemIds.value.filter(
          (id) => !removedSet.has(id),
        );
      }
      recentUsedItems.value = recentUsedItems.value.filter(
        (x) => x.categoryId !== categoryId,
      );
      stats.removeLaunchEventsForCategory(categoryId);
      removeDependenciesMatching(
        (dependency) => dependency.categoryId === categoryId,
      );
      for (const itemId of removedItemIds) {
        removeItemFromAllScenarios(itemId);
      }
      if (removedItems.length > 0) {
        for (const item of removedItems) {
          itemEventBus.emit({ type: 'item:deleted', categoryId, itemId: item.id });
        }
      }
    }

    function setLauncherItemIcon(
      categoryId: string,
      itemId: string,
      iconBase64: string,
    ) {
      const list = getLauncherItemsByCategoryId(categoryId);
      const index = list.findIndex((x) => x.id === itemId);
      if (index === -1) return;
      const normalizedIcon = normalizeIconBase64(iconBase64);
      const next = [...list];
      next[index] = {
        ...next[index],
        iconBase64: normalizedIcon,
        hasCustomIcon: true,
      };
      setLauncherItemsByCategoryId(categoryId, next);
      itemEventBus.emit({ type: 'item:iconUpdated', categoryId, itemId, iconBase64: normalizedIcon });
    }

    function resetLauncherItemIcon(categoryId: string, itemId: string) {
      const list = getLauncherItemsByCategoryId(categoryId);
      const index = list.findIndex((x) => x.id === itemId);
      if (index === -1) return;
      const currentItem = list[index];
      const next = [...list];
      const restoredIcon =
        currentItem.itemType === "file"
          ? getCachedOriginalIconForPath(currentItem.path)
          : null;
      next[index] = {
        ...currentItem,
        iconBase64: restoredIcon,
        hasCustomIcon: false,
      };
      setLauncherItemsByCategoryId(categoryId, next);

      if (currentItem.itemType === "file" && !restoredIcon) {
        void hydrateMissingIconsForItems([{ categoryId, itemId }], {
          forceReplace: true,
        });
        return;
      }

      itemEventBus.emit({ type: 'item:iconUpdated', categoryId, itemId, iconBase64: restoredIcon });

      if (currentItem.itemType === "url" && currentItem.url) {
        void refreshLauncherItemUrlFavicon(
          categoryId,
          itemId,
          currentItem.url,
          updateLauncherItemIcon,
        );
      }
    }

    function hasCustomIcon(categoryId: string, itemId: string): boolean {
      const item = getLauncherItemById(categoryId, itemId);
      if (!item) return false;
      return normalizeHasCustomIcon(item.hasCustomIcon);
    }

    async function rustSearch(
      keyword: string,
      limit: number = 20,
    ): Promise<void> {
      rustSearchResults.value = await searchLauncherItems({ keyword, limit });
    }

    function setRustSearchResults(results: RustSearchResult[]) {
      rustSearchResults.value = results;
    }

    const rustSearchMergedResults = computed<GlobalSearchMergedResult[]>(() => {
      const categoryStore = useCategoryStore();
      return mergeRustSearchResults(
        rustSearchResults.value,
        (categoryId) => categoryStore.getCategoryById(categoryId),
        getLauncherItemById,
      );
    });

    function clearSearch() {
      searchKeyword.value = "";
      rustSearchResults.value = [];
    }

    async function importLauncherItems(
      items: Record<string, LauncherItem[]>,
      options: ImportLauncherItemsOptions = {},
    ) {
      const nextItems: Record<string, LauncherItem[]> = {};
      const refreshTargets: LauncherItemRef[] = [];
      for (const [categoryId, categoryItems] of Object.entries(items)) {
        nextItems[categoryId] = categoryItems.map((item) => {
          const normalizedImportedItem = normalizeImportedLauncherItem(
            item as LauncherItem & { originalIconBase64?: string | null },
          );
          const nextItem = applyCachedOriginalIcon(normalizedImportedItem);
          const importedHadDerivedIcon =
            shouldRefreshDerivedIcon(normalizedImportedItem);
          const stillMissingDerivedIcon =
            nextItem.itemType === "file" &&
            !nextItem.hasCustomIcon &&
            !nextItem.iconBase64 &&
            !!nextItem.path.trim();
          if (
            options.refreshDerivedIcons &&
            (importedHadDerivedIcon || stillMissingDerivedIcon)
          ) {
            refreshTargets.push({
              categoryId,
              itemId: nextItem.id,
            });
          }
          return nextItem;
        });
      }
      // Yield to browser so pending UI events (mouse clicks, window drag) can
      // be processed before the reactivity cascade from bulk store assignment.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      launcherItemsByCategoryId.value = nextItems;
      if (options.refreshDerivedIcons && refreshTargets.length > 0) {
        void hydrateMissingIconsForItems(refreshTargets, {
          forceReplace: true,
          skipCache: true,
        });
      }
      if (!options.suppressEvents) {
        for (const [categoryId, categoryItems] of Object.entries(items)) {
          for (const item of categoryItems) {
            itemEventBus.emit({ type: 'item:created', categoryId, item });
          }
        }
      }
    }

    async function importLauncherSnapshot(
      snapshot: ImportLauncherSnapshotPayload,
      options: ImportLauncherItemsOptions = {},
    ) {
      await importLauncherItems(snapshot.items, { ...options, suppressEvents: true });
      pinnedItemIds.value = [...new Set(snapshot.pinnedItemIds ?? [])];
      recentUsedItems.value = [...(snapshot.recentUsedItems ?? [])];
      const stats = useStatsStore();
      stats.clearLaunchHistory();
    }

    function recordConfirmedSearch() {
      const keyword = searchKeyword.value.trim();
      if (keyword.length >= 2) {
        const stats = useStatsStore();
        stats.recordSearch(keyword);
      }
    }

    async function addScannedAppToLauncher(
      scannedApp: { name: string; path: string; source: string; publisher: string | null; iconBase64: string | null },
    ): Promise<string> {
      const { classifyInstalledApp } = await import("../utils/classification/pipeline");
      const { normalizeApp } = await import("../utils/classification/normalizer");

      const normalized = normalizeApp({
        name: scannedApp.name,
        path: scannedApp.path,
        icon_base64: scannedApp.iconBase64,
        source: scannedApp.source,
        publisher: scannedApp.publisher,
      });

      const classification = classifyInstalledApp(normalized);
      const categoryName = classification.rule.name || "其他";

      const categoryStore = useCategoryStore();
      let targetCategoryId = categoryStore.categories.find(
        (c) => c.name === categoryName
      )?.id;

      if (!targetCategoryId) {
        targetCategoryId = categoryStore.createCategoryId();
        categoryStore.categories.push({
          id: targetCategoryId,
          name: categoryName,
          customIconBase64: null,
        });
      }

      const itemId = createLauncherItemId();
      const newItem: LauncherItem = {
        id: itemId,
        name: scannedApp.name,
        path: scannedApp.path,
        resolvedPath: normalizeOptionalPath(scannedApp.path),
        itemType: "file",
        isDirectory: false,
        iconBase64: scannedApp.iconBase64,
        hasCustomIcon: false,
        launchDependencies: [],
        launchDelaySeconds: 0,
      };

      const existing = getLauncherItemsByCategoryId(targetCategoryId);
      setLauncherItemsByCategoryId(targetCategoryId, [...existing, newItem]);
      itemEventBus.emit({ type: "item:created", categoryId: targetCategoryId, item: newItem });

      return itemId;
    }

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
      updateLauncherItem,
      updateLauncherItems,
      deleteLauncherItem,
      deleteLauncherItems,
      moveLauncherItems,
      addLauncherItemsToCategory,
      addLauncherItemsToCategoryBatched,
      applyDropIcons,
      addUrlLauncherItemToCategory,
      createLauncherItemInCategory,
      updateLauncherItemIcon,
      setLauncherItemResolvedPath,
      deleteCategoryCleanup,
      setLauncherItemIcon,
      resetLauncherItemIcon,
      hasCustomIcon,
      hydrateMissingIconsForItems,
      rustSearchMergedResults,
      clearSearch,
      getLauncherItemMergeKey,
      togglePinned,
      isItemPinned,
      recordItemUsage,
      clearRecentUsed,
      importLauncherItems,
      importLauncherSnapshot,
      importPinnedItemIds,
      reorderPinnedItemIds,
      importRecentUsedItems,
      getRecentUsedItems,
      getRecentUsedItemInfo,
      getRecentUsedMergedItems,
      getPinnedMergedItems,
      toggleScenarioItem,
      removeItemFromAllScenarios,
      isItemInScenario,
      getScenarioLaunchItems,
      syncSearchIndex,
      searchLauncherItems,
      rustSearch,
      setRustSearchResults,
      getSmartSortedItems: (categoryId: string) =>
        getSmartSortedItems(categoryId, launcherItemsByCategoryId.value),
      recordConfirmedSearch,
      addScannedAppToLauncher,
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
