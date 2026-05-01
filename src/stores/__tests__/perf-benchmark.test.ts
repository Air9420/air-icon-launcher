import { describe, it, expect, beforeEach } from "vitest";
import { useLauncherStore } from "../launcherStore";
import { createPinia, setActivePinia } from "pinia";
import {
  fuzzyMatchLauncherText,
  normalizeLauncherItemKey,
  mergeLauncherItems,
} from "../launcher-search";
import type { LauncherItem } from "../launcherStore";
import type { Category } from "../categoryStore";

function createStore() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return useLauncherStore();
}

const APP_NAMES = [
  "Chrome", "Firefox", "VSCode", "Slack", "Discord", "Telegram",
  "WeChat", "QQ", "DingTalk", "Feishu", "Notion", "Obsidian",
  "Figma", "Photoshop", "Premiere", "Blender", "VLC", "Spotify",
  "Steam", "Epic Games", "Unity", "Godot", "GitKraken", "Postman",
  "Insomnia", "Wireshark", "VMware", "VirtualBox", "Docker Desktop",
  "Windows Terminal", "PowerShell", "Node.js", "Python", "Rust",
  "Go", "Java", "IntelliJ", "WebStorm", "PyCharm", "CLion",
  "Rider", "DataGrip", "RubyMine", "AppCode", "Fleet",
  "微信", "支付宝", "钉钉", "飞书", "网易云音乐", "QQ音乐",
  "哔哩哔哩", "百度网盘", "WPS Office", "Foxmail", "Snipaste",
  "Everything", "Listary", "AutoHotkey", "PowerToys", "ShareX",
  "OBS Studio", "Streamlabs", "DaVinci Resolve", "Audacity", "GIMP",
  "Inkscape", "Krita", "Sublime Text", "Atom", "Brave Browser",
  "Edge", "Opera", "Vivaldi", "Tor Browser", "Waterfox",
  "7-Zip", "WinRAR", "PeaZip", "Honeyview", "IrfanView",
  "SumatraPDF", "Zotero", "Joplin", "Standard Notes", "Signal",
  "Thunderbird", "ProtonMail", "Bitwarden", "KeePassXC", "Authy",
  "Microsoft Teams", "Zoom", "Google Meet", "Skype", "Line",
  "WhatsApp", "Messenger", "Twitter/X", "Reddit", "LinkedIn",
];

function generateItems(count: number, _categoryId: string): { paths: string[]; directories: string[]; icon_base64s: Array<string | null> } {
  const paths: string[] = [];
  const directories: string[] = [];
  const icon_base64s: Array<string | null> = [];

  for (let i = 0; i < count; i++) {
    const name = APP_NAMES[i % APP_NAMES.length];
    paths.push(`C:\\Program Files\\${name}\\${name}.exe`);
    directories.push("");
    icon_base64s.push(null);
  }

  return { paths, directories, icon_base64s };
}

interface BenchResult {
  name: string;
  totalMs: number;
  opsPerSecond: number;
  avgMicroseconds: number;
}

function bench(name: string, iterations: number, fn: () => void): BenchResult {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const totalMs = performance.now() - start;
  const avgUs = (totalMs / iterations) * 1000;
  const opsPerSec = Math.round(iterations / (totalMs / 1000));

  const result: BenchResult = { name, totalMs, opsPerSecond: opsPerSec, avgMicroseconds: avgUs };
  console.log(
    `[BENCH] ${name}: ${avgUs.toFixed(2)} µs/op | ${opsPerSec.toLocaleString()} ops/s | total ${(totalMs).toFixed(1)}ms (${iterations} iters)`
  );

  return result;
}

describe("Performance Benchmark - Launcher Store & Search", () => {
  describe("Store CRUD operations (spread operator cost)", () => {
    it("bench: addLauncherItemsToCategory with 100 items × 100 iterations", () => {
      const store = createStore();
      const payload = generateItems(100, "cat-1");

      const result = bench("addLauncherItems_100", 100, () => {
        store.launcherItemsByCategoryId = {};
        store.addLauncherItemsToCategory("cat-1", payload);
      });

      expect(result.avgMicroseconds).toBeLessThan(2000);
    });

    it("bench: addLauncherItemsToCategory with 300 items × 50 iterations", () => {
      const store = createStore();
      const payload = generateItems(300, "cat-1");

      const result = bench("addLauncherItems_300", 50, () => {
        store.launcherItemsByCategoryId = {};
        store.addLauncherItemsToCategory("cat-1", payload);
      });

      expect(result.avgMicroseconds).toBeLessThan(5000);
    });

    it("bench: deleteLauncherItem from 100-item category × 1000 iterations", () => {
      const store = createStore();
      store.addLauncherItemsToCategory("cat-1", generateItems(100, "cat-1"));
      const items = store.getLauncherItemsByCategoryId("cat-1");
      const targetId = items[50].id;

      const result = bench("deleteLauncherItem_100", 1000, () => {
        store.deleteLauncherItem("cat-1", targetId);
        store.launcherItemsByCategoryId = {};
        store.addLauncherItemsToCategory("cat-1", generateItems(100, "cat-1"));
      });

      expect(result.avgMicroseconds).toBeLessThan(500);
    });

    it("bench: updateLauncherItem in 100-item category × 1000 iterations", () => {
      const store = createStore();
      store.addLauncherItemsToCategory("cat-1", generateItems(100, "cat-1"));
      const items = store.getLauncherItemsByCategoryId("cat-1");
      const targetId = items[50].id;

      const result = bench("updateLauncherItem_100", 1000, () => {
        store.updateLauncherItem("cat-1", targetId, { name: `Renamed_${Date.now()}` });
      });

      expect(result.avgMicroseconds).toBeLessThan(500);
    });

    it("bench: togglePinned + recordItemUsage × 1000 iterations", () => {
      const store = createStore();
      store.addLauncherItemsToCategory("cat-1", generateItems(100, "cat-1"));
      const items = store.getLauncherItemsByCategoryId("cat-1");
      const targetId = items[0].id;

      const result = bench("togglePinned_recordUsage_100", 1000, () => {
        store.togglePinned("cat-1", targetId);
        store.recordItemUsage("cat-1", targetId);
      });

      expect(result.avgMicroseconds).toBeLessThan(800);
    });
  });

  describe("Search performance (fuzzyMatchLauncherText)", () => {
    let items: Array<{ item: LauncherItem; categoryId: string }>;

    beforeEach(() => {
      const store = createStore();
      store.addLauncherItemsToCategory("cat-1", generateItems(100, "cat-1"));
      store.addLauncherItemsToCategory("cat-2", generateItems(100, "cat-2"));
      store.addLauncherItemsToCategory("cat-3", generateItems(100, "cat-3"));

      items = [];
      for (const catId of ["cat-1", "cat-2", "cat-3"]) {
        for (const item of store.getLauncherItemsByCategoryId(catId)) {
          items.push({ item: { ...item }, categoryId: catId });
        }
      }
    });

    it("bench: fuzzyMatchLauncherText on 300 items, exact keyword × 1000 iterations", () => {
      const keyword = "Chrome";

      const result = bench("fuzzyMatch_300_exact('Chrome')", 1000, () => {
        let count = 0;
        for (const entry of items) {
          if (fuzzyMatchLauncherText(entry.item.name, keyword)) count++;
        }
      });

      expect(result.avgMicroseconds).toBeLessThan(1000);
    });

    it("bench: fuzzyMatchLauncherText on 300 items, short fuzzy keyword × 1000 iterations", () => {
      const keyword = "co";

      const result = bench("fuzzyMatch_300_fuzzy('co')", 1000, () => {
        let count = 0;
        for (const entry of items) {
          if (fuzzyMatchLauncherText(entry.item.name, keyword)) count++;
        }
      });

      expect(result.avgMicroseconds).toBeLessThan(1000);
    });

    it("bench: full search pipeline (match + normalize + merge) on 300 items × 500 iterations", () => {
      const keyword = "code";
      const getCategoryById = (id: string): Category | null =>
        ({ id, name: id, customIconBase64: null });

      const result = bench("search_pipeline_300('code')", 500, () => {
        const matched = items.filter((entry) =>
          fuzzyMatchLauncherText(entry.item.name, keyword)
        );
        mergeLauncherItems(matched, getCategoryById);
      });

      expect(result.avgMicroseconds).toBeLessThan(3000);
    });

    it("bench: normalizeLauncherItemKey × 10000 iterations", () => {
      const item = { path: "C:\\Program Files\\Google\\Chrome\\chrome.exe", name: "Chrome" };

      const result = bench("normalizeKey", 10000, () => {
        normalizeLauncherItemKey(item);
      });

      expect(result.avgMicroseconds).toBeLessThan(10);
    });
  });

  describe("Category switch simulation", () => {
    it("bench: simulate category switch with 5 categories × 100 items each × 200 switches", () => {
      const store = createStore();
      const catIds = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5"];
      for (const catId of catIds) {
        store.addLauncherItemsToCategory(catId, generateItems(100, catId));
      }

      const result = bench("category_switch_5×100", 200, () => {
        for (const catId of catIds) {
          const raw = store.getLauncherItemsByCategoryId(catId);
          const pinnedSet = new Set(store.pinnedItemIds);
          [...raw].sort((a, b) => {
            const aFav = pinnedSet.has(a.id);
            const bFav = pinnedSet.has(b.id);
            if (aFav && !bFav) return -1;
            if (!aFav && bFav) return 1;
            return 0;
          });
        }
      });

      expect(result.avgMicroseconds).toBeLessThan(2000);
    });

    it("bench: globalSearchMergedResults-like computation with 300 items × 10 keywords × 100 rounds", () => {
      const store = createStore();
      for (let c = 1; c <= 3; c++) {
        store.addLauncherItemsToCategory(`cat-${c}`, generateItems(100, `cat-${c}`));
      }

      const keywords = ["c", "ch", "chr", "code", "vs", "ste", "we", "wx", "slack", "disc"];

      let round = 0;
      const result = bench("globalSearchSim_300_10keywords", 100, () => {
        const kw = keywords[round % keywords.length];
        round++;

        const allEntries: Array<{ item: LauncherItem; categoryId: string }> = [];
        for (const catId of ["cat-1", "cat-2", "cat-3"]) {
          const catItems = store.getLauncherItemsByCategoryId(catId);
          for (const item of catItems) {
            if (fuzzyMatchLauncherText(item.name, kw)) {
              allEntries.push({ item, categoryId: catId });
            }
          }
        }
      });

      expect(result.avgMicroseconds).toBeLessThan(5000);
    });
  });

  describe("Scaling behavior summary", () => {
    it("reports scaling from 50 → 100 → 200 → 500 items for add operation", () => {
      const store = createStore();
      const sizes = [50, 100, 200, 500];
      const results: BenchResult[] = [];

      for (const size of sizes) {
        const payload = generateItems(size, "cat-bench");
        const iter = Math.max(10, Math.floor(5000 / size));

        const start = performance.now();
        for (let i = 0; i < iter; i++) {
          store.launcherItemsByCategoryId = {};
          store.addLauncherItemsToCategory("cat-bench", payload);
        }
        const totalMs = performance.now() - start;
        const avgUs = (totalMs / iter) * 1000;

        results.push({
          name: `add_${size}`,
          totalMs,
          opsPerSecond: Math.round(iter / (totalMs / 1000)),
          avgMicroseconds: avgUs,
        });

        console.log(
          `  [SCALE] addLauncherItems(${size}): ${avgUs.toFixed(2)} µs/op`
        );
      }

      for (let i = 1; i < results.length; i++) {
        const ratio = results[i].avgMicroseconds / results[i - 1].avgMicroseconds;
        const sizeRatio = sizes[i] / sizes[i - 1];
        console.log(
          `  [SCALE] ${sizes[i - 1]}→${sizes[i]}: time ratio ${ratio.toFixed(2)}x (size ratio ${sizeRatio.toFixed(1)}x)`
        );
      }

      expect(results[results.length - 1].avgMicroseconds).toBeLessThan(10000);
    });
  });
});
