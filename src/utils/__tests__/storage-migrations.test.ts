import { describe, expect, it } from "vitest";
import "../storage-migrations";
import { migrateData } from "../storage-migrate";

describe("storage-migrations", () => {
  it("migrates launcher store data from v3 to v4 with dependency defaults", () => {
    const migrated = migrateData<Record<string, unknown>>("launcher", {
      version: 3,
      data: {
        launcherItemsByCategoryId: {
          "cat-1": [
            {
              id: "item-1",
              name: "Telegram",
              path: "C:\\Telegram.exe",
              itemType: "file",
              isDirectory: false,
              iconBase64: null,
              hasCustomIcon: false,
            },
          ],
        },
        pinnedItemIds: [],
        recentUsedItems: [],
      },
    });

    const items = (
      migrated.data.launcherItemsByCategoryId as Record<string, Array<Record<string, unknown>>>
    )["cat-1"];

    expect(migrated.version).toBe(4);
    expect(items[0].launchDependencies).toEqual([]);
    expect(items[0].launchDelaySeconds).toBe(0);
  });

  it("migrates stats store data from v2 to v4 with launch tracking defaults", () => {
    const migrated = migrateData<Record<string, unknown>>("stats", {
      version: 2,
      data: {
        searchHistory: [
          {
            keyword: "vscode",
            count: 2,
            lastUsedAt: 123,
          },
        ],
      },
    });

    expect(migrated.version).toBe(4);
    expect(migrated.data.searchHistory).toHaveLength(1);
    expect(migrated.data.launchEvents).toEqual([]);
    expect(migrated.data.launchTrackingStartedAt).toBeNull();
    expect(migrated.data.legacyUsageSnapshot).toEqual([]);
    expect(migrated.data.lifetimeLaunchCounts).toEqual({});
  });

  it("seeds lifetimeLaunchCounts from existing events and legacy snapshot on v3 to v4", () => {
    const migrated = migrateData<Record<string, unknown>>("stats", {
      version: 3,
      data: {
        launchEvents: [
          { categoryId: "cat-1", itemId: "item-1", usedAt: 1 },
          { categoryId: "cat-1", itemId: "item-1", usedAt: 2 },
          { categoryId: "cat-1", itemId: "item-2", usedAt: 3 },
        ],
        legacyUsageSnapshot: [
          { categoryId: "cat-1", itemId: "item-1", usedAt: 1, usageCount: 5 },
        ],
        launchTrackingStartedAt: 1,
      },
    });

    expect(migrated.version).toBe(4);
    expect(migrated.data.lifetimeLaunchCounts).toEqual({
      "cat-1:item-1": 7,
      "cat-1:item-2": 1,
    });

    // 时段分布同步初始化，且各时段次数之和等于总次数。
    const slots = migrated.data.lifetimeTimeSlotCounts as Record<
      string,
      Record<string, number>
    >;
    for (const [key, entry] of Object.entries(slots)) {
      const sum = entry.morning + entry.afternoon + entry.evening + entry.night;
      expect(sum).toBe((migrated.data.lifetimeLaunchCounts as Record<string, number>)[key]);
    }
  });
});
