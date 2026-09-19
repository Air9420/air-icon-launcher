/**
 * Domain item ops for launcher apps �?no pinia, no Cordis Service.
 *
 * Shared implementation used by:
 * - `AppsService` (kernel present, state bag = service refs)
 * - `launcher/items-ops` fallback (no kernel, state bag = store refs)
 *
 * IPC only via invoke-wrapper / injected sinks. Domain events via `state.emit`.
 */
import type { Ref } from "vue";
import {
  cacheOriginalIconForFileItem,
  getNameFromPath,
  normalizeDelaySeconds,
  normalizeIconBase64,
  normalizeLaunchDependencies,
} from "../../composables/useItemsHelper";
import { invoke } from "../../utils/invoke-wrapper";
import type { ItemEvent } from "../../events/itemEvents";
import { compactDerivedFileIcon, isLnkPath, normalizeOptionalPath } from "../../stores/launcher/path-utils";
import { removeDependenciesFromMap, remapDependencyCategoryRefsInMap } from "../../stores/launcher/dependency-utils";
import {
  clearPendingLnkResolve,
  isPendingLnkResolve,
  makeLnkQueueKey,
  markPendingLnkResolve,
} from "../../stores/launcher/icon-queue";

export type DomainLaunchDependency = {
  categoryId: string;
  itemId: string;
  delayAfterSeconds: number;
};

export type DomainLauncherItem = {
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
  usageCount?: number;
  launchDependencies: DomainLaunchDependency[];
  launchDelaySeconds: number;
};

export type DomainRecentUsedItem = {
  categoryId: string;
  itemId: string;
  usedAt: number;
  usageCount: number;
};

export type DomainItemPatch = Partial<
  Pick<
    DomainLauncherItem,
    | "name"
    | "url"
    | "path"
    | "resolvedPath"
    | "launchDependencies"
    | "launchDelaySeconds"
    | "iconBase64"
    | "hasCustomIcon"
  >
>;

export type DomainAddPathsPayload = {
  paths: string[];
  directories: string[];
  icon_base64s: Array<string | null>;
  itemTypes?: Array<"file" | "url">;
};

export type DomainCreateItemPayload = {
  name: string;
  path?: string;
  url?: string;
  itemType: "file" | "url";
  isDirectory?: boolean;
  iconBase64?: string | null;
  launchDependencies?: DomainLaunchDependency[];
  launchDelaySeconds?: number;
};

export type DomainIconUpdateKind = "derived" | "custom";

export type DomainLnkTarget = { itemId: string; path: string };

export type DomainItemStatsSinks = {
  removeLaunchEventsForItems: (categoryId: string, itemIds: string[]) => void;
  removeLaunchEventsForCategory: (categoryId: string) => void;
  remapLaunchEventCategoryRefs: (
    mappings: Array<{ fromCategoryId: string; toCategoryId: string; itemId: string }>,
  ) => void;
  clearLaunchHistory?: () => void;
  recordSearch?: (keyword: string) => void;
};

export type AppsItemOpsState = {
  itemsByCategoryId: Ref<Record<string, DomainLauncherItem[]>>;
  pinnedItemIds: Ref<string[]>;
  recentUsedItems: Ref<DomainRecentUsedItem[]>;
  createId: () => string;
  emit: (event: ItemEvent) => void;
  /** Present on no-kernel fallback; AppsService leaves this undefined (stats-event-sync observes). */
  stats?: DomainItemStatsSinks;
  removeItemFromAllScenarios?: (itemId: string) => void;
  cacheOriginalIcon?: (
    itemType: DomainLauncherItem["itemType"],
    path: string,
    iconBase64: string | null | undefined,
  ) => void;
  getCachedOriginalIconForPath?: (path: string) => string | null;
  cacheIcon?: (path: string, icon: string) => void;
  hydrateMissingIconsForItems?: (
    targets: Array<{ categoryId: string; itemId: string }>,
    options?: { forceReplace?: boolean; skipCache?: boolean; maxEdge?: number },
  ) => Promise<unknown>;
  refreshLauncherItemUrlFavicon?: (
    categoryId: string,
    itemId: string,
    url: string,
    updateIcon: (categoryId: string, itemId: string, iconBase64: string) => void,
  ) => Promise<unknown> | void;
  removeCachedIconsForCategory?: (categoryId: string) => void;
  resolveLnkTarget?: (path: string) => Promise<string | null | undefined>;
};

function getItems(state: AppsItemOpsState, categoryId: string): DomainLauncherItem[] {
  return state.itemsByCategoryId.value[categoryId] || [];
}

function setItems(
  state: AppsItemOpsState,
  categoryId: string,
  items: DomainLauncherItem[],
): void {
  state.itemsByCategoryId.value = {
    ...state.itemsByCategoryId.value,
    [categoryId]: items,
  };
}

function getById(
  state: AppsItemOpsState,
  categoryId: string,
  itemId: string,
): DomainLauncherItem | null {
  return getItems(state, categoryId).find((x) => x.id === itemId) || null;
}

function cacheIconForItem(
  state: AppsItemOpsState,
  itemType: DomainLauncherItem["itemType"],
  path: string,
  iconBase64: string | null | undefined,
): void {
  const cache = state.cacheOriginalIcon ?? cacheOriginalIconForFileItem;
  cache(itemType, path, iconBase64);
}

export function applyRemoveDependenciesMatching(
  itemsByCategoryId: Ref<Record<string, DomainLauncherItem[]>>,
  predicate: (d: DomainLaunchDependency) => boolean,
): void {
  itemsByCategoryId.value = removeDependenciesFromMap(
    itemsByCategoryId.value,
    predicate,
  );
}

export function applyRemapDependencyCategoryRefs(
  itemsByCategoryId: Ref<Record<string, DomainLauncherItem[]>>,
  mappings: Array<{ fromCategoryId: string; toCategoryId: string; itemId: string }>,
): void {
  const next = remapDependencyCategoryRefsInMap(itemsByCategoryId.value, mappings);
  if (next !== itemsByCategoryId.value) {
    itemsByCategoryId.value = next;
  }
}

async function defaultResolveLnkTarget(path: string): Promise<string | null | undefined> {
  try {
    const result = await invoke<string | null>("resolve_lnk_target", { path });
    return result.ok ? result.value : undefined;
  } catch {
    return undefined;
  }
}

export function opsQueueResolveLnkTargets(
  state: AppsItemOpsState,
  categoryId: string,
  targets: DomainLnkTarget[],
  setResolvedPath?: (
    categoryId: string,
    itemId: string,
    resolvedPath: string | null | undefined,
  ) => boolean,
): void {
  if (!targets.length) return;
  const resolve =
    state.resolveLnkTarget ?? defaultResolveLnkTarget;
  const applyResolved =
    setResolvedPath ??
    ((cid: string, iid: string, resolved: string | null | undefined) =>
      opsSetItemResolvedPath(state, cid, iid, resolved));

  for (const target of targets) {
    const normalizedPath = normalizeOptionalPath(target.path);
    if (!normalizedPath || !isLnkPath(normalizedPath)) continue;
    const item = getById(state, categoryId, target.itemId);
    if (!item || item.itemType !== "file") continue;
    if (normalizeOptionalPath(item.path) !== normalizedPath) continue;
    if (normalizeOptionalPath(item.resolvedPath)) continue;
    const queueKey = makeLnkQueueKey(categoryId, target.itemId);
    if (isPendingLnkResolve(queueKey)) continue;
    markPendingLnkResolve(queueKey);
    void resolve(normalizedPath)
      .then((resolved) => {
        applyResolved(categoryId, target.itemId, normalizeOptionalPath(resolved ?? undefined));
      })
      .catch(() => {})
      .finally(() => {
        clearPendingLnkResolve(queueKey);
      });
  }
}

export function opsUpdateItem(
  state: AppsItemOpsState,
  categoryId: string,
  itemId: string,
  patch: DomainItemPatch,
): void {
  const list = getItems(state, categoryId);
  const index = list.findIndex((x) => x.id === itemId);
  if (index === -1) return;
  const next = [...list];
  const currentItem = next[index];
  const nextPath = patch.path !== undefined ? patch.path : currentItem.path;
  let nextResolvedPath = currentItem.resolvedPath;
  let shouldResolveLnkPath = false;
  if (currentItem.itemType === "file") {
    if (patch.resolvedPath !== undefined) {
      nextResolvedPath = normalizeOptionalPath(patch.resolvedPath);
    } else if (patch.path !== undefined) {
      if (isLnkPath(nextPath)) {
        const normalizedNextPath = normalizeOptionalPath(nextPath);
        const currentNormalizedPath = normalizeOptionalPath(currentItem.path);
        if (normalizedNextPath !== currentNormalizedPath) {
          nextResolvedPath = undefined;
          shouldResolveLnkPath = true;
        }
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
        ? normalizeLaunchDependencies(patch.launchDependencies, { categoryId, itemId })
        : currentItem.launchDependencies,
    launchDelaySeconds:
      patch.launchDelaySeconds !== undefined
        ? normalizeDelaySeconds(patch.launchDelaySeconds)
        : currentItem.launchDelaySeconds,
  };
  setItems(state, categoryId, next);
  state.emit({ type: "item:updated", categoryId, item: next[index] });
  if (shouldResolveLnkPath) {
    opsQueueResolveLnkTargets(state, categoryId, [{ itemId, path: nextPath }]);
  }
}

export function opsUpdateItems(
  state: AppsItemOpsState,
  categoryId: string,
  itemIds: string[],
  patch: Partial<Pick<DomainLauncherItem, "launchDelaySeconds">>,
): void {
  const targetIds = new Set(itemIds);
  if (targetIds.size === 0) return;
  const list = getItems(state, categoryId);
  const updatedItems: DomainLauncherItem[] = [];
  let changed = false;
  const next = list.map((item) => {
    if (!targetIds.has(item.id)) return item;
    const updatedItem: DomainLauncherItem = {
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
  setItems(state, categoryId, next);
  for (const item of updatedItems) {
    state.emit({ type: "item:updated", categoryId, item });
  }
}

export function opsRemoveItems(
  state: AppsItemOpsState,
  categoryId: string,
  itemIds: string[],
): void {
  const targetIds = new Set(itemIds);
  if (targetIds.size === 0) return;
  const list = getItems(state, categoryId);
  const removedItems = list.filter((item) => targetIds.has(item.id));
  if (removedItems.length === 0) return;
  setItems(state, categoryId, list.filter((item) => !targetIds.has(item.id)));
  state.pinnedItemIds.value = state.pinnedItemIds.value.filter((id) => !targetIds.has(id));
  state.recentUsedItems.value = state.recentUsedItems.value.filter(
    (item) => !(item.categoryId === categoryId && targetIds.has(item.itemId)),
  );
  state.stats?.removeLaunchEventsForItems(categoryId, [...targetIds]);
  applyRemoveDependenciesMatching(
    state.itemsByCategoryId,
    (d) => d.categoryId === categoryId && targetIds.has(d.itemId),
  );
  if (state.removeItemFromAllScenarios) {
    for (const itemId of targetIds) state.removeItemFromAllScenarios(itemId);
  }
  for (const item of removedItems) {
    state.emit({ type: "item:deleted", categoryId, itemId: item.id });
  }
}

export function opsRemoveItem(
  state: AppsItemOpsState,
  categoryId: string,
  itemId: string,
): void {
  opsRemoveItems(state, categoryId, [itemId]);
}

export function opsMoveItems(
  state: AppsItemOpsState,
  sourceCategoryId: string,
  targetCategoryId: string,
  itemIds: string[],
): void {
  if (sourceCategoryId === targetCategoryId) return;
  const requestedIds = new Set(itemIds);
  if (requestedIds.size === 0) return;
  const sourceItems = getItems(state, sourceCategoryId);
  const targetItems = getItems(state, targetCategoryId);
  const targetItemIds = new Set(targetItems.map((item) => item.id));
  const movedItems = sourceItems.filter(
    (item) => requestedIds.has(item.id) && !targetItemIds.has(item.id),
  );
  if (movedItems.length === 0) return;
  const movedIds = new Set(movedItems.map((item) => item.id));
  setItems(
    state,
    sourceCategoryId,
    sourceItems.filter((item) => !movedIds.has(item.id)),
  );
  setItems(state, targetCategoryId, [...targetItems, ...movedItems]);
  state.recentUsedItems.value = state.recentUsedItems.value.map((recentItem) => {
    if (recentItem.categoryId !== sourceCategoryId || !movedIds.has(recentItem.itemId)) {
      return recentItem;
    }
    return { ...recentItem, categoryId: targetCategoryId };
  });
  const mappings = movedItems.map((item) => ({
    fromCategoryId: sourceCategoryId,
    toCategoryId: targetCategoryId,
    itemId: item.id,
  }));
  state.stats?.remapLaunchEventCategoryRefs(mappings);
  applyRemapDependencyCategoryRefs(state.itemsByCategoryId, mappings);
  state.emit({
    type: "item:moved",
    fromCategoryId: sourceCategoryId,
    toCategoryId: targetCategoryId,
    itemIds,
  });
}

function compactItem(item: DomainLauncherItem): DomainLauncherItem {
  return compactDerivedFileIcon(item as never) as DomainLauncherItem;
}

function collectLnkTargets(
  entries: Array<{ id: string; path: string; itemType: "file" | "url" }>,
): DomainLnkTarget[] {
  const resolveTargets: DomainLnkTarget[] = [];
  for (const entry of entries) {
    if (entry.itemType === "file" && isLnkPath(entry.path)) {
      resolveTargets.push({ itemId: entry.id, path: entry.path });
    }
  }
  return resolveTargets;
}

export function collectLnkTargetsFromEntries(
  entries: Array<{ id: string; path: string; itemType: "file" | "url" }>,
): DomainLnkTarget[] {
  return collectLnkTargets(entries);
}

export function opsAddFileItems(
  state: AppsItemOpsState,
  categoryId: string,
  payload: DomainAddPathsPayload,
): string[] {
  const directorySet = new Set(payload.directories);
  const resolveTargets: DomainLnkTarget[] = [];
  const existing = getItems(state, categoryId);
  const nextItems: DomainLauncherItem[] = payload.paths.map((path, index) => {
    const iconBase64 = normalizeIconBase64(payload.icon_base64s[index] ?? null);
    const itemType = payload.itemTypes?.[index] ?? "file";
    const itemPath = itemType === "url" ? "" : path;
    cacheIconForItem(state, itemType, itemPath, iconBase64);
    const nextItem: DomainLauncherItem = {
      id: state.createId(),
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
    const storedItem = compactItem(nextItem);
    if (itemType === "file" && isLnkPath(itemPath)) {
      resolveTargets.push({ itemId: storedItem.id, path: itemPath });
    }
    return storedItem;
  });
  setItems(state, categoryId, [...existing, ...nextItems]);
  for (const item of nextItems) {
    state.emit({ type: "item:created", categoryId, item });
  }
  opsQueueResolveLnkTargets(state, categoryId, resolveTargets);
  return nextItems.map((item) => item.id);
}

export async function opsAddFileItemsBatched(
  state: AppsItemOpsState,
  categoryId: string,
  payload: DomainAddPathsPayload,
  batchSize: number = 20,
): Promise<string[]> {
  const { paths, directories, icon_base64s, itemTypes } = payload;
  const directorySet = new Set(directories);
  const allIds: string[] = [];
  const totalBatches = Math.ceil(paths.length / batchSize);
  const resolveTargets: DomainLnkTarget[] = [];

  for (let batch = 0; batch < totalBatches; batch++) {
    const start = batch * batchSize;
    const end = Math.min(start + batchSize, paths.length);
    const existing = getItems(state, categoryId);
    const batchItems: DomainLauncherItem[] = [];
    for (let i = start; i < end; i++) {
      const iconBase64 = normalizeIconBase64(icon_base64s[i] ?? null);
      const itemType = itemTypes?.[i] ?? "file";
      const itemPath = itemType === "url" ? "" : paths[i];
      cacheIconForItem(state, itemType, itemPath, iconBase64);
      const id = state.createId();
      allIds.push(id);
      const nextItem: DomainLauncherItem = {
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
      };
      batchItems.push(compactItem(nextItem));
      if (itemType === "file" && isLnkPath(itemPath)) {
        resolveTargets.push({ itemId: id, path: itemPath });
      }
    }
    setItems(state, categoryId, [...existing, ...batchItems]);
    for (const item of batchItems) {
      state.emit({ type: "item:created", categoryId, item });
    }

    if (batch < totalBatches - 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  opsQueueResolveLnkTargets(state, categoryId, resolveTargets);
  return allIds;
}

export function opsApplyDropIcons(
  state: AppsItemOpsState,
  categoryId: string,
  paths: string[],
  iconBase64s: Array<string | null>,
): void {
  const list = getItems(state, categoryId);
  const pathToIcon = new Map<string, string>();
  for (let i = 0; i < paths.length; i++) {
    const icon = normalizeIconBase64(iconBase64s[i]);
    if (!icon) continue;
    pathToIcon.set(paths[i], icon);
    state.cacheIcon?.(paths[i], icon);
  }
  if (pathToIcon.size === 0) return;

  let changed = false;
  const updatedItems: DomainLauncherItem[] = [];
  const next = list.map((item) => {
    const icon = pathToIcon.get(item.path);
    if (icon === undefined) return item;
    changed = true;
    const updated = compactItem({
      ...item,
      iconBase64: icon,
      hasCustomIcon: false,
    });
    updatedItems.push(updated);
    return updated;
  });
  if (!changed) return;
  setItems(state, categoryId, next);
  for (const item of updatedItems) {
    state.emit({ type: "item:updated", categoryId, item });
  }
}

export function opsAddUrlItem(
  state: AppsItemOpsState,
  categoryId: string,
  payload: { name: string; url: string; icon_base64?: string | null },
): string {
  const existing = getItems(state, categoryId);
  const iconBase64 = normalizeIconBase64(payload.icon_base64 ?? null);
  const newItem: DomainLauncherItem = {
    id: state.createId(),
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
  const storedItem = compactItem(newItem);
  setItems(state, categoryId, [...existing, storedItem]);
  state.emit({ type: "item:created", categoryId, item: storedItem });
  return storedItem.id;
}

export function opsCreateItemInCategory(
  state: AppsItemOpsState,
  categoryId: string,
  payload: DomainCreateItemPayload,
): string {
  const existing = getItems(state, categoryId);
  const iconBase64 = normalizeIconBase64(payload.iconBase64 ?? null);
  const id = state.createId();
  if (payload.itemType === "file" && payload.path) {
    cacheIconForItem(state, payload.itemType, payload.path, iconBase64);
  }
  const newItem: DomainLauncherItem = {
    id,
    name: payload.name,
    path: payload.itemType === "url" ? "" : (payload.path ?? ""),
    resolvedPath:
      payload.itemType === "file" && !isLnkPath(payload.path ?? "")
        ? normalizeOptionalPath(payload.path ?? "")
        : undefined,
    url: payload.itemType === "url" ? payload.url : undefined,
    itemType: payload.itemType,
    isDirectory: payload.itemType === "file" ? !!payload.isDirectory : false,
    iconBase64,
    hasCustomIcon: iconBase64 !== null,
    launchDependencies: normalizeLaunchDependencies(payload.launchDependencies, {
      categoryId,
      itemId: id,
    }),
    launchDelaySeconds: normalizeDelaySeconds(payload.launchDelaySeconds),
  };
  const storedItem = compactItem(newItem);
  setItems(state, categoryId, [...existing, storedItem]);
  state.emit({ type: "item:created", categoryId, item: storedItem });
  if (storedItem.itemType === "file" && isLnkPath(storedItem.path)) {
    opsQueueResolveLnkTargets(state, categoryId, [
      { itemId: storedItem.id, path: storedItem.path },
    ]);
  }
  return storedItem.id;
}

export function opsSetItemResolvedPath(
  state: AppsItemOpsState,
  categoryId: string,
  itemId: string,
  resolvedPath: string | null | undefined,
): boolean {
  const currentItem = getById(state, categoryId, itemId);
  if (!currentItem || currentItem.itemType !== "file") return false;
  const normalized = normalizeOptionalPath(resolvedPath);
  if ((currentItem.resolvedPath ?? undefined) === normalized) return false;
  const list = getItems(state, categoryId);
  const index = list.findIndex((x) => x.id === itemId);
  if (index === -1) return false;
  const next = [...list];
  next[index] = { ...currentItem, resolvedPath: normalized };
  setItems(state, categoryId, next);
  state.emit({ type: "item:updated", categoryId, item: next[index] });
  clearPendingLnkResolve(makeLnkQueueKey(categoryId, itemId));
  return true;
}

export function opsUpdateItemIcon(
  state: AppsItemOpsState,
  kind: DomainIconUpdateKind,
  categoryId: string,
  itemId: string,
  iconBase64: string,
): void {
  const normalizedIcon = normalizeIconBase64(iconBase64);
  const currentItem = getById(state, categoryId, itemId);
  if (kind === "derived" && currentItem?.itemType === "file") {
    cacheIconForItem(state, currentItem.itemType, currentItem.path, normalizedIcon);
  }
  const hasCustomIcon = kind === "custom";
  if (kind === "derived" && !currentItem) return;
  const list = getItems(state, categoryId);
  const index = list.findIndex((x) => x.id === itemId);
  if (index === -1) return;
  const next = [...list];
  next[index] = { ...next[index], iconBase64: normalizedIcon, hasCustomIcon };
  setItems(state, categoryId, next);
  state.emit({
    type: "item:iconUpdated",
    categoryId,
    itemId,
    iconBase64: normalizedIcon,
  });
}

export function opsResetItemIcon(
  state: AppsItemOpsState,
  categoryId: string,
  itemId: string,
): void {
  const currentItem = getById(state, categoryId, itemId);
  if (!currentItem) return;
  const restoredIcon =
    currentItem.itemType === "file"
      ? (state.getCachedOriginalIconForPath?.(currentItem.path) ?? null)
      : null;

  const list = getItems(state, categoryId);
  const index = list.findIndex((x) => x.id === itemId);
  if (index !== -1) {
    const next = [...list];
    next[index] = { ...currentItem, iconBase64: restoredIcon, hasCustomIcon: false };
    setItems(state, categoryId, next);
  }

  if (currentItem.itemType === "file" && !restoredIcon) {
    void state.hydrateMissingIconsForItems?.([{ categoryId, itemId }], {
      forceReplace: true,
    });
    return;
  }
  state.emit({
    type: "item:iconUpdated",
    categoryId,
    itemId,
    iconBase64: restoredIcon,
  });
  if (currentItem.itemType === "url" && currentItem.url) {
    void state.refreshLauncherItemUrlFavicon?.(
      categoryId,
      itemId,
      currentItem.url,
      (cid, iid, icon) => opsUpdateItemIcon(state, "derived", cid, iid, icon),
    );
  }
}

export function opsDeleteCategoryCleanup(
  state: AppsItemOpsState,
  categoryId: string,
): void {
  const removedItems = getItems(state, categoryId);
  const removedItemIds = removedItems.map((x) => x.id);
  state.removeCachedIconsForCategory?.(categoryId);
  const next = { ...state.itemsByCategoryId.value };
  delete next[categoryId];
  state.itemsByCategoryId.value = next;
  if (removedItemIds.length) {
    const removedSet = new Set(removedItemIds);
    state.pinnedItemIds.value = state.pinnedItemIds.value.filter(
      (id) => !removedSet.has(id),
    );
  }
  state.recentUsedItems.value = state.recentUsedItems.value.filter(
    (x) => x.categoryId !== categoryId,
  );
  state.stats?.removeLaunchEventsForCategory(categoryId);
  applyRemoveDependenciesMatching(state.itemsByCategoryId, (d) => d.categoryId === categoryId);
  if (state.removeItemFromAllScenarios) {
    for (const itemId of removedItemIds) state.removeItemFromAllScenarios(itemId);
  }
  for (const item of removedItems) {
    state.emit({ type: "item:deleted", categoryId, itemId: item.id });
  }
}

export type DomainUpsertPayload = {
  id?: string;
  name: string;
  path?: string;
  url?: string;
  itemType: "file" | "url";
  isDirectory?: boolean;
  iconBase64?: string | null;
  hasCustomIcon?: boolean;
  isFavorite?: boolean;
  lastUsedAt?: number;
  usageCount?: number;
  launchDependencies?: DomainLaunchDependency[];
  launchDelaySeconds?: number;
};

export function opsUpsertItem(
  state: AppsItemOpsState,
  categoryId: string,
  payload: DomainUpsertPayload,
): string {
  const existing = payload.id ? getById(state, categoryId, payload.id) : null;
  if (existing) {
    const next: DomainLauncherItem = {
      ...existing,
      name: payload.name ?? existing.name,
      path: payload.itemType === "url" ? "" : (payload.path ?? existing.path),
      url:
        payload.itemType === "url" ? (payload.url ?? existing.url) : undefined,
      itemType: payload.itemType ?? existing.itemType,
      isDirectory:
        payload.itemType === "file"
          ? (payload.isDirectory ?? existing.isDirectory)
          : false,
      iconBase64:
        payload.iconBase64 !== undefined ? payload.iconBase64 : existing.iconBase64,
      hasCustomIcon:
        payload.hasCustomIcon !== undefined
          ? payload.hasCustomIcon
          : existing.hasCustomIcon,
      launchDependencies: normalizeLaunchDependencies(
        payload.launchDependencies ?? existing.launchDependencies,
        { categoryId, itemId: existing.id },
      ),
      launchDelaySeconds:
        payload.launchDelaySeconds !== undefined
          ? normalizeDelaySeconds(payload.launchDelaySeconds)
          : existing.launchDelaySeconds,
      resolvedPath:
        payload.itemType === "url"
          ? undefined
          : payload.path !== undefined
            ? normalizeOptionalPath(payload.path)
            : existing.resolvedPath,
    };
    const list = getItems(state, categoryId);
    const index = list.findIndex((x) => x.id === existing.id);
    const nextList = [...list];
    nextList[index] = next;
    setItems(state, categoryId, nextList);
    state.emit({ type: "item:updated", categoryId, item: next });
    return next.id;
  }

  const id = payload.id ?? state.createId();
  const iconBase64 = normalizeIconBase64(payload.iconBase64 ?? null);
  const item: DomainLauncherItem = compactItem({
    id,
    name: payload.name,
    path: payload.itemType === "url" ? "" : (payload.path ?? ""),
    resolvedPath:
      payload.itemType === "file" && !isLnkPath(payload.path ?? "")
        ? normalizeOptionalPath(payload.path ?? "")
        : undefined,
    url: payload.itemType === "url" ? payload.url : undefined,
    itemType: payload.itemType,
    isDirectory: payload.itemType === "file" ? !!payload.isDirectory : false,
    iconBase64,
    hasCustomIcon: payload.hasCustomIcon ?? iconBase64 !== null,
    isFavorite: payload.isFavorite ?? false,
    lastUsedAt: payload.lastUsedAt,
    usageCount: payload.usageCount ?? 0,
    launchDependencies: normalizeLaunchDependencies(payload.launchDependencies, {
      categoryId,
      itemId: id,
    }),
    launchDelaySeconds: normalizeDelaySeconds(payload.launchDelaySeconds),
  });
  setItems(state, categoryId, [...getItems(state, categoryId), item]);
  state.emit({ type: "item:created", categoryId, item });
  if (item.itemType === "file" && isLnkPath(item.path)) {
    opsQueueResolveLnkTargets(state, categoryId, [{ itemId: item.id, path: item.path }]);
  }
  return id;
}

export type DomainImportItemsOptions = {
  emitEvents?: boolean;
};

export function opsImportItems(
  state: AppsItemOpsState,
  items: Record<string, DomainLauncherItem[]>,
  options: DomainImportItemsOptions = {},
): void {
  state.itemsByCategoryId.value = { ...items };
  if (options.emitEvents) {
    for (const [categoryId, list] of Object.entries(items)) {
      for (const item of list) {
        state.emit({ type: "item:created", categoryId, item });
      }
    }
  }
}

export type DomainImportSnapshotPayload = {
  items: Record<string, DomainLauncherItem[]>;
  pinnedItemIds?: string[];
  recentUsedItems?: DomainRecentUsedItem[];
};

export function opsImportSnapshot(
  state: AppsItemOpsState,
  snapshot: DomainImportSnapshotPayload,
  options: {
    emitEvents?: boolean;
    onFilterScenarios?: (validItemIds: Set<string>) => void;
    clearLaunchHistory?: () => void;
  } = {},
): void {
  opsImportItems(state, snapshot.items, { emitEvents: options.emitEvents ?? false });
  const validItemIds = new Set(
    Object.values(snapshot.items).flatMap((items) => items.map((item) => item.id)),
  );
  if (snapshot.pinnedItemIds) {
    state.pinnedItemIds.value = [...new Set(snapshot.pinnedItemIds)];
  }
  if (snapshot.recentUsedItems) {
    state.recentUsedItems.value = [...snapshot.recentUsedItems];
  }
  options.onFilterScenarios?.(validItemIds);
  if (options.clearLaunchHistory) {
    state.stats?.clearLaunchHistory?.();
    options.clearLaunchHistory();
  }
}

export type DomainScannedAppPlan = {
  upsert: {
    name: string;
    path?: string;
    url?: string;
    itemType: "file" | "url";
    isDirectory: boolean;
    iconBase64: string | null;
    hasCustomIcon: boolean;
  };
  fallbackItemWithoutId: Omit<DomainLauncherItem, "id">;
};

export function opsAddScannedApp(
  state: AppsItemOpsState,
  categoryId: string,
  plan: DomainScannedAppPlan,
): string {
  return opsUpsertItem(state, categoryId, {
    ...plan.upsert,
    hasCustomIcon: plan.upsert.hasCustomIcon,
  });
}

export function opsAddScannedAppFallback(
  state: AppsItemOpsState,
  categoryId: string,
  plan: DomainScannedAppPlan,
): string {
  const newItem: DomainLauncherItem = compactItem({
    id: state.createId(),
    ...plan.fallbackItemWithoutId,
  });
  setItems(state, categoryId, [...getItems(state, categoryId), newItem]);
  state.emit({ type: "item:created", categoryId, item: newItem });
  return newItem.id;
}
