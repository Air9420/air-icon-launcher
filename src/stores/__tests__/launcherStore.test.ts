import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLauncherStore } from "../launcherStore";
import { createPinia, setActivePinia } from "pinia";
import * as invokeWrapper from "../../utils/invoke-wrapper";

function createStore() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return useLauncherStore();
}

describe("launcherStore - pure functions", () => {
  let store: ReturnType<typeof useLauncherStore>;

  beforeEach(() => {
    vi.restoreAllMocks();
    store = createStore();
  });

  describe("getNameFromPath", () => {
    it("strips .lnk extension", () => {
      expect(store.getNameFromPath("C:\\Shortcut.lnk")).toBe("Shortcut");
    });

    it("strips .exe extension", () => {
      expect(store.getNameFromPath("C:\\app.exe")).toBe("app");
    });

    it("returns basename for no known extension", () => {
      expect(store.getNameFromPath("C:\\data\\file.txt")).toBe("file.txt");
    });

    it("handles forward slashes", () => {
      expect(store.getNameFromPath("C:/Program/App.exe")).toBe("App");
    });

    it("returns original if no directory separators", () => {
      expect(store.getNameFromPath("plain.exe")).toBe("plain");
    });
  });

  describe("createLauncherItemId", () => {
    it("generates unique IDs", () => {
      const id1 = store.createLauncherItemId();
      const id2 = store.createLauncherItemId();
      expect(id1).not.toBe(id2);
    });

    it("ID starts with 'item-' prefix", () => {
      const id = store.createLauncherItemId();
      expect(id.startsWith("item-")).toBe(true);
    });
  });

  describe("CRUD operations", () => {
    it("addLauncherItemsToCategory adds items", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe("a");
    });

    it("addLauncherItemsToCategory marks directories correctly", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\folder", "C:\\app.exe"],
        directories: ["C:\\folder"],
        icon_base64s: [null, null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      expect(items[0].isDirectory).toBe(true);
      expect(items[1].isDirectory).toBe(false);
    });

    it("deleteLauncherItem removes item", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe", "C:\\b.exe"],
        directories: [],
        icon_base64s: [null, null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.deleteLauncherItem("cat-1", items[0].id);
      expect(store.getLauncherItemsByCategoryId("cat-1")).toHaveLength(1);
    });

    it("deleteLauncherItem also cleans up pinned and recent", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.togglePinned("cat-1", items[0].id);
      store.recordItemUsage("cat-1", items[0].id);

      store.deleteLauncherItem("cat-1", items[0].id);

      expect(store.isItemPinned(items[0].id)).toBe(false);
      expect(store.recentUsedItems).toHaveLength(0);
    });

    it("deleteLauncherItem removes dependency references from other items", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe", "C:\\b.exe"],
        directories: [],
        icon_base64s: [null, null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.updateLauncherItem("cat-1", items[1].id, {
        launchDependencies: [
          {
            categoryId: "cat-1",
            itemId: items[0].id,
            delayAfterSeconds: 3,
          },
        ],
      });

      store.deleteLauncherItem("cat-1", items[0].id);

      expect(
        store.getLauncherItemById("cat-1", items[1].id)?.launchDependencies
      ).toEqual([]);
    });

    it("updateLauncherItem patches name", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.updateLauncherItem("cat-1", items[0].id, { name: "Renamed" });
      const updated = store.getLauncherItemsByCategoryId("cat-1");
      expect(updated[0].name).toBe("Renamed");
    });

    it("updateLauncherItem does nothing for nonexistent id", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      store.updateLauncherItem("cat-1", "nonexistent", { name: "X" });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      expect(items[0].name).toBe("a");
    });
  });

  describe("togglePinned / isItemPinned", () => {
    it("toggles pin state", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");

      expect(store.isItemPinned(items[0].id)).toBe(false);
      store.togglePinned("cat-1", items[0].id);
      expect(store.isItemPinned(items[0].id)).toBe(true);
      store.togglePinned("cat-1", items[0].id);
      expect(store.isItemPinned(items[0].id)).toBe(false);
    });

    it("togglePinned does nothing for nonexistent item", () => {
      const before = [...store.pinnedItemIds];
      store.togglePinned("cat-x", "nonexistent");
      expect(store.pinnedItemIds).toEqual(before);
    });
  });

  describe("recordItemUsage", () => {
    it("records first usage", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.recordItemUsage("cat-1", items[0].id);

      expect(store.recentUsedItems).toHaveLength(1);
      expect(store.recentUsedItems[0].usageCount).toBe(1);
    });

    it("increments usage count on repeat", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.recordItemUsage("cat-1", items[0].id);
      store.recordItemUsage("cat-1", items[0].id);

      expect(store.recentUsedItems).toHaveLength(1);
      expect(store.recentUsedItems[0].usageCount).toBe(2);
    });

    it("moves item to front on reuse", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe", "C:\\b.exe"],
        directories: [],
        icon_base64s: [null, null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.recordItemUsage("cat-1", items[0].id);
      store.recordItemUsage("cat-1", items[1].id);
      store.recordItemUsage("cat-1", items[0].id);

      expect(store.recentUsedItems[0].itemId).toBe(items[0].id);
    });

    it("limits recent used to 50 entries", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: Array.from({ length: 60 }, (_, i) => `C:\\app${i}.exe`),
        directories: [],
        icon_base64s: Array(60).fill(null),
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      for (const item of items) {
        store.recordItemUsage("cat-1", item.id);
      }
      expect(store.recentUsedItems.length).toBe(50);
    });
  });

  describe("clearRecentUsed", () => {
    it("clears all recent items", () => {
      store.recentUsedItems = [
        { categoryId: "c1", itemId: "i1", usedAt: 1, usageCount: 1 },
      ];
      store.clearRecentUsed();
      expect(store.recentUsedItems).toHaveLength(0);
    });
  });

  describe("setLauncherItemIcon / resetLauncherItemIcon / hasCustomIcon", () => {
    it("sets custom icon", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: ["original-icon"],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.setLauncherItemIcon("cat-1", items[0].id, "custom-icon");
      expect(store.getLauncherItemsByCategoryId("cat-1")[0].iconBase64).toBe("custom-icon");
    });

    it("resets icon to original", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: ["original-icon"],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.setLauncherItemIcon("cat-1", items[0].id, "custom-icon");
      store.resetLauncherItemIcon("cat-1", items[0].id);
      expect(store.getLauncherItemsByCategoryId("cat-1")[0].iconBase64).toBe("original-icon");
    });

    it("hasCustomIcon detects difference", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: ["orig"],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      expect(store.hasCustomIcon("cat-1", items[0].id)).toBe(false);
      store.setLauncherItemIcon("cat-1", items[0].id, "custom");
      expect(store.hasCustomIcon("cat-1", items[0].id)).toBe(true);
    });
  });

  describe("hydrateMissingIconsForItems", () => {
    it("hydrates missing file icons in batch", async () => {
      const invokeSpy = vi
        .spyOn(invokeWrapper, "invoke")
        .mockResolvedValue({
          ok: true,
          value: ["icon-a", "icon-b"],
        } as Awaited<ReturnType<typeof invokeWrapper.invoke>>);

      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe", "C:\\b.exe"],
        directories: [],
        icon_base64s: [null, null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");

      await store.hydrateMissingIconsForItems([
        { categoryId: "cat-1", itemId: items[0].id },
        { categoryId: "cat-1", itemId: items[1].id },
      ]);

      const hydrated = store.getLauncherItemsByCategoryId("cat-1");
      expect(hydrated[0].iconBase64).toBe("icon-a");
      expect(hydrated[0].originalIconBase64).toBe("icon-a");
      expect(hydrated[1].iconBase64).toBe("icon-b");
      expect(hydrated[1].originalIconBase64).toBe("icon-b");
      expect(invokeSpy).toHaveBeenCalledTimes(1);
    });

    it("skips hydration when icon already exists", async () => {
      const invokeSpy = vi
        .spyOn(invokeWrapper, "invoke")
        .mockResolvedValue({
          ok: true,
          value: ["hydrated-icon"],
        } as Awaited<ReturnType<typeof invokeWrapper.invoke>>);

      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: ["original-icon"],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.setLauncherItemIcon("cat-1", items[0].id, "custom-icon");

      await store.hydrateMissingIconsForItems([
        { categoryId: "cat-1", itemId: items[0].id },
      ]);

      const after = store.getLauncherItemsByCategoryId("cat-1")[0];
      expect(after.iconBase64).toBe("custom-icon");
      expect(after.originalIconBase64).toBe("original-icon");
      expect(invokeSpy).not.toHaveBeenCalled();
    });
  });

  describe("deleteCategoryCleanup", () => {
    it("removes category data and cleans up references", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.togglePinned("cat-1", items[0].id);
      store.recordItemUsage("cat-1", items[0].id);

      store.deleteCategoryCleanup("cat-1");

      expect(store.launcherItemsByCategoryId["cat-1"]).toBeUndefined();
      expect(store.pinnedItemIds).toHaveLength(0);
      expect(store.recentUsedItems).toHaveLength(0);
    });

    it("removes dependencies pointing to deleted category items", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      store.addLauncherItemsToCategory("cat-2", {
        paths: ["C:\\b.exe"],
        directories: [],
        icon_base64s: [null],
      });

      const sourceItem = store.getLauncherItemsByCategoryId("cat-1")[0];
      const dependentItem = store.getLauncherItemsByCategoryId("cat-2")[0];

      store.updateLauncherItem("cat-2", dependentItem.id, {
        launchDependencies: [
          {
            categoryId: "cat-1",
            itemId: sourceItem.id,
            delayAfterSeconds: 5,
          },
        ],
      });

      store.deleteCategoryCleanup("cat-1");

      expect(
        store.getLauncherItemById("cat-2", dependentItem.id)?.launchDependencies
      ).toEqual([]);
    });
  });
});
