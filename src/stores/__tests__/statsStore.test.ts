import { describe, it, expect, beforeEach } from "vitest";
import { useStatsStore } from "../statsStore";
import { useLauncherStore } from "../launcherStore";
import { useCategoryStore } from "../categoryStore";
import { createPinia, setActivePinia } from "pinia";

const DAY_MS = 24 * 60 * 60 * 1000;

function setupStores() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return {
    stats: useStatsStore(),
    launcher: useLauncherStore(),
    category: useCategoryStore(),
  };
}

function getSeedTimestamp(daysAgo: number, hour: number = 9): number {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.getTime();
}

describe("statsStore - 智能排序 & 统计", () => {
  let stats: ReturnType<typeof useStatsStore>;
  let launcher: ReturnType<typeof useLauncherStore>;

  beforeEach(() => {
    const stores = setupStores();
    stats = stores.stats;
    launcher = stores.launcher;
    const catStore = stores.category;
    if (Array.isArray(catStore.categories)) {
      (catStore.categories as any).push(
        { id: "cat-work", name: "工作", customIconBase64: null },
        { id: "cat-fun", name: "娱乐", customIconBase64: null }
      );
    } else if (catStore.categories && typeof (catStore.categories as any).value !== "undefined") {
      (catStore.categories as any).value.push(
        { id: "cat-work", name: "工作", customIconBase64: null },
        { id: "cat-fun", name: "娱乐", customIconBase64: null }
      );
    } else {
      catStore.$patch({
        categories: [
          ...catStore.categories,
          { id: "cat-work", name: "工作", customIconBase64: null },
          { id: "cat-fun", name: "娱乐", customIconBase64: null },
        ],
      });
    }
  });

  function ensureItem(catId: string, path: string) {
    launcher.addLauncherItemsToCategory(catId, {
      paths: [path],
      directories: [],
      icon_base64s: [null],
    });
    const target = launcher.getLauncherItemsByCategoryId(catId).find((item) => item.path === path);
    expect(target).toBeDefined();
    return target!;
  }

  function seedUsage(
    catId: string,
    path: string,
    count: number,
    daysAgo: number,
    hour: number = 9
  ) {
    const target = ensureItem(catId, path);
    recordUsage(catId, target.id, count, daysAgo, hour);
    return target;
  }

  function recordUsage(
    catId: string,
    itemId: string,
    count: number,
    daysAgo: number,
    hour: number = 9
  ) {
    const firstUsedAt = getSeedTimestamp(daysAgo, hour);
    stats.ensureLaunchTrackingStarted([], firstUsedAt - DAY_MS);

    for (let i = 0; i < count; i++) {
      stats.recordLaunchEvent({
        categoryId: catId,
        itemId,
        usedAt: firstUsedAt + i * 60_000,
      });
    }
  }

  describe("recordSearch / topSearchKeywords", () => {
    it("records and ranks search keywords", () => {
      stats.recordSearch("chrome");
      stats.recordSearch("vscode");
      stats.recordSearch("chrome");

      expect(stats.topSearchKeywords).toHaveLength(2);
      expect(stats.topSearchKeywords[0].keyword).toBe("chrome");
      expect(stats.topSearchKeywords[0].count).toBe(2);
      expect(stats.topSearchKeywords[1].keyword).toBe("vscode");
      expect(stats.topSearchKeywords[1].count).toBe(1);
    });

    it("ignores empty or too-long keywords", () => {
      stats.recordSearch("");
      stats.recordSearch("   ");
      stats.recordSearch("a".repeat(51));

      expect(stats.topSearchKeywords).toHaveLength(0);
    });

    it("normalizes for dedupe but keeps the latest display keyword", () => {
      stats.recordSearch("Chrome");
      stats.recordSearch("VSCode");
      stats.recordSearch("vscode");

      expect(stats.searchHistory).toHaveLength(2);
      expect(stats.searchHistory[0].keyword).toBe("vscode");
      expect(stats.searchHistory[0].displayKeyword).toBe("vscode");
      expect(stats.searchHistory[1].keyword).toBe("chrome");
      expect(stats.searchHistory[1].displayKeyword).toBe("Chrome");
      expect(stats.topSearchKeywords[0].keyword).toBe("vscode");
      expect(stats.topSearchKeywords[1].keyword).toBe("Chrome");
    });

    it("merges case-insensitive duplicates and updates the display text", () => {
      stats.recordSearch("VSCode");
      stats.recordSearch("vscode");

      expect(stats.topSearchKeywords).toHaveLength(1);
      expect(stats.topSearchKeywords[0].count).toBe(2);
      expect(stats.searchHistory[0].keyword).toBe("vscode");
      expect(stats.searchHistory[0].displayKeyword).toBe("vscode");
      expect(stats.topSearchKeywords[0].keyword).toBe("vscode");
    });

    it("caps at max 200 entries", () => {
      for (let i = 0; i < 250; i++) {
        stats.recordSearch(`kw-${i}`);
      }

      expect(stats.searchHistory.length).toBeLessThanOrEqual(200);
    });
  });

  describe("launch tracking compatibility", () => {
    it("uses recent-used aggregates before precise tracking starts", () => {
      const target = ensureItem("cat-work", "C:\\legacy.exe");
      launcher.importRecentUsedItems([
        {
          categoryId: "cat-work",
          itemId: target.id,
          usedAt: getSeedTimestamp(2),
          usageCount: 3,
        },
      ]);

      expect(stats.launchTrackingStartedAt).toBeNull();
      expect(stats.totalLaunchesAllTime).toBe(3);
      expect(stats.totalLaunchesThisWeek).toBe(3);
    });

    it("captures a legacy snapshot before switching to precise events", () => {
      const target = ensureItem("cat-work", "C:\\bridge.exe");
      launcher.importRecentUsedItems([
        {
          categoryId: "cat-work",
          itemId: target.id,
          usedAt: getSeedTimestamp(1),
          usageCount: 3,
        },
      ]);

      launcher.recordItemUsage("cat-work", target.id);

      expect(stats.launchEvents).toHaveLength(1);
      expect(stats.legacyUsageSnapshot).toHaveLength(1);
      expect(stats.legacyUsageSnapshot[0].usageCount).toBe(3);
      expect(launcher.recentUsedItems[0].usageCount).toBe(4);
      expect(stats.totalLaunchesAllTime).toBe(4);
    });
  });

  describe("weeklyTopApps", () => {
    it("ranks apps by week launches descending", () => {
      seedUsage("cat-work", "C:\\vscode.exe", 20, 1);
      seedUsage("cat-work", "C:\\chrome.exe", 5, 2);
      seedUsage("cat-fun", "C:\\spotify.exe", 3, 6);

      const top = stats.weeklyTopApps;

      expect(top.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1].weekLaunches).toBeGreaterThanOrEqual(top[i].weekLaunches);
      }
    });

    it("excludes apps older than 7 days", () => {
      seedUsage("cat-work", "C:\\old.exe", 100, 10);

      const top = stats.weeklyTopApps.filter((a) => a.name === "old");
      expect(top).toHaveLength(0);
    });
  });

  describe("frequentlyUsedApps", () => {
    it("shows apps with recent usage and minimum launches", () => {
      seedUsage("cat-work", "C:\\daily.exe", 10, 0);

      const freq = stats.frequentlyUsedApps;
      const found = freq.find((a) => a.name === "daily");
      expect(found).toBeDefined();
    });

    it("excludes rarely used apps", () => {
      seedUsage("cat-work", "C:\\rare.exe", 1, 0);

      const freq = stats.frequentlyUsedApps;
      const found = freq.find((a) => a.name === "rare");
      expect(found).toBeUndefined();
    });
  });

  describe("categoryUsageDistribution", () => {
    it("calculates percentage distribution across categories", () => {
      seedUsage("cat-work", "C:\\ide.exe", 10, 1);
      seedUsage("cat-fun", "C:\\music.exe", 4, 2);

      const dist = stats.categoryUsageDistribution;

      expect(dist.length).toBeGreaterThan(0);
      const totalPct = dist.reduce((sum, d) => sum + d.percentage, 0);
      expect(totalPct).toBeCloseTo(100, 0);
    });
  });

  describe("getSmartSortOrder", () => {
    it("prioritizes high-usage items", () => {
      seedUsage("cat-work", "C:\\heavy.exe", 50, 0);
      seedUsage("cat-work", "C:\\light.exe", 2, 0);

      const rawItems = launcher.getLauncherItemsByCategoryId("cat-work");
      const order = stats.getSmartSortOrder("cat-work", rawItems.map((i) => i.id));

      const heavyItem = rawItems.find((i) => i.name === "heavy");
      const lightItem = rawItems.find((i) => i.name === "light");

      expect(heavyItem).toBeDefined();
      expect(lightItem).toBeDefined();

      if (heavyItem && lightItem) {
        const heavyIdx = order.indexOf(heavyItem.id);
        const lightIdx = order.indexOf(lightItem.id);

        expect(heavyIdx).toBeGreaterThanOrEqual(0);
        expect(lightIdx).toBeGreaterThanOrEqual(0);
        expect(heavyIdx).toBeLessThan(lightIdx);
      }
    });

    it("handles empty input gracefully", () => {
      const order = stats.getSmartSortOrder("nonexistent", []);
      expect(order).toEqual([]);
    });

    it("ranks by lifetime usage even when the recent week is quiet", () => {
      // long-term.exe：累计 40 次但都在 20 天前（周次数为 0）
      // burst.exe：最近 1 天猛开 6 次（周次数占优）
      // 权重调整后，长期累计应当胜出。
      seedUsage("cat-work", "C:\\long-term.exe", 40, 20);
      seedUsage("cat-work", "C:\\burst.exe", 6, 1);

      const rawItems = launcher.getLauncherItemsByCategoryId("cat-work");
      const order = stats.getSmartSortOrder("cat-work", rawItems.map((i) => i.id));

      const longTerm = rawItems.find((i) => i.name === "long-term");
      const burst = rawItems.find((i) => i.name === "burst");
      expect(longTerm).toBeDefined();
      expect(burst).toBeDefined();

      if (longTerm && burst) {
        expect(order.indexOf(longTerm.id)).toBeLessThan(order.indexOf(burst.id));
      }
    });

    it("keeps original order when scores tie", () => {
      seedUsage("cat-work", "C:\\tie-a.exe", 3, 2);
      seedUsage("cat-work", "C:\\tie-b.exe", 3, 2);

      const rawItems = launcher.getLauncherItemsByCategoryId("cat-work");
      const ids = rawItems.map((i) => i.id);
      const order = stats.getSmartSortOrder("cat-work", ids);

      expect(order).toEqual(ids);
    });
  });

  describe("totalLaunches counters", () => {
    it("counts total weekly and all-time launches", () => {
      seedUsage("cat-work", "C:\\a1.exe", 15, 1);
      seedUsage("cat-work", "C:\\a2.exe", 8, 3);

      expect(stats.totalLaunchesThisWeek).toBe(23);
      expect(stats.totalLaunchesAllTime).toBe(23);
    });

    it("returns zero when no data", () => {
      expect(stats.totalLaunchesThisWeek).toBe(0);
      expect(stats.totalLaunchesAllTime).toBe(0);
    });
  });

  describe("lifetimeLaunches", () => {
    it("keeps accumulating independently of the pruned event window", () => {
      const target = seedUsage("cat-work", "C:\\daily.exe", 5, 1);
      const before = stats.appUsageStats.find((s) => s.itemId === target.id);
      expect(before?.lifetimeLaunches).toBe(5);

      // 模拟事件流被裁掉（例如超过 180 天窗口），终身计数不应回退。
      stats.launchEvents = [];
      const after = stats.appUsageStats.find((s) => s.itemId === target.id);
      expect(after?.lifetimeLaunches).toBe(5);
      expect(after?.totalLaunches).toBe(0);
    });

    it("ranks allTimeTopApps by lifetime launches", () => {
      seedUsage("cat-work", "C:\\heavy.exe", 12, 1);
      seedUsage("cat-work", "C:\\light.exe", 3, 1);

      const top = stats.allTimeTopApps;
      expect(top[0].name).toBe("heavy");
      expect(top[0].lifetimeLaunches).toBe(12);
    });

    it("drops counts when the item is removed", () => {
      const target = seedUsage("cat-work", "C:\\gone.exe", 4, 1);
      expect(stats.lifetimeLaunchCounts[`cat-work:${target.id}`]).toBe(4);

      stats.removeLaunchEventsForItems("cat-work", [target.id]);

      expect(stats.lifetimeLaunchCounts[`cat-work:${target.id}`]).toBeUndefined();
    });

    it("moves counts along with the item when the category changes", () => {
      const target = seedUsage("cat-work", "C:\\move.exe", 6, 1);
      expect(stats.lifetimeLaunchCounts[`cat-work:${target.id}`]).toBe(6);

      stats.remapLaunchEventCategoryRefs([
        { fromCategoryId: "cat-work", toCategoryId: "cat-fun", itemId: target.id },
      ]);

      expect(stats.lifetimeLaunchCounts[`cat-work:${target.id}`]).toBeUndefined();
      expect(stats.lifetimeLaunchCounts[`cat-fun:${target.id}`]).toBe(6);
    });

    it("clears counts with the launch history", () => {
      seedUsage("cat-work", "C:\\clear.exe", 2, 1);
      expect(Object.keys(stats.lifetimeLaunchCounts).length).toBeGreaterThan(0);

      stats.clearLaunchHistory();

      expect(stats.lifetimeLaunchCounts).toEqual({});
      expect(stats.totalLaunchesAllTime).toBe(0);
    });
  });

  describe("clearSearchHistory", () => {
    it("clears all recorded keywords", () => {
      stats.recordSearch("test");
      expect(stats.searchHistory.length).toBe(1);

      stats.clearSearchHistory();
      expect(stats.searchHistory.length).toBe(0);
    });
  });

  describe("removeSearchHistory", () => {
    it("removes one recorded keyword", () => {
      stats.recordSearch("chrome");
      stats.recordSearch("vscode");

      stats.removeSearchHistory("chrome");

      expect(stats.searchHistory).toHaveLength(1);
      expect(stats.searchHistory[0].keyword).toBe("vscode");
    });

    it("removes keywords using normalized casing", () => {
      stats.recordSearch("Chrome");

      stats.removeSearchHistory("CHROME");

      expect(stats.searchHistory).toHaveLength(0);
    });
  });

  describe("external directory blocking", () => {
    it("filters only recent launches inside the selected directory", () => {
      stats.recordExternalLaunch({ path: "C:\\Tools\\app.exe", name: "app" });
      stats.recordExternalLaunch({ path: "C:\\Tools-old\\other.exe", name: "other" });

      stats.blockExternalLaunchDirectory("c:/tools/");

      expect(stats.isExternalLaunchBlocked("C:\\Tools\\app.exe")).toBe(true);
      expect(stats.isExternalLaunchBlocked("C:\\Tools-old\\other.exe")).toBe(false);
      expect(stats.externalRecentLaunches.map((entry) => entry.path)).toEqual([
        "C:\\Tools-old\\other.exe",
      ]);

      stats.recordExternalLaunch({ path: "C:\\Tools\\later.exe", name: "later" });
      expect(stats.externalRecentLaunches).toHaveLength(1);

      stats.unblockExternalLaunchDirectory("C:\\Tools");
      stats.recordExternalLaunch({ path: "C:\\Tools\\later.exe", name: "later" });
      expect(stats.externalRecentLaunches).toHaveLength(2);
    });
  });
});
