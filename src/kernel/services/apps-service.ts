import { computed, ref, type ComputedRef, type Ref } from "vue";
import { Service, type Context } from "cordis";
import type { AppError, InvokeResult } from "../../utils/invoke-wrapper";
import {
  launchStoredItem,
  type LaunchStoredItemOptions,
} from "../../utils/launcher-service";
import type {
  ExecutableLauncherItem,
  ExecuteLauncherItemResult,
  LauncherItemRef,
} from "../../utils/launcher-executor";
import { itemEventBus } from "../../events/itemEvents";
import {
  cacheOriginalIconForFileItem,
  getCachedOriginalIconForPath,
  useItemsHelper,
} from "../../composables/useItemsHelper";
import {
  consumePendingDerivedIconRefresh,
} from "../../stores/launcher/icon-queue";
import {
  buildScannedAppInsertPlan,
  type ScannedAppInput,
} from "../../stores/launcher/import-utils";
import {
  opsAddFileItems,
  opsAddFileItemsBatched,
  opsAddScannedApp,
  opsAddScannedAppFallback,
  opsAddUrlItem,
  opsApplyDropIcons,
  opsCreateItemInCategory,
  opsDeleteCategoryCleanup,
  opsImportItems,
  opsImportSnapshot,
  opsMoveItems,
  opsQueueResolveLnkTargets,
  opsRemoveItem,
  opsRemoveItems,
  opsResetItemIcon,
  opsSetItemResolvedPath,
  opsUpdateItem,
  opsUpdateItemIcon,
  opsUpdateItems,
  opsUpsertItem,
  type AppsItemOpsState,
  type DomainAddPathsPayload,
  type DomainCreateItemPayload,
  type DomainImportSnapshotPayload,
  type DomainItemPatch,
  type DomainLauncherItem,
  type DomainLnkTarget,
} from "../domain/apps-item-ops";

/** Launcher item truth shape owned by AppsService (superset of store item fields). */
export type AppsLaunchDependency = {
  categoryId: string;
  itemId: string;
  delayAfterSeconds: number;
};

export type AppsLauncherItem = {
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
  launchDependencies: AppsLaunchDependency[];
  launchDelaySeconds: number;
};

export type AppsCategory = {
  id: string;
  name: string;
  customIconBase64: string | null;
};

export type AppsRecentUsedItem = {
  categoryId: string;
  itemId: string;
  usedAt: number;
  usageCount: number;
};

/** Backend `launcher_data` JSON shape (compatible with existing files). */
export type PersistedAppsItem = {
  id: string;
  name: string;
  path?: string;
  resolved_path?: string | null;
  url?: string;
  item_type?: "file" | "url";
  is_directory: boolean;
  icon_base64?: string | null;
  has_custom_icon?: boolean;
  is_favorite?: boolean;
  last_used_at?: number | null;
  launch_dependencies?: Array<{
    category_id: string;
    item_id: string;
    delay_after_seconds?: number | null;
  }>;
  launch_delay_seconds?: number | null;
};

export type PersistedAppsCategory = {
  id: string;
  name: string;
  custom_icon_base64?: string | null;
  items?: PersistedAppsItem[];
};

export type PersistedAppsRecentUsedItem = {
  category_id: string;
  item_id: string;
  used_at: number;
  usage_count?: number;
};

export type PersistedAppsLauncherData = {
  version?: string;
  categories: PersistedAppsCategory[];
  favorite_item_ids: string[];
  recent_used_items: PersistedAppsRecentUsedItem[];
};

export type AppsUpsertItemPayload = {
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
  launchDependencies?: AppsLaunchDependency[];
  launchDelaySeconds?: number;
};

export type AppsItemPatch = Partial<
  Pick<
    AppsLauncherItem,
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

export const DEFAULT_APPS_CATEGORIES: AppsCategory[] = [
  { id: "cat-0", name: "Air", customIconBase64: null },
  { id: "cat-1", name: "游戏", customIconBase64: null },
  { id: "cat-2", name: "工具", customIconBase64: null },
  { id: "cat-3", name: "系统", customIconBase64: null },
  { id: "cat-4", name: "其他", customIconBase64: null },
];

function createAppsItemId(): string {
  return `item-${crypto.randomUUID()}`;
}

function normalizeOptionalPath(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeDelaySeconds(value: number | undefined | null): number {
  if (!Number.isFinite(value as number)) return 0;
  return Math.max(0, Math.floor((value as number) ?? 0));
}

function mapPersistedItem(item: PersistedAppsItem): AppsLauncherItem {
  const itemType = item.item_type || "file";
  const path = item.path || "";
  const resolvedPath =
    itemType === "file"
      ? normalizeOptionalPath(item.resolved_path ?? path)
      : undefined;
  return {
    id: item.id,
    name: item.name,
    path: itemType === "url" ? "" : path,
    resolvedPath,
    url: item.url,
    itemType,
    isDirectory: !!item.is_directory,
    iconBase64: item.icon_base64 ?? null,
    hasCustomIcon: !!item.has_custom_icon,
    isFavorite: !!item.is_favorite,
    lastUsedAt: item.last_used_at ?? undefined,
    launchDependencies: (item.launch_dependencies || []).map((d) => ({
      categoryId: d.category_id,
      itemId: d.item_id,
      delayAfterSeconds: normalizeDelaySeconds(d.delay_after_seconds),
    })),
    launchDelaySeconds: normalizeDelaySeconds(item.launch_delay_seconds),
  };
}

function toPersistedItem(item: AppsLauncherItem): PersistedAppsItem {
  return {
    id: item.id,
    name: item.name,
    path: item.path,
    resolved_path: item.resolvedPath ?? null,
    url: item.url,
    item_type: item.itemType,
    is_directory: item.isDirectory,
    icon_base64:
      item.itemType === "file" && item.hasCustomIcon !== true
        ? null
        : item.iconBase64,
    has_custom_icon: item.hasCustomIcon === true ? true : undefined,
    is_favorite: item.isFavorite || false,
    last_used_at: item.lastUsedAt || null,
    launch_dependencies: (item.launchDependencies || []).map((d) => ({
      category_id: d.categoryId,
      item_id: d.itemId,
      delay_after_seconds: d.delayAfterSeconds,
    })),
    launch_delay_seconds: item.launchDelaySeconds,
  };
}

/**
 * Cordis service bound to `ctx.apps`.
 *
 * Single write entry for launcher item / category / launch domain during P5:
 * - Owns Vue refs as domain truth (`itemsByCategoryId`, `pinnedItemIds`,
 *   `recentUsedItems`, `categories`).
 * - Pinia launcherStore / categoryStore may SHARE these refs as read adapters.
 * - itemsStore does not share refs (persist collision); it delegates core
 *   CRUD/launch writes here when `ctx.apps` is present.
 * - Domain events go through `itemEventBus` (stats / search listen). Never
 *   have stats write into AppsService.
 *
 * IPC only via `ctx.ipc` (invoke-wrapper). Does not import pinia stores.
 */
export class AppsService extends Service {
  readonly itemsByCategoryId: Ref<Record<string, AppsLauncherItem[]>> = ref({});
  readonly pinnedItemIds: Ref<string[]> = ref([]);
  readonly recentUsedItems: Ref<AppsRecentUsedItem[]> = ref([]);
  readonly categories: Ref<AppsCategory[]> = ref(
    DEFAULT_APPS_CATEGORIES.map((c) => ({ ...c })),
  );
  readonly loading = ref(false);
  readonly lastError = ref<AppError | null>(null);
  readonly hydrated = ref(false);

  /** Packet-facing alias: items truth. */
  readonly items: ComputedRef<Record<string, AppsLauncherItem[]>> = computed(
    () => this.itemsByCategoryId.value,
  );

  private itemsHelperInstance: ReturnType<typeof useItemsHelper> | null = null;

  constructor(ctx: Context) {
    super(ctx, "apps");
  }

  /**
   * Domain ops state bag bound to this service's refs.
   * No stats sinks — kernel path relies on stats-event-sync observing itemEventBus.
   */
  private opsState(): AppsItemOpsState {
    return {
      itemsByCategoryId: this.itemsByCategoryId as unknown as AppsItemOpsState["itemsByCategoryId"],
      pinnedItemIds: this.pinnedItemIds,
      recentUsedItems: this.recentUsedItems as unknown as AppsItemOpsState["recentUsedItems"],
      createId: () => this.createItemId(),
      emit: (event) => itemEventBus.emit(event),
      cacheOriginalIcon: cacheOriginalIconForFileItem,
      getCachedOriginalIconForPath,
      cacheIcon: (path, icon) => {
        cacheOriginalIconForFileItem("file", path, icon);
      },
      hydrateMissingIconsForItems: this.itemsHelper.hydrateMissingIconsForItems as never,
      refreshLauncherItemUrlFavicon: this.itemsHelper.refreshLauncherItemUrlFavicon as never,
      removeCachedIconsForCategory: this.itemsHelper.removeCachedIconsForCategory,
      resolveLnkTarget: async (path) => {
        const result = await this.ctx.ipc.invoke<string | null>("resolve_lnk_target", {
          path,
        });
        return result.ok ? result.value : undefined;
      },
    };
  }

  private get itemsHelper(): ReturnType<typeof useItemsHelper> {
    if (!this.itemsHelperInstance) {
      this.itemsHelperInstance = useItemsHelper(
        (categoryId) => this.getItems(categoryId) as never,
        (categoryId, itemId) => this.getItemById(categoryId, itemId) as never,
        (map) => {
          this.itemsByCategoryId.value = {
            ...this.itemsByCategoryId.value,
            ...(map as Record<string, AppsLauncherItem[]>),
          };
        },
      );
    }
    return this.itemsHelperInstance;
  }

  // ---------- reads ----------

  getItems(categoryId: string): AppsLauncherItem[] {
    return this.itemsByCategoryId.value[categoryId] || [];
  }

  getItemById(categoryId: string, itemId: string): AppsLauncherItem | null {
    return this.getItems(categoryId).find((x) => x.id === itemId) || null;
  }

  findItemAnywhere(itemId: string): { categoryId: string; item: AppsLauncherItem } | null {
    for (const [categoryId, list] of Object.entries(this.itemsByCategoryId.value)) {
      const item = list.find((x) => x.id === itemId);
      if (item) return { categoryId, item };
    }
    return null;
  }

  getCategoryById(categoryId: string): AppsCategory | null {
    return this.categories.value.find((c) => c.id === categoryId) || null;
  }

  isPinned(itemId: string): boolean {
    return this.pinnedItemIds.value.includes(itemId);
  }

  createItemId(): string {
    return createAppsItemId();
  }

  /** Optional cheap local name/path match (not a Rust index replacement). */
  searchLocal(query: string, limit = 20): Array<{
    categoryId: string;
    categoryName: string;
    item: AppsLauncherItem;
  }> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Array<{
      categoryId: string;
      categoryName: string;
      item: AppsLauncherItem;
    }> = [];
    for (const [categoryId, list] of Object.entries(this.itemsByCategoryId.value)) {
      const categoryName = this.getCategoryById(categoryId)?.name ?? "";
      for (const item of list) {
        const hay = `${item.name} ${item.path} ${item.url ?? ""}`.toLowerCase();
        if (hay.includes(q)) {
          out.push({ categoryId, categoryName, item });
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }

  // ---------- IPC: load / save (unified backend write entry) ----------

  /** `get_launcher_data` without applying refs (export/snapshot). */
  async readBackend(): Promise<InvokeResult<PersistedAppsLauncherData>> {
    return this.ctx.ipc.invoke<PersistedAppsLauncherData>("get_launcher_data");
  }

  /** `get_launcher_data` → apply into shared refs. */
  async load(): Promise<InvokeResult<PersistedAppsLauncherData>> {
    this.loading.value = true;
    try {
      const result = await this.readBackend();
      if (result.ok) {
        this.applyPersisted(result.value);
        this.hydrated.value = true;
      }
      this.lastError.value = result.ok ? null : result.error;
      this.loading.value = false;
      return result;
    } catch (e) {
      this.loading.value = false;
      throw e;
    }
  }

  /** `save_launcher_data` from current refs. */
  async save(): Promise<InvokeResult<void>> {
    this.loading.value = true;
    try {
      const data = this.buildPersisted();
      const result = await this.ctx.ipc.invoke<void>("save_launcher_data", {
        data,
      });
      this.lastError.value = result.ok ? null : result.error;
      this.loading.value = false;
      return result;
    } catch (e) {
      this.loading.value = false;
      throw e;
    }
  }

  /** Save an externally built payload (import/rollback snapshots). */
  async savePersisted(
    data: PersistedAppsLauncherData,
  ): Promise<InvokeResult<void>> {
    this.loading.value = true;
    try {
      const result = await this.ctx.ipc.invoke<void>("save_launcher_data", {
        data,
      });
      this.lastError.value = result.ok ? null : result.error;
      this.loading.value = false;
      return result;
    } catch (e) {
      this.loading.value = false;
      throw e;
    }
  }

  /** Build backend-compatible JSON from current domain refs. */
  buildPersisted(): PersistedAppsLauncherData {
    const itemIds = new Set<string>();
    const itemRefs = new Set<string>();
    for (const [categoryId, items] of Object.entries(this.itemsByCategoryId.value)) {
      for (const item of items) {
        itemIds.add(item.id);
        itemRefs.add(`${categoryId}:${item.id}`);
      }
    }

    return {
      version: "1.0",
      categories: this.categories.value.map((category) => ({
        id: category.id,
        name: category.name,
        custom_icon_base64: category.customIconBase64,
        items: (this.itemsByCategoryId.value[category.id] || []).map(
          toPersistedItem,
        ),
      })),
      favorite_item_ids: this.pinnedItemIds.value.filter((id) => itemIds.has(id)),
      recent_used_items: this.recentUsedItems.value
        .filter((r) => itemRefs.has(`${r.categoryId}:${r.itemId}`))
        .map((r) => ({
          category_id: r.categoryId,
          item_id: r.itemId,
          used_at: r.usedAt,
          usage_count: r.usageCount,
        })),
    };
  }

  /**
   * Apply persisted payload into refs (no IPC). Does not emit per-item
   * events by default (bulk replace); set `emitEvents` when consumers need them.
   */
  applyPersisted(
    data: PersistedAppsLauncherData,
    options: { emitEvents?: boolean } = {},
  ): void {
    const categories = (data.categories || [])
      .filter((c) => c && c.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        customIconBase64: c.custom_icon_base64 ?? null,
      }));
    if (categories.length > 0) {
      this.categories.value = categories;
    }

    const nextItems: Record<string, AppsLauncherItem[]> = {};
    for (const category of data.categories || []) {
      if (!category?.id) continue;
      nextItems[category.id] = (category.items || []).map(mapPersistedItem);
    }
    this.itemsByCategoryId.value = nextItems;

    const validIds = new Set(
      Object.values(nextItems).flatMap((items) => items.map((i) => i.id)),
    );
    this.pinnedItemIds.value = [
      ...new Set((data.favorite_item_ids || []).filter((id) => validIds.has(id))),
    ];
    this.recentUsedItems.value = (data.recent_used_items || [])
      .filter((r) => validIds.has(r.item_id) && r.category_id && r.item_id)
      .map((r) => ({
        categoryId: r.category_id,
        itemId: r.item_id,
        usedAt: r.used_at,
        usageCount: Math.max(1, Math.floor(r.usage_count ?? 1)),
      }));

    if (options.emitEvents) {
      for (const [categoryId, items] of Object.entries(nextItems)) {
        for (const item of items) {
          itemEventBus.emit({ type: "item:created", categoryId, item });
        }
      }
    }
  }

  /** Replace items map (import / snapshot restore). Optional events. */
  importItems(
    items: Record<string, AppsLauncherItem[]>,
    options: {
      pinnedItemIds?: string[];
      recentUsedItems?: AppsRecentUsedItem[];
      emitEvents?: boolean;
    } = {},
  ): void {
    const state = this.opsState();
    opsImportItems(state, items as unknown as Record<string, DomainLauncherItem[]>, {
      emitEvents: options.emitEvents,
    });
    if (options.pinnedItemIds) {
      this.pinnedItemIds.value = [...new Set(options.pinnedItemIds)];
    }
    if (options.recentUsedItems) {
      this.recentUsedItems.value = [...options.recentUsedItems];
    }
  }

  importSnapshot(
    snapshot: DomainImportSnapshotPayload,
    options: {
      emitEvents?: boolean;
      onFilterScenarios?: (validItemIds: Set<string>) => void;
      clearLaunchHistory?: () => void;
    } = {},
  ): void {
    opsImportSnapshot(this.opsState(), snapshot, options);
  }

  // ---------- domain writes (canonical API → shared ops*) ----------

  setItemsByCategoryId(categoryId: string, items: AppsLauncherItem[]): void {
    this.itemsByCategoryId.value = {
      ...this.itemsByCategoryId.value,
      [categoryId]: items,
    };
  }

  /** Create or update one item. Returns item id. Emits item:created/updated. */
  upsertItem(categoryId: string, payload: AppsUpsertItemPayload): string {
    return opsUpsertItem(this.opsState(), categoryId, payload as never);
  }

  updateItem(categoryId: string, itemId: string, patch: AppsItemPatch): void {
    opsUpdateItem(this.opsState(), categoryId, itemId, patch as DomainItemPatch);
  }

  updateItems(
    categoryId: string,
    itemIds: string[],
    patch: Partial<Pick<AppsLauncherItem, "launchDelaySeconds">>,
  ): void {
    opsUpdateItems(this.opsState(), categoryId, itemIds, patch);
  }

  removeItem(categoryId: string, itemId: string): void {
    opsRemoveItem(this.opsState(), categoryId, itemId);
  }

  removeItems(categoryId: string, itemIds: string[]): void {
    opsRemoveItems(this.opsState(), categoryId, itemIds);
  }

  moveItems(
    sourceCategoryId: string,
    targetCategoryId: string,
    itemIds: string[],
  ): void {
    opsMoveItems(this.opsState(), sourceCategoryId, targetCategoryId, itemIds);
  }

  addFileItems(categoryId: string, payload: DomainAddPathsPayload): string[] {
    return opsAddFileItems(this.opsState(), categoryId, payload);
  }

  async addFileItemsBatched(
    categoryId: string,
    payload: DomainAddPathsPayload,
    batchSize?: number,
  ): Promise<string[]> {
    return opsAddFileItemsBatched(this.opsState(), categoryId, payload, batchSize);
  }

  addUrlItem(
    categoryId: string,
    payload: { name: string; url: string; icon_base64?: string | null },
  ): string {
    return opsAddUrlItem(this.opsState(), categoryId, payload);
  }

  createItemInCategory(categoryId: string, payload: DomainCreateItemPayload): string {
    return opsCreateItemInCategory(this.opsState(), categoryId, payload);
  }

  applyDropIcons(
    categoryId: string,
    paths: string[],
    iconBase64s: Array<string | null>,
  ): void {
    opsApplyDropIcons(this.opsState(), categoryId, paths, iconBase64s);
  }

  updateItemIcon(categoryId: string, itemId: string, iconBase64: string): void {
    opsUpdateItemIcon(this.opsState(), "derived", categoryId, itemId, iconBase64);
  }

  setItemIcon(categoryId: string, itemId: string, iconBase64: string): void {
    opsUpdateItemIcon(this.opsState(), "custom", categoryId, itemId, iconBase64);
  }

  resetItemIcon(categoryId: string, itemId: string): void {
    opsResetItemIcon(this.opsState(), categoryId, itemId);
  }

  setItemResolvedPath(
    categoryId: string,
    itemId: string,
    resolvedPath: string | null | undefined,
  ): boolean {
    return opsSetItemResolvedPath(this.opsState(), categoryId, itemId, resolvedPath);
  }

  queueResolveLnkTargets(
    categoryId: string,
    targets: DomainLnkTarget[],
  ): void {
    opsQueueResolveLnkTargets(this.opsState(), categoryId, targets);
  }

  async hydrateIconsForVisibleItems(
    targets: LauncherItemRef[],
    options: { maxEdge?: number } = {},
  ): Promise<void> {
    const forcedTargets = consumePendingDerivedIconRefresh(targets);
    if (forcedTargets.length > 0) {
      await this.itemsHelper.hydrateMissingIconsForItems(forcedTargets, {
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
      await this.itemsHelper.hydrateMissingIconsForItems(normalTargets, {
        maxEdge: options.maxEdge,
      });
    }
  }

  deleteCategoryCleanup(categoryId: string): void {
    opsDeleteCategoryCleanup(this.opsState(), categoryId);
  }

  ensureCategoryByName(name: string): string {
    const existing = this.categories.value.find((c) => c.name === name);
    if (existing) return existing.id;
    const id = `cat-${crypto.randomUUID()}`;
    this.categories.value = [
      ...this.categories.value,
      { id, name, customIconBase64: null },
    ];
    return id;
  }

  /** Classification + insert. Creates category by name when missing. */
  addScannedApp(scannedApp: ScannedAppInput): string {
    const plan = buildScannedAppInsertPlan(scannedApp);
    const categoryId = this.ensureCategoryByName(plan.categoryName);
    return opsAddScannedApp(this.opsState(), categoryId, plan as never);
  }

  /** No-category-store fallback path (shared ops create). */
  addScannedAppWithCategoryId(categoryId: string, scannedApp: ScannedAppInput): string {
    const plan = buildScannedAppInsertPlan(scannedApp);
    return opsAddScannedAppFallback(this.opsState(), categoryId, plan as never);
  }

  /**
   * Toggle pin (favorite id list). Emits `item:pinningToggled`.
   * categoryId is carried for event consumers; pin state is global by item id.
   */
  togglePin(categoryId: string, itemId: string): boolean {
    const item = this.getItemById(categoryId, itemId) ?? this.findItemAnywhere(itemId)?.item;
    if (!item) return false;
    const isPinned = this.pinnedItemIds.value.includes(itemId);
    if (isPinned) {
      this.pinnedItemIds.value = this.pinnedItemIds.value.filter(
        (id) => id !== itemId,
      );
    } else {
      this.pinnedItemIds.value = [...this.pinnedItemIds.value, itemId];
    }
    itemEventBus.emit({
      type: "item:pinningToggled",
      categoryId,
      itemId,
      isPinned: !isPinned,
    });
    return !isPinned;
  }

  /** Record usage into recent list + emit `item:usageRecorded`. */
  recordUsage(categoryId: string, itemId: string, usedAtOverride?: number): void {
    const now = Number.isFinite(usedAtOverride)
      ? Math.floor(usedAtOverride as number)
      : Date.now();
    const existingIndex = this.recentUsedItems.value.findIndex(
      (r) => r.categoryId === categoryId && r.itemId === itemId,
    );
    if (existingIndex !== -1) {
      const existing = this.recentUsedItems.value[existingIndex];
      const rest = this.recentUsedItems.value.filter(
        (_, i) => i !== existingIndex,
      );
      this.recentUsedItems.value = [
        {
          categoryId,
          itemId,
          usedAt: now,
          usageCount: existing.usageCount + 1,
        },
        ...rest,
      ];
    } else {
      this.recentUsedItems.value = [
        { categoryId, itemId, usedAt: now, usageCount: 1 },
        ...this.recentUsedItems.value,
      ];
    }
    if (this.recentUsedItems.value.length > 50) {
      this.recentUsedItems.value = this.recentUsedItems.value.slice(0, 50);
    }
    const record = this.recentUsedItems.value[0];
    itemEventBus.emit({
      type: "item:usageRecorded",
      categoryId,
      itemId,
      usageCount: record?.usageCount ?? 1,
      lastUsedAt: now,
    });
  }

  clearRecentUsed(): void {
    this.recentUsedItems.value = [];
  }

  /**
   * Unified launch write entry.
   * Wraps `launchStoredItem` (executor + system opener) with service state
   * lookups — no pinia import.
   */
  async launch(
    ref: LauncherItemRef,
    options: Omit<LaunchStoredItemOptions, "store" | "getItem" | "onRecordUsage"> = {},
  ): Promise<ExecuteLauncherItemResult> {
    return launchStoredItem(ref, {
      ...options,
      getItem: (categoryId, itemId) =>
        this.getItemById(categoryId, itemId) as ExecutableLauncherItem | null,
      onRecordUsage: (categoryId, itemId) => {
        this.recordUsage(categoryId, itemId);
      },
    });
  }

  /** Launch by item id only (searches all categories). */
  async launchById(
    itemId: string,
    options: Omit<LaunchStoredItemOptions, "store" | "getItem" | "onRecordUsage"> = {},
  ): Promise<ExecuteLauncherItemResult | null> {
    const found = this.findItemAnywhere(itemId);
    if (!found) return null;
    return this.launch(
      { categoryId: found.categoryId, itemId: found.item.id },
      options,
    );
  }

  formatError(error: AppError | null | undefined): string {
    if (!error) return "";
    return `[${error.code}] ${error.message}`;
  }
}
