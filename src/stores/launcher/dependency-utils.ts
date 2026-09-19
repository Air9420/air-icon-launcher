import type { LaunchDependency, LauncherItem } from "./types";

export type DependencyRefMapping = {
  fromCategoryId: string;
  toCategoryId: string;
  itemId: string;
};

/** Returns a new items map with dependencies matching `predicate` removed. */
export function removeDependenciesFromMap(
  itemsByCategoryId: Record<string, LauncherItem[]>,
  predicate: (d: LaunchDependency) => boolean,
): Record<string, LauncherItem[]> {
  const nextByCategoryId: Record<string, LauncherItem[]> = {};
  for (const [categoryId, items] of Object.entries(itemsByCategoryId)) {
    nextByCategoryId[categoryId] = items.map((item) => {
      const nextDeps = item.launchDependencies.filter((d) => !predicate(d));
      if (nextDeps.length === item.launchDependencies.length) return item;
      return { ...item, launchDependencies: nextDeps };
    });
  }
  return nextByCategoryId;
}

/**
 * Remaps dependency category refs. Returns the same reference when nothing changed
 * so callers can skip assigning.
 */
export function remapDependencyCategoryRefsInMap(
  itemsByCategoryId: Record<string, LauncherItem[]>,
  mappings: DependencyRefMapping[],
): Record<string, LauncherItem[]> {
  if (mappings.length === 0) return itemsByCategoryId;
  const keyMap = new Map(
    mappings.map((m) => [`${m.fromCategoryId}:${m.itemId}`, m.toCategoryId]),
  );
  let changed = false;
  const nextByCategoryId: Record<string, LauncherItem[]> = {};
  for (const [categoryId, items] of Object.entries(itemsByCategoryId)) {
    nextByCategoryId[categoryId] = items.map((item) => {
      let itemChanged = false;
      const nextDeps = item.launchDependencies.map((d) => {
        const to = keyMap.get(`${d.categoryId}:${d.itemId}`);
        if (!to || to === d.categoryId) return d;
        itemChanged = true;
        return { ...d, categoryId: to };
      });
      if (!itemChanged) return item;
      changed = true;
      return { ...item, launchDependencies: nextDeps };
    });
  }
  return changed ? nextByCategoryId : itemsByCategoryId;
}
