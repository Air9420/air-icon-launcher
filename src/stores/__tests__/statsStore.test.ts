import { describe, it, expect, beforeEach } from "vitest";
import { useStatsStore } from "../statsStore";
import { useLauncherStore } from "../launcherStore";
import { useCategoryStore } from "../categoryStore";
import { createPinia, setActivePinia } from "pinia";

function setupStores() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return {
    stats: useStatsStore(),
    launcher: useLauncherStore(),
    category: useCategoryStore(),
  };
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

  function seedUsage(catId: string, _name: string, path: string, count: number, daysAgo: number) {
    launcher.addLauncherItemsToCategory(catId, { paths: [path], directories: [], icon_base64s: [null] });
    const items = launcher.getLauncherItemsByCategoryId(catId);
    const target = items.find((i) => i.path === path);
    if (target) {
      for (let i = 0; i < count; i++) {
        launcher.recordItemUsage(catId, target.id);
      }
      const entry = launcher.recentUsedItems.find((r) => r.itemId === target.id);
      if (entry) {
        entry.usedAt = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
        entry.usageCount = count;
      }
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

  describe("weeklyTopApps", () => {
    it("ranks apps by week launches descending", () => {
      seedUsage("cat-work", "VSCode", "C:\\vscode.exe", 20, 1);
      seedUsage("cat-work", "Chrome", "C:\\chrome.exe", 5, 2);
      seedUsage("cat-fun", "Spotify", "C:\\spotify.exe", 3, 6);

      const top = stats.weeklyTopApps;

      expect(top.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1].weekLaunches).toBeGreaterThanOrEqual(top[i].weekLaunches);
      }
    });

    it("excludes apps older than 7 days", () => {
      seedUsage("cat-work", "OldApp", "C:\\old.exe", 100, 10);

      const top = stats.weeklyTopApps.filter((a) => a.name === "OldApp");
      expect(top).toHaveLength(0);
    });
  });

  describe("timeBasedRecommendations", () => {
    it("returns apps with time slot usage data", () => {
      seedUsage("cat-work", "IDE", "C:\\ide.exe", 5, 0);

      const recs = stats.timeBasedRecommendations;
      expect(Array.isArray(recs)).toBe(true);
    });
  });

  describe("frequentlyUsedApps", () => {
    it("shows apps with recent usage and minimum launches", () => {
      seedUsage("cat-work", "daily", "C:\\daily.exe", 10, 0);

      const freq = stats.frequentlyUsedApps;
      const found = freq.find((a) => a.name === "daily");
      expect(found).toBeDefined();
    });

    it("excludes rarely used apps", () => {
      seedUsage("cat-work", "rare", "C:\\rare.exe", 1, 0);

      const freq = stats.frequentlyUsedApps;
      const found = freq.find((a) => a.name === "rare");
      expect(found).toBeUndefined();
    });
  });

  describe("categoryUsageDistribution", () => {
    it("calculates percentage distribution across categories", () => {
      seedUsage("cat-work", "IDE", "C:\\ide.exe", 10, 1);
      seedUsage("cat-fun", "Music", "C:\\music.exe", 4, 2);

      const dist = stats.categoryUsageDistribution;

      expect(dist.length).toBeGreaterThan(0);
      const totalPct = dist.reduce((sum, d) => sum + d.percentage, 0);
      expect(totalPct).toBeCloseTo(100, 0);
    });
  });

  describe("getSmartSortOrder", () => {
    it("prioritizes high-usage items", () => {
      seedUsage("cat-work", "heavy", "C:\\heavy.exe", 50, 0);
      seedUsage("cat-work", "light", "C:\\light.exe", 2, 0);

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
      seedUsage("cat-work", "App1", "C:\\a1.exe", 15, 1);
      seedUsage("cat-work", "App2", "C:\\a2.exe", 8, 3);

      expect(stats.totalLaunchesThisWeek).toBeGreaterThanOrEqual(23);
      expect(stats.totalLaunchesAllTime).toBeGreaterThanOrEqual(23);
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
});
