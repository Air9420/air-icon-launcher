import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLauncherStore } from "../launcherStore";
import { useStatsStore } from "../statsStore";
import { createPinia, setActivePinia } from "pinia";
import * as invokeWrapper from "../../utils/invoke-wrapper";
import { SEARCH_REQUEST_TIMEOUT_MS } from "../../utils/search-config";
import {
  clearLauncherIconCacheForTests,
  getCachedLauncherIcon,
  setCachedLauncherIcon,
} from "../../utils/launcher-icon-cache";

function createStore() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return useLauncherStore();
}

describe("launcherStore - pure functions", () => {
  let store: ReturnType<typeof useLauncherStore>;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearLauncherIconCacheForTests();
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

  describe("search state", () => {
    it("clearSearch also clears shared rust search results", () => {
      store.searchKeyword = "vscode";
      store.setRustSearchResults([
        {
          id: "item-1",
          name: "VSCode",
          path: "C:\\VSCode.exe",
          category_id: "cat-1",
          match_type: "prefix",
          fuzzy_score: 100,
          matched_pinyin_initial: false,
          matched_pinyin_full: false,
          rank_score: 1,
        },
      ]);

      store.clearSearch();

      expect(store.searchKeyword).toBe("");
      expect(store.rustSearchResults).toEqual([]);
    });

    it("searchLauncherItems returns empty when rust invoke times out", async () => {
      vi.useFakeTimers();
      try {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(invokeWrapper, "invoke").mockImplementation(
          () => new Promise(() => {}) as any
        );

        const pending = store.searchLauncherItems({ keyword: "lx" });
        await vi.advanceTimersByTimeAsync(SEARCH_REQUEST_TIMEOUT_MS);
        const results = await pending;

        expect(results).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
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
      const stats = useStatsStore();
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.togglePinned("cat-1", items[0].id);
      store.recordItemUsage("cat-1", items[0].id);
      expect(stats.totalLaunchesAllTime).toBe(1);

      store.deleteLauncherItem("cat-1", items[0].id);

      expect(store.isItemPinned(items[0].id)).toBe(false);
      expect(store.recentUsedItems).toHaveLength(0);
      expect(stats.totalLaunchesAllTime).toBe(0);
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

    it("deleteLauncherItems removes multiple items and their references", () => {
      const stats = useStatsStore();
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe", "C:\\b.exe", "C:\\c.exe"],
        directories: [],
        icon_base64s: [null, null, null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.togglePinned("cat-1", items[0].id);
      store.recordItemUsage("cat-1", items[1].id);
      expect(stats.totalLaunchesAllTime).toBe(1);
      store.updateLauncherItem("cat-1", items[2].id, {
        launchDependencies: [
          {
            categoryId: "cat-1",
            itemId: items[0].id,
            delayAfterSeconds: 1,
          },
          {
            categoryId: "cat-1",
            itemId: items[1].id,
            delayAfterSeconds: 2,
          },
        ],
      });

      store.deleteLauncherItems("cat-1", [items[0].id, items[1].id]);

      expect(store.getLauncherItemsByCategoryId("cat-1")).toHaveLength(1);
      expect(store.isItemPinned(items[0].id)).toBe(false);
      expect(store.recentUsedItems).toHaveLength(0);
      expect(stats.totalLaunchesAllTime).toBe(0);
      expect(
        store.getLauncherItemById("cat-1", items[2].id)?.launchDependencies
      ).toEqual([]);
    });

    it("deleteLauncherItems also cleans up scenario item ids", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe", "C:\\b.exe", "C:\\c.exe"],
        directories: [],
        icon_base64s: [null, null, null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.toggleScenarioItem("work", items[0].id);
      store.toggleScenarioItem("work", items[1].id);
      store.toggleScenarioItem("work", items[2].id);

      store.deleteLauncherItems("cat-1", [items[0].id, items[2].id]);

      expect(store.scenarioItemIds.work).toEqual([items[1].id]);
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

    it("updateLauncherItems batch updates launch delay", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe", "C:\\b.exe"],
        directories: [],
        icon_base64s: [null, null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");

      store.updateLauncherItems("cat-1", items.map((item) => item.id), {
        launchDelaySeconds: 3.8,
      });

      expect(
        store
          .getLauncherItemsByCategoryId("cat-1")
          .every((item) => item.launchDelaySeconds === 3)
      ).toBe(true);
    });

    it("moveLauncherItems moves items and remaps dependency category", () => {
      const stats = useStatsStore();
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe", "C:\\b.exe", "C:\\c.exe"],
        directories: [],
        icon_base64s: [null, null, null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.updateLauncherItem("cat-1", items[1].id, {
        launchDependencies: [
          {
            categoryId: "cat-1",
            itemId: items[0].id,
            delayAfterSeconds: 1,
          },
        ],
      });
      store.updateLauncherItem("cat-1", items[2].id, {
        launchDependencies: [
          {
            categoryId: "cat-1",
            itemId: items[0].id,
            delayAfterSeconds: 2,
          },
        ],
      });
      store.recordItemUsage("cat-1", items[0].id);

      store.moveLauncherItems("cat-1", "cat-2", [items[0].id, items[1].id]);

      expect(store.getLauncherItemsByCategoryId("cat-1")).toHaveLength(1);
      expect(store.getLauncherItemsByCategoryId("cat-2")).toHaveLength(2);
      expect(store.recentUsedItems[0].categoryId).toBe("cat-2");
      expect(stats.getAppUsageForItem(items[0].id)?.categoryId).toBe("cat-2");
      expect(
        store.getLauncherItemById("cat-2", items[1].id)?.launchDependencies
      ).toEqual([
        {
          categoryId: "cat-2",
          itemId: items[0].id,
          delayAfterSeconds: 1,
        },
      ]);
      expect(
        store.getLauncherItemById("cat-1", items[2].id)?.launchDependencies
      ).toEqual([
        {
          categoryId: "cat-2",
          itemId: items[0].id,
          delayAfterSeconds: 2,
        },
      ]);
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
      const stats = useStatsStore();
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");
      store.recordItemUsage("cat-1", items[0].id);

      expect(store.recentUsedItems).toHaveLength(1);
      expect(store.recentUsedItems[0].usageCount).toBe(1);
      expect(stats.launchEvents).toHaveLength(1);
      expect(stats.totalLaunchesAllTime).toBe(1);
    });

    it("increments usage count on repeat", () => {
      const stats = useStatsStore();
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
      expect(stats.launchEvents).toHaveLength(2);
      expect(stats.totalLaunchesAllTime).toBe(2);
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
      const stats = useStatsStore();
      store.recentUsedItems = [
        { categoryId: "c1", itemId: "i1", usedAt: 1, usageCount: 1 },
      ];
      stats.recordLaunchEvent({
        categoryId: "c1",
        itemId: "i1",
        usedAt: Date.now(),
      });
      store.clearRecentUsed();
      expect(store.recentUsedItems).toHaveLength(0);
      expect(stats.launchEvents).toHaveLength(0);
      expect(stats.launchTrackingStartedAt).toBeNull();
    });
  });

  describe("importLauncherSnapshot", () => {
    it("replaces launcher state and resets stats tracking", async () => {
      const stats = useStatsStore();
      store.addLauncherItemsToCategory("cat-old", {
        paths: ["C:\\old.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const oldItem = store.getLauncherItemsByCategoryId("cat-old")[0];
      store.togglePinned("cat-old", oldItem.id);
      store.recordItemUsage("cat-old", oldItem.id);

      await store.importLauncherSnapshot({
        items: {
          "cat-new": [
            {
              id: "item-new",
              name: "new",
              path: "C:\\new.exe",
              itemType: "file",
              isDirectory: false,
              iconBase64: null,
              hasCustomIcon: false,
              launchDependencies: [],
              launchDelaySeconds: 0,
            },
          ],
        },
        pinnedItemIds: ["item-new"],
        recentUsedItems: [
          {
            categoryId: "cat-new",
            itemId: "item-new",
            usedAt: 123,
            usageCount: 2,
          },
        ],
      });

      expect(store.getLauncherItemsByCategoryId("cat-old")).toEqual([]);
      expect(store.getLauncherItemsByCategoryId("cat-new")).toHaveLength(1);
      expect(store.pinnedItemIds).toEqual(["item-new"]);
      expect(store.recentUsedItems).toEqual([
        {
          categoryId: "cat-new",
          itemId: "item-new",
          usedAt: 123,
          usageCount: 2,
        },
      ]);
      expect(stats.launchEvents).toHaveLength(0);
      expect(stats.launchTrackingStartedAt).toBeNull();
      expect(stats.totalLaunchesAllTime).toBe(2);
    });

    it("reuses the in-flight full search sync promise", async () => {
      let releaseSync: (() => void) | null = null;
      const invokeSpy = vi.spyOn(invokeWrapper, "invoke").mockImplementation((cmd) => {
        if (cmd === "update_search_items") {
          return new Promise((resolve) => {
            releaseSync = () =>
              resolve({
                ok: true,
                value: undefined,
              } as Awaited<ReturnType<typeof invokeWrapper.invoke>>);
          });
        }

        return Promise.resolve({
          ok: true,
          value: [],
        } as Awaited<ReturnType<typeof invokeWrapper.invoke>>);
      });

      const firstSync = store.syncSearchIndex();
      let secondResolved = false;
      const secondSync = store.syncSearchIndex().then(() => {
        secondResolved = true;
      });

      await Promise.resolve();

      expect(invokeSpy).toHaveBeenCalledTimes(1);
      expect(secondResolved).toBe(false);

      if (!releaseSync) {
        throw new Error("search sync gate was not initialized");
      }
      (releaseSync as () => void)();

      await Promise.all([firstSync, secondSync]);

      expect(secondResolved).toBe(true);
      expect(store.isRustSearchReady).toBe(true);
    });

    it("keeps only valid scenario item ids after import while preserving order and dedupe", async () => {
      store.scenarioItemIds = {
        work: ["item-ghost", "item-2", "item-1", "item-2"],
        dev: ["item-3", "item-3", "item-missing"],
        play: ["item-missing"],
      };

      await store.importLauncherSnapshot({
        items: {
          "cat-new": [
            {
              id: "item-1",
              name: "new-1",
              path: "C:\\new-1.exe",
              itemType: "file",
              isDirectory: false,
              iconBase64: null,
              hasCustomIcon: false,
              launchDependencies: [],
              launchDelaySeconds: 0,
            },
            {
              id: "item-2",
              name: "new-2",
              path: "C:\\new-2.exe",
              itemType: "file",
              isDirectory: false,
              iconBase64: null,
              hasCustomIcon: false,
              launchDependencies: [],
              launchDelaySeconds: 0,
            },
            {
              id: "item-3",
              name: "new-3",
              path: "C:\\new-3.exe",
              itemType: "file",
              isDirectory: false,
              iconBase64: null,
              hasCustomIcon: false,
              launchDependencies: [],
              launchDelaySeconds: 0,
            },
          ],
        },
      });

      expect(store.scenarioItemIds).toEqual({
        work: ["item-2", "item-1"],
        dev: ["item-3"],
        play: [],
      });
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
    it("uses cached icons before calling native extraction", async () => {
      setCachedLauncherIcon("C:\\cached.exe", "cached-icon");
      const invokeSpy = vi.spyOn(invokeWrapper, "invoke");

      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\cached.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const items = store.getLauncherItemsByCategoryId("cat-1");

      await store.hydrateMissingIconsForItems([
        { categoryId: "cat-1", itemId: items[0].id },
      ]);

      const hydrated = store.getLauncherItemsByCategoryId("cat-1")[0];
      expect(hydrated.iconBase64).toBe("cached-icon");
      expect(hydrated.hasCustomIcon).toBe(false);
      expect(invokeSpy).not.toHaveBeenCalled();
    });

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
      expect(hydrated[0].hasCustomIcon).toBe(false);
      expect(hydrated[1].iconBase64).toBe("icon-b");
      expect(hydrated[1].hasCustomIcon).toBe(false);
      expect(getCachedLauncherIcon("C:\\a.exe")).toBe("icon-a");
      expect(getCachedLauncherIcon("C:\\b.exe")).toBe("icon-b");
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
      expect(after.hasCustomIcon).toBe(true);
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it("keeps imported default file icons compact until visible hydration runs", async () => {
      setCachedLauncherIcon("C:\\a.exe", "cached-icon");
      const invokeSpy = vi.spyOn(invokeWrapper, "invoke").mockResolvedValue({
        ok: true,
        value: ["real-icon"],
      } as Awaited<ReturnType<typeof invokeWrapper.invoke>>);

      await store.importLauncherItems(
        {
          "cat-1": [
            {
              id: "item-1",
              name: "a",
              path: "C:\\a.exe",
              itemType: "file",
              isDirectory: false,
              iconBase64: null,
              hasCustomIcon: false,
              launchDependencies: [],
              launchDelaySeconds: 0,
            },
          ],
        },
        { refreshDerivedIcons: true }
      );

      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const imported = store.getLauncherItemsByCategoryId("cat-1")[0];
      expect(imported.iconBase64).toBeNull();
      expect(imported.hasCustomIcon).toBe(false);
      expect(getCachedLauncherIcon("C:\\a.exe")).toBe("cached-icon");
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it("refreshes imported derived file icons lazily when visible hydration runs", async () => {
      setCachedLauncherIcon("C:\\a.exe", "cached-icon");
      const invokeSpy = vi.spyOn(invokeWrapper, "invoke").mockResolvedValue({
        ok: true,
        value: ["real-icon"],
      } as Awaited<ReturnType<typeof invokeWrapper.invoke>>);

      await store.importLauncherItems(
        {
          "cat-1": [
            {
              id: "item-1",
              name: "a",
              path: "C:\\a.exe",
              itemType: "file",
              isDirectory: false,
              iconBase64: "imported-derived-icon",
              hasCustomIcon: false,
              launchDependencies: [],
              launchDelaySeconds: 0,
            },
          ],
        },
        { refreshDerivedIcons: true }
      );

      await store.hydrateMissingIconsForItems([
        {
          categoryId: "cat-1",
          itemId: "item-1",
        },
      ]);

      const refreshed = store.getLauncherItemsByCategoryId("cat-1")[0];
      expect(refreshed.iconBase64).toBe("real-icon");
      expect(refreshed.hasCustomIcon).toBe(false);
      expect(getCachedLauncherIcon("C:\\a.exe")).toBe("real-icon");
      expect(invokeSpy).toHaveBeenCalledTimes(1);
    });

    it("does not refresh imported custom icons", async () => {
      const invokeSpy = vi.spyOn(invokeWrapper, "invoke").mockResolvedValue({
        ok: true,
        value: ["real-icon"],
      } as Awaited<ReturnType<typeof invokeWrapper.invoke>>);

      await store.importLauncherItems(
        {
          "cat-1": [
            {
              id: "item-1",
              name: "a",
              path: "C:\\a.exe",
              itemType: "file",
              isDirectory: false,
              iconBase64: "custom-icon",
              hasCustomIcon: true,
              launchDependencies: [],
              launchDelaySeconds: 0,
            },
          ],
        },
        { refreshDerivedIcons: true }
      );

      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const preserved = store.getLauncherItemsByCategoryId("cat-1")[0];
      expect(preserved.iconBase64).toBe("custom-icon");
      expect(preserved.hasCustomIcon).toBe(true);
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it("infers legacy custom icon state from originalIconBase64 during import", async () => {
      await store.importLauncherItems({
        "cat-1": [
          {
            id: "item-1",
            name: "a",
            path: "C:\\a.exe",
            itemType: "file",
            isDirectory: false,
            iconBase64: "custom-icon",
            originalIconBase64: "default-icon",
            launchDependencies: [],
            launchDelaySeconds: 0,
          } as any,
        ],
      });

      const imported = store.getLauncherItemsByCategoryId("cat-1")[0];
      expect(imported.iconBase64).toBe("custom-icon");
      expect(imported.hasCustomIcon).toBe(true);
    });

    it("does not resolve unchanged lnk paths again when resolvedPath already exists", async () => {
      const invokeSpy = vi.spyOn(invokeWrapper, "invoke").mockResolvedValue({
        ok: true,
        value: "C:\\real.exe",
      } as Awaited<ReturnType<typeof invokeWrapper.invoke>>);

      await store.importLauncherItems({
        "cat-1": [
          {
            id: "item-1",
            name: "Shortcut",
            path: "C:\\Shortcut.lnk",
            resolvedPath: "C:\\real.exe",
            itemType: "file",
            isDirectory: false,
            iconBase64: null,
            hasCustomIcon: false,
            launchDependencies: [],
            launchDelaySeconds: 0,
          },
        ],
      });

      store.updateLauncherItem("cat-1", "item-1", {
        path: "C:\\Shortcut.lnk",
      });

      expect(store.getLauncherItemById("cat-1", "item-1")?.resolvedPath).toBe(
        "C:\\real.exe"
      );
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

    it("cleans up scenario item ids for deleted category items", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe", "C:\\b.exe"],
        directories: [],
        icon_base64s: [null, null],
      });
      store.addLauncherItemsToCategory("cat-2", {
        paths: ["C:\\c.exe"],
        directories: [],
        icon_base64s: [null],
      });

      const cat1Items = store.getLauncherItemsByCategoryId("cat-1");
      const cat2Item = store.getLauncherItemsByCategoryId("cat-2")[0];
      store.scenarioItemIds = {
        work: [cat1Items[0].id, cat2Item.id, cat1Items[1].id],
        dev: [cat1Items[1].id],
        play: [],
      };

      store.deleteCategoryCleanup("cat-1");

      expect(store.scenarioItemIds).toEqual({
        work: [cat2Item.id],
        dev: [],
        play: [],
      });
    });
  });

  describe("scenario item ids", () => {
    it("scenario membership can be toggled and deduped", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const item = store.getLauncherItemsByCategoryId("cat-1")[0];

      store.toggleScenarioItem("work", item.id);
      store.toggleScenarioItem("work", item.id);
      store.toggleScenarioItem("work", item.id);

      expect(store.scenarioItemIds.work).toEqual([item.id]);
    });

    it("deleting launcher item removes scenario references", () => {
      store.addLauncherItemsToCategory("cat-1", {
        paths: ["C:\\a.exe"],
        directories: [],
        icon_base64s: [null],
      });
      const item = store.getLauncherItemsByCategoryId("cat-1")[0];
      store.toggleScenarioItem("dev", item.id);

      store.deleteLauncherItem("cat-1", item.id);

      expect(store.scenarioItemIds.dev).toEqual([]);
    });
  });
});
