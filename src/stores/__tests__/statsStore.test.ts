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

function getDifferentSlotHour(hour: number): number {
  if (hour >= 6 && hour < 12) return 14;
  if (hour >= 12 && hour < 18) return 20;
  if (hour >= 18 && hour < 23) return 2;
  return 9;
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

  describe("timeBasedRecommendations", () => {
    it("returns apps with current time slot usage data", () => {
      seedUsage("cat-work", "C:\\ide.exe", 5, 0, new Date().getHours());

      const recs = stats.timeBasedRecommendations;
      expect(Array.isArray(recs)).toBe(true);
      expect(recs.some((item) => item.name === "ide")).toBe(true);
    });

    it("requires enough slot density and overall sample size", () => {
      const currentHour = new Date().getHours();
      const differentSlotHour = getDifferentSlotHour(currentHour);

      const qualified = ensureItem("cat-work", "C:\\qualified.exe");
      recordUsage("cat-work", qualified.id, 3, 0, currentHour);
      recordUsage("cat-work", qualified.id, 2, 1, differentSlotHour);

      const lowSlotCount = ensureItem("cat-work", "C:\\low-slot.exe");
      recordUsage("cat-work", lowSlotCount.id, 2, 0, currentHour);
      recordUsage("cat-work", lowSlotCount.id, 3, 1, differentSlotHour);

      const lowTotal = ensureItem("cat-work", "C:\\low-total.exe");
      recordUsage("cat-work", lowTotal.id, 4, 0, currentHour);

      const lowShare = ensureItem("cat-work", "C:\\low-share.exe");
      recordUsage("cat-work", lowShare.id, 3, 0, currentHour);
      recordUsage("cat-work", lowShare.id, 8, 1, differentSlotHour);

      const recs = stats.timeBasedRecommendations;

      expect(recs.some((item) => item.name === "qualified")).toBe(true);
      expect(recs.some((item) => item.name === "low-slot")).toBe(false);
      expect(recs.some((item) => item.name === "low-total")).toBe(false);
      expect(recs.some((item) => item.name === "low-share")).toBe(false);
    });

    it("ranks candidates by weighted slot usage and recency", () => {
      const currentHour = new Date().getHours();
      const differentSlotHour = getDifferentSlotHour(currentHour);

      const recent = ensureItem("cat-work", "C:\\recent.exe");
      recordUsage("cat-work", recent.id, 3, 0, currentHour);
      recordUsage("cat-work", recent.id, 2, 1, differentSlotHour);

      const stale = ensureItem("cat-work", "C:\\stale.exe");
      recordUsage("cat-work", stale.id, 4, 6, currentHour);
      recordUsage("cat-work", stale.id, 2, 6, differentSlotHour);

      const recs = stats.timeBasedRecommendations;
      const recentIndex = recs.findIndex((item) => item.name === "recent");
      const staleIndex = recs.findIndex((item) => item.name === "stale");

      expect(recentIndex).toBeGreaterThanOrEqual(0);
      expect(staleIndex).toBeGreaterThanOrEqual(0);
      expect(recentIndex).toBeLessThan(staleIndex);
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
});
