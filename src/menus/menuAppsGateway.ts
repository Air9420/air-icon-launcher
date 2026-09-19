/**
 * @fileoverview P6 menu domain gateway — 菜单动作统一走 AppsService
 *
 * 写规则：
 * - 领域真相（条目 CRUD / pin / usage / launch）优先 `ctx.apps`（经 kernel access）。
 * - stats / 场景成员由 kernel `stats-event-sync` 订阅 `itemEventBus`（cleanup 波）。
 *   kernel 缺席（单测 / pre-kernel）时回退 launcherStore（store 内仍自带 stats 清理）。
 * - lnk resolve / 图标组合路径仍走 launcherStore，禁止在菜单层复制。
 * - 菜单**禁止**直接改 `itemsByCategoryId` 等内部 map。
 */

import { getKernelContext } from "../kernel/context-access";
import type { AppsService } from "../kernel/services/apps-service";
import { getNameFromPath } from "../composables/useItemsHelper";
import type { useLauncherStore } from "../stores/launcherStore";
import type { useStatsStore } from "../stores/statsStore";

type LauncherStoreApi = ReturnType<typeof useLauncherStore>;
type StatsStoreApi = ReturnType<typeof useStatsStore>;

export function getAppsService(): AppsService | undefined {
  return getKernelContext()?.apps;
}

export type MenuFileItemsPayload = {
  paths: string[];
  directories: string[];
  icon_base64s: Array<string | null>;
  itemTypes?: Array<"file" | "url">;
};

export type MenuUrlItemPayload = {
  name: string;
  url: string;
  icon_base64?: string | null;
};

/**
 * 读条目列表：AppsService 优先，回退 store。
 */
export function menuGetItems(
  store: LauncherStoreApi,
  categoryId: string,
): Array<{ id: string; itemType: string; path: string; url?: string }> {
  const apps = getAppsService();
  if (apps) return apps.getItems(categoryId) as never;
  return store.getLauncherItemsByCategoryId(categoryId) as never;
}

/**
 * 固定 / 取消固定。AppsService 拥有 pinnedItemIds 真相。
 */
export function menuTogglePin(
  store: LauncherStoreApi,
  categoryId: string,
  itemId: string,
): void {
  const apps = getAppsService();
  if (apps) {
    apps.togglePin(categoryId, itemId);
    return;
  }
  store.togglePinned(categoryId, itemId);
}

/**
 * 删除单条启动项。
 * 领域写走 `apps.removeItem`；stats / 场景由 kernel `stats-event-sync`
 * 订阅 `item:deleted`，此处不再 residual（避免双记）。
 */
export function menuRemoveItem(
  store: LauncherStoreApi,
  _stats: StatsStoreApi,
  categoryId: string,
  itemId: string,
): void {
  const apps = getAppsService();
  if (apps) {
    apps.removeItem(categoryId, itemId);
    return;
  }
  store.deleteLauncherItem(categoryId, itemId);
}

/**
 * 删除分类下全部条目（类目列表删除仍由 categoryStore 负责）。
 * kernel 在场时 AppsService.deleteCategoryCleanup 会为每条 emit `item:deleted`。
 */
export function menuDeleteCategoryItems(
  store: LauncherStoreApi,
  _stats: StatsStoreApi,
  categoryId: string,
): void {
  const apps = getAppsService();
  if (apps) {
    apps.deleteCategoryCleanup(categoryId);
    return;
  }
  store.deleteCategoryCleanup(categoryId);
}

/**
 * 批量添加文件类启动项。
 *
 * 领域真相在 AppsService 共享 ref；add 路径仍经 launcherStore 组合 API，
 * 因为 lnk resolve 队列 / 原始图标缓存尚未下沉到 AppsService（P6 不复制该逻辑）。
 * kernel 在场时 store 写入的是与 `ctx.apps.itemsByCategoryId` 同一 ref。
 */
export function menuAddFileItems(
  store: LauncherStoreApi,
  categoryId: string,
  payload: MenuFileItemsPayload,
): string[] {
  return store.addLauncherItemsToCategory(categoryId, payload);
}

/**
 * 添加网址启动项。域名写优先 `apps.upsertItem`。
 * favicon 异步刷新仍由调用方经 invoke-wrapper / store 图标 API 完成。
 */
export function menuAddUrlItem(
  store: LauncherStoreApi,
  categoryId: string,
  payload: MenuUrlItemPayload,
): string {
  const apps = getAppsService();
  if (apps) {
    return apps.upsertItem(categoryId, {
      name: payload.name,
      url: payload.url,
      itemType: "url",
      iconBase64: payload.icon_base64 ?? null,
      hasCustomIcon: payload.icon_base64 != null,
    });
  }
  return store.addUrlLauncherItemToCategory(categoryId, payload);
}

/**
 * 设置自定义图标（hasCustomIcon=true）。
 */
export function menuSetItemIcon(
  store: LauncherStoreApi,
  categoryId: string,
  itemId: string,
  iconBase64: string,
): void {
  const apps = getAppsService();
  if (apps) {
    apps.updateItem(categoryId, itemId, {
      iconBase64,
      hasCustomIcon: true,
    });
    return;
  }
  store.setLauncherItemIcon(categoryId, itemId, iconBase64);
}

/**
 * 更新图标（派生 / favicon，hasCustomIcon=false）。
 */
export function menuUpdateItemIcon(
  store: LauncherStoreApi,
  categoryId: string,
  itemId: string,
  iconBase64: string,
): void {
  const apps = getAppsService();
  if (apps) {
    apps.updateItem(categoryId, itemId, {
      iconBase64,
      hasCustomIcon: false,
    });
    return;
  }
  store.updateLauncherItemIcon(categoryId, itemId, iconBase64);
}

/**
 * 重置图标：图标缓存 + hydrate 仍在 store 组合路径（不在菜单层复制）。
 */
export function menuResetItemIcon(
  store: LauncherStoreApi,
  categoryId: string,
  itemId: string,
): void {
  store.resetLauncherItemIcon(categoryId, itemId);
}

/**
 * 记录使用。领域 recent 列表走 apps；stats 由 `stats-event-sync`
 * 订阅 `item:usageRecorded`。
 */
export function menuRecordUsage(
  store: LauncherStoreApi,
  _stats: StatsStoreApi,
  categoryId: string,
  itemId: string,
  usedAtOverride?: number,
): void {
  const apps = getAppsService();
  if (apps) {
    apps.recordUsage(categoryId, itemId, usedAtOverride);
    return;
  }
  store.recordItemUsage(categoryId, itemId, usedAtOverride);
}

/**
 * 供 convert-external 等路径推导展示名（不在菜单内联实现）。
 */
export function menuNameFromPath(path: string): string {
  return getNameFromPath(path);
}
