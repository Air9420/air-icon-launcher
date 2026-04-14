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
              originalIconBase64: null,
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
});
