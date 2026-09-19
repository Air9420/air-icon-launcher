import type { LauncherItem, ScenarioItemIds, ScenarioKey, ScenarioLaunchEntry } from "./types";

export function toggleScenarioItemIds(
  current: ScenarioItemIds,
  scenario: ScenarioKey,
  itemId: string,
): ScenarioItemIds {
  const ids = current[scenario] ?? [];
  const exists = ids.includes(itemId);
  const nextIds = exists ? ids.filter((id) => id !== itemId) : [...new Set([...ids, itemId])];
  return { ...current, [scenario]: nextIds };
}

/** Returns the same reference when nothing changed. */
export function removeItemFromAllScenariosIds(
  current: ScenarioItemIds,
  itemId: string,
): ScenarioItemIds {
  let changed = false;
  const next: ScenarioItemIds = {
    work: current.work,
    dev: current.dev,
    play: current.play,
  };
  (["work", "dev", "play"] as const).forEach((scenario) => {
    const filtered = next[scenario].filter((id) => id !== itemId);
    if (filtered.length !== next[scenario].length) {
      changed = true;
      next[scenario] = filtered;
    }
  });
  return changed ? next : current;
}

export function isItemInScenarioIds(
  current: ScenarioItemIds,
  scenario: ScenarioKey,
  itemId: string,
): boolean {
  return (current[scenario] ?? []).includes(itemId);
}

export function getScenarioLaunchItemsFromMaps(
  scenarioItemIds: ScenarioItemIds,
  itemsByCategoryId: Record<string, LauncherItem[]>,
  scenario: ScenarioKey,
): ScenarioLaunchEntry[] {
  const result: ScenarioLaunchEntry[] = [];
  const ids = scenarioItemIds[scenario] ?? [];
  for (const itemId of ids) {
    for (const [categoryId, items] of Object.entries(itemsByCategoryId)) {
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) continue;
      result.push({ categoryId, item });
      break;
    }
  }
  return result;
}

export function filterScenarioIds(validItemIds: Set<string>, ids: string[]): string[] {
  const dedupedIds = new Set<string>();
  return ids.filter((id) => {
    if (!validItemIds.has(id) || dedupedIds.has(id)) return false;
    dedupedIds.add(id);
    return true;
  });
}
