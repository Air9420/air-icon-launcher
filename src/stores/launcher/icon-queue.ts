import type { LauncherItemRef } from "../../composables/useItemsHelper";

/**
 * Module-level singleton queues.
 * Must NOT live inside the pinia setup body — that would create a new Set
 * per store instance and drop pending keys across re-installs/tests.
 */
const pendingDerivedIconRefreshKeys = new Set<string>();
const pendingLnkResolveKeys = new Set<string>();

export function markPendingDerivedIconRefresh(targets: LauncherItemRef[]): void {
  for (const target of targets) {
    pendingDerivedIconRefreshKeys.add(`${target.categoryId}:${target.itemId}`);
  }
}

export function consumePendingDerivedIconRefresh(targets: LauncherItemRef[]): LauncherItemRef[] {
  const refreshTargets: LauncherItemRef[] = [];
  for (const target of targets) {
    const key = `${target.categoryId}:${target.itemId}`;
    if (!pendingDerivedIconRefreshKeys.has(key)) continue;
    pendingDerivedIconRefreshKeys.delete(key);
    refreshTargets.push(target);
  }
  return refreshTargets;
}

export function isPendingLnkResolve(queueKey: string): boolean {
  return pendingLnkResolveKeys.has(queueKey);
}

export function markPendingLnkResolve(queueKey: string): void {
  pendingLnkResolveKeys.add(queueKey);
}

export function clearPendingLnkResolve(queueKey: string): void {
  pendingLnkResolveKeys.delete(queueKey);
}

export function makeLnkQueueKey(categoryId: string, itemId: string): string {
  return `${categoryId}:${itemId}`;
}

/** Test helper — clears module queues between suites. */
export function clearIconQueuesForTests(): void {
  pendingDerivedIconRefreshKeys.clear();
  pendingLnkResolveKeys.clear();
}
