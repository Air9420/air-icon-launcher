import type { Context, Plugin } from "cordis";
import { itemEventBus } from "../../events/itemEvents";
import { useStatsStore } from "../../stores/statsStore";
import { useLauncherStore } from "../../stores/launcherStore";

/**
 * stats-event-sync: stats / scenario side effects subscribe to `itemEventBus`.
 *
 * Domain writes stay on ctx.apps; this plugin only observes.
 * After store slim, launcherStore no longer double-calls stats/scenario cleanup
 * when kernel is present — this plugin is the single observer.
 */
export const statsEventSyncPlugin: Plugin.Object<void> = {
  name: "stats-event-sync",
  inject: ["apps"],
  apply(ctx: Context) {
    const stats = useStatsStore();
    const launcherStore = useLauncherStore();
    const apps = ctx.apps!;

    const offDeleted = itemEventBus.on("item:deleted", (e) => {
      stats.removeLaunchEventsForItems(e.categoryId, [e.itemId]);
      launcherStore.removeItemFromAllScenarios(e.itemId);
    });

    const offMoved = itemEventBus.on("item:moved", (e) => {
      stats.remapLaunchEventCategoryRefs(
        e.itemIds.map((itemId) => ({
          fromCategoryId: e.fromCategoryId,
          toCategoryId: e.toCategoryId,
          itemId,
        })),
      );
    });

    const offUsage = itemEventBus.on("item:usageRecorded", (e) => {
      stats.ensureLaunchTrackingStarted(
        apps.recentUsedItems.value as unknown as Array<{
          categoryId: string;
          itemId: string;
          usedAt: number;
          usageCount: number;
        }>,
        e.lastUsedAt,
      );
      stats.recordLaunchEvent({
        categoryId: e.categoryId,
        itemId: e.itemId,
        usedAt: e.lastUsedAt,
      });
    });

    return () => {
      offDeleted();
      offMoved();
      offUsage();
    };
  },
};
