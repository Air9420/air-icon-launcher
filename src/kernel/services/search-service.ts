import { ref, type Ref } from "vue";
import { Service, type Context } from "cordis";
import type { AppError } from "../../utils/invoke-wrapper";
import { SEARCH_REQUEST_TIMEOUT_MS } from "../../utils/search-config";
import { itemEventBus, type ItemEvent } from "../../events/itemEvents";
import type { AppsLauncherItem } from "./apps-service";

export type SearchIndexItemPayload = {
  id: string;
  name: string;
  path: string;
  category_id: string;
  usage_count: number;
  last_used_at: number;
  is_pinned: boolean;
  search_tokens: string[];
  rank_score: number;
};

export type SearchIndexDeletedPayload = {
  id: string;
  category_id: string;
};

export type SearchIndexChangesPayload = {
  added: SearchIndexItemPayload[];
  updated: SearchIndexItemPayload[];
  deleted: SearchIndexDeletedPayload[];
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Cordis service bound to `ctx.search`.
 *
 * Search query + Rust index sync. Depends on `ctx.apps` for item truth.
 * IPC: `search_apps`, `update_search_items`, `update_search_items_incremental`
 * via `ctx.ipc` only.
 *
 * Domain events: listens to `itemEventBus` when `startEventSync()` is active
 * (searchStore adapter delegates here). Does not import pinia stores.
 */
export class SearchService extends Service {
  readonly query: Ref<string> = ref("");
  readonly results: Ref<RustSearchResult[]> = ref([]);
  readonly isReady = ref(false);
  readonly isSearching = ref(false);
  readonly lastError = ref<AppError | null>(null);

  private pendingAdded = new Map<string, SearchIndexItemPayload>();
  private pendingUpdated = new Map<string, SearchIndexItemPayload>();
  private pendingDeleted = new Map<string, SearchIndexDeletedPayload>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private incrementalInFlight: Promise<void> | null = null;
  private fullSyncInFlight: Promise<void> | null = null;
  private eventUnsubscribers: Array<() => void> = [];
  private listening = false;

  constructor(ctx: Context) {
    super(ctx, "search");
  }

  private get apps() {
    return this.ctx.apps;
  }

  private entryKey(categoryId: string, itemId: string): string {
    return `${categoryId}:${itemId}`;
  }

  private toIndexItem(categoryId: string, item: AppsLauncherItem): SearchIndexItemPayload {
    const apps = this.apps;
    let usageCount = 0;
    let lastUsedAt = 0;
    let isPinned = false;
    if (apps) {
      const key = this.entryKey(categoryId, item.id);
      for (const recent of apps.recentUsedItems.value) {
        if (this.entryKey(recent.categoryId, recent.itemId) === key) {
          usageCount += recent.usageCount;
          if (lastUsedAt < recent.usedAt) lastUsedAt = recent.usedAt;
        }
      }
      isPinned = apps.pinnedItemIds.value.includes(item.id);
    }
    return {
      id: item.id,
      name: item.name,
      path: item.path,
      category_id: categoryId,
      usage_count: usageCount,
      last_used_at: lastUsedAt,
      is_pinned: isPinned,
      search_tokens: [],
      rank_score: 0,
    };
  }

  private collectAllIndexItems(): SearchIndexItemPayload[] {
    const apps = this.apps;
    if (!apps) return [];
    const items: SearchIndexItemPayload[] = [];
    for (const category of apps.categories.value) {
      for (const item of apps.getItems(category.id)) {
        items.push(this.toIndexItem(category.id, item));
      }
    }
    // Include orphan category keys not listed in categories.
    for (const [categoryId, list] of Object.entries(apps.itemsByCategoryId.value)) {
      if (apps.getCategoryById(categoryId)) continue;
      for (const item of list) {
        items.push(this.toIndexItem(categoryId, item));
      }
    }
    return items;
  }

  private hasPending(): boolean {
    return (
      this.pendingAdded.size > 0 ||
      this.pendingUpdated.size > 0 ||
      this.pendingDeleted.size > 0
    );
  }

  private clearPending(): void {
    this.pendingAdded.clear();
    this.pendingUpdated.clear();
    this.pendingDeleted.clear();
  }

  private cancelFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private takePending(): SearchIndexChangesPayload {
    const changes: SearchIndexChangesPayload = {
      added: [...this.pendingAdded.values()],
      updated: [...this.pendingUpdated.values()],
      deleted: [...this.pendingDeleted.values()],
    };
    this.clearPending();
    return changes;
  }

  private scheduleFlush(delayMs = 250): void {
    if (!this.isReady.value) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushIncremental();
    }, delayMs);
  }

  private enqueue(changes: Partial<SearchIndexChangesPayload>): void {
    if (!this.isReady.value) return;
    for (const deleted of changes.deleted ?? []) {
      const key = this.entryKey(deleted.category_id, deleted.id);
      this.pendingAdded.delete(key);
      this.pendingUpdated.delete(key);
      this.pendingDeleted.set(key, deleted);
    }
    for (const added of changes.added ?? []) {
      const key = this.entryKey(added.category_id, added.id);
      this.pendingDeleted.delete(key);
      this.pendingUpdated.delete(key);
      this.pendingAdded.set(key, added);
    }
    for (const updated of changes.updated ?? []) {
      const key = this.entryKey(updated.category_id, updated.id);
      this.pendingDeleted.delete(key);
      if (this.pendingAdded.has(key)) {
        this.pendingAdded.set(key, updated);
      } else {
        this.pendingUpdated.set(key, updated);
      }
    }
    this.scheduleFlush();
  }

  /** Full index rebuild from AppsService truth → `update_search_items`. */
  async syncIndex(): Promise<void> {
    if (this.fullSyncInFlight) return this.fullSyncInFlight;
    this.fullSyncInFlight = (async () => {
      if (this.incrementalInFlight) {
        try {
          await this.incrementalInFlight;
        } catch {
          /* ignore */
        }
      }
      this.cancelFlush();
      this.clearPending();
      try {
        const items = this.collectAllIndexItems();
        const result = await this.ctx.ipc.invoke("update_search_items", { items });
        if (!result.ok) {
          console.error("Failed to sync search index:", result.error);
          this.isReady.value = false;
          this.lastError.value = result.error;
          return;
        }
        this.isReady.value = true;
        this.lastError.value = null;
      } catch (e) {
        console.error("Failed to sync search index:", e);
        this.isReady.value = false;
      } finally {
        this.fullSyncInFlight = null;
        if (this.isReady.value && this.hasPending()) {
          this.scheduleFlush(0);
        }
      }
    })();
    return this.fullSyncInFlight;
  }

  /** Alias used by packet/docs. */
  async syncFullIndex(): Promise<void> {
    return this.syncIndex();
  }

  async flushIncremental(): Promise<void> {
    if (!this.isReady.value) {
      this.clearPending();
      return;
    }
    if (this.fullSyncInFlight || this.incrementalInFlight) return;

    const changes = this.takePending();
    if (
      changes.added.length === 0 &&
      changes.updated.length === 0 &&
      changes.deleted.length === 0
    ) {
      return;
    }

    this.incrementalInFlight = (async () => {
      const result = await this.ctx.ipc.invoke(
        "update_search_items_incremental",
        { changes },
      );
      if (!result.ok) {
        console.error("Failed to incrementally sync search index:", result.error);
        await this.syncIndex();
      }
    })()
      .catch((e) => {
        console.error("Failed to incrementally sync search index:", e);
      })
      .finally(() => {
        this.incrementalInFlight = null;
        if (this.hasPending()) {
          this.scheduleFlush(0);
        }
      });

    await this.incrementalInFlight;
  }

  /**
   * Rust search via `search_apps`. Updates `results` / `query`.
   * Returns the result list for imperative callers.
   */
  async search(keyword: string, limit = 20): Promise<RustSearchResult[]> {
    this.query.value = keyword;
    const trimmed = keyword.trim();
    if (!trimmed) {
      this.results.value = [];
      return [];
    }

    this.isSearching.value = true;
    try {
      if (!this.isReady.value) {
        await this.syncIndex();
      }
      const result = await withTimeout(
        this.ctx.ipc.invoke<RustSearchResult[]>("search_apps", {
          query: {
            keyword: trimmed,
            limit,
            category_id: null,
          },
        }),
        SEARCH_REQUEST_TIMEOUT_MS,
      );
      if (result === null) {
        console.warn(
          `Rust search timed out after ${SEARCH_REQUEST_TIMEOUT_MS}ms`,
          trimmed,
        );
        this.results.value = [];
        return [];
      }
      if (!result.ok) {
        console.error("Rust search failed:", result.error);
        this.lastError.value = result.error;
        this.results.value = [];
        return [];
      }
      this.results.value = result.value;
      return result.value;
    } catch (e) {
      console.error("Rust search failed:", e);
      this.results.value = [];
      return [];
    } finally {
      this.isSearching.value = false;
    }
  }

  clear(): void {
    this.query.value = "";
    this.results.value = [];
  }

  /** searchStore adapter: begin itemEventBus → incremental index sync. */
  startEventSync(): void {
    if (this.listening) return;
    this.listening = true;

    const onEvent = (event: ItemEvent) => {
      const apps = this.apps;
      if (!apps) return;

      if (event.type === "item:created") {
        this.enqueue({
          added: [this.toIndexItem(event.categoryId, event.item)],
        });
        return;
      }
      if (event.type === "item:updated" || event.type === "item:iconUpdated") {
        const item =
          event.type === "item:updated"
            ? event.item
            : apps.getItemById(event.categoryId, event.itemId);
        if (!item) return;
        this.enqueue({
          updated: [this.toIndexItem(event.categoryId, item)],
        });
        return;
      }
      if (event.type === "item:deleted") {
        this.enqueue({
          deleted: [{ category_id: event.categoryId, id: event.itemId }],
        });
        return;
      }
      if (event.type === "item:moved") {
        const deleted = event.itemIds.map((id) => ({
          category_id: event.fromCategoryId,
          id,
        }));
        const added: SearchIndexItemPayload[] = [];
        for (const itemId of event.itemIds) {
          const item = apps.getItemById(event.toCategoryId, itemId);
          if (item) {
            added.push(this.toIndexItem(event.toCategoryId, item));
          }
        }
        this.enqueue({ deleted, added });
        return;
      }
      if (event.type === "item:pinningToggled") {
        const found = apps.findItemAnywhere(event.itemId);
        if (found) {
          this.enqueue({
            updated: [this.toIndexItem(found.categoryId, found.item)],
          });
        }
        return;
      }
      if (event.type === "item:usageRecorded") {
        this.enqueue({
          updated: [
            {
              id: event.itemId,
              name: "",
              path: "",
              category_id: event.categoryId,
              usage_count: event.usageCount,
              last_used_at: event.lastUsedAt,
              is_pinned: false,
              search_tokens: [],
              rank_score: 0,
            },
          ],
        });
      }
    };

    this.eventUnsubscribers.push(itemEventBus.onAny(onEvent));
  }

  stopEventSync(): void {
    for (const unsub of this.eventUnsubscribers) {
      unsub();
    }
    this.eventUnsubscribers = [];
    this.listening = false;
    this.cancelFlush();
    this.clearPending();
  }

  /** Incremental enqueue used by adapters that still hold local event logic. */
  enqueueChanges(changes: Partial<SearchIndexChangesPayload>): void {
    this.enqueue(changes);
  }

  toSearchIndexItem(categoryId: string, item: AppsLauncherItem): SearchIndexItemPayload {
    return this.toIndexItem(categoryId, item);
  }
}
