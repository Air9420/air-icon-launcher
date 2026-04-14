import { describe, it, expect } from "vitest";
import {
  fuzzyMatchLauncherText,
  normalizeLauncherItemKey,
  mergeLauncherItems,
  mergeRustSearchResults,
} from "../launcher-search";
import type { LauncherItem } from "../launcherStore";
import type { Category } from "../categoryStore";

function makeItem(overrides: Partial<LauncherItem> = {}): LauncherItem {
  return {
    id: "item-1",
    name: "TestApp",
    path: "C:\\TestApp\\app.exe",
    itemType: 'file',
    isDirectory: false,
    iconBase64: null,
    launchDependencies: [],
    launchDelaySeconds: 0,
    ...overrides,
  };
}

function makeCategory(id: string, name: string): Category {
  return { id, name, customIconBase64: null };
}

describe("fuzzyMatchLauncherText", () => {
  it("matches substring", () => {
    expect(fuzzyMatchLauncherText("Google Chrome Browser", "Chrome")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(fuzzyMatchLauncherText("MyApp", "myapp")).toBe(true);
  });

  it("matches sequential subsequence (fuzzy)", () => {
    expect(fuzzyMatchLauncherText("Visual Studio Code", "vsc")).toBe(true);
  });

  it("returns false for non-matching keyword", () => {
    expect(fuzzyMatchLauncherText("Chrome", "Firefox")).toBe(false);
  });

  it("returns true for exact match", () => {
    expect(fuzzyMatchLauncherText("App", "App")).toBe(true);
  });

  it("handles empty text returns false", () => {
    expect(fuzzyMatchLauncherText("", "keyword")).toBe(false);
  });
});

describe("normalizeLauncherItemKey", () => {
  it("uses normalized path when available", () => {
    const key = normalizeLauncherItemKey({ path: "C:\\Program Files\\App\\a.exe", name: "App" });
    expect(key).toBe("c:/program files/app/a.exe");
  });

  it("falls back to name when path is empty", () => {
    const key = normalizeLauncherItemKey({ path: "", name: "MyApp" });
    expect(key).toBe("myapp");
  });

  it("returns null when both path and name are empty", () => {
    const key = normalizeLauncherItemKey({ path: "", name: "" });
    expect(key).toBeNull();
  });

  it("normalizes backslashes to forward slashes", () => {
    const key = normalizeLauncherItemKey({ path: "A\\B\\C.exe", name: "X" });
    expect(key).toBe("a/b/c.exe");
  });

  it("trims whitespace", () => {
    const key = normalizeLauncherItemKey({ path: "  C:\\app.exe  ", name: "App" });
    expect(key).toBe("c:/app.exe");
  });
});

describe("mergeLauncherItems", () => {
  it("merges items with same key under primary category", () => {
    const item = makeItem({ id: "1", name: "Chrome", path: "C:\\chrome.exe" });
    const results = mergeLauncherItems(
      [
        { item, categoryId: "cat-1" },
        { item: { ...item, id: "2" }, categoryId: "cat-2" },
      ],
      (id) => (id === "cat-1" ? makeCategory("cat-1", "System") : makeCategory("cat-2", "Work"))
    );
    expect(results).toHaveLength(1);
    expect(results[0].primaryCategoryId).toBe("cat-1");
    expect(results[0].categories).toHaveLength(2);
  });

  it("keeps distinct items separate", () => {
    const results = mergeLauncherItems(
      [
        { item: makeItem({ path: "C:\\a.exe", name: "A" }), categoryId: "c1" },
        { item: makeItem({ path: "C:\\b.exe", name: "B" }), categoryId: "c2" },
      ],
      (id) => makeCategory(id, id)
    );
    expect(results).toHaveLength(2);
  });

  it("filters out items with null keys", () => {
    const results = mergeLauncherItems(
      [
        { item: makeItem({ path: "", name: "" }), categoryId: "c1" },
        { item: makeItem({ path: "C:\\a.exe", name: "A" }), categoryId: "c2" },
      ],
      (id) => makeCategory(id, id)
    );
    expect(results).toHaveLength(1);
  });

  it("filters out categories that resolve to null", () => {
    const item = makeItem({ path: "C:\\a.exe" });
    const results = mergeLauncherItems(
      [{ item, categoryId: "unknown-cat" }],
      () => null
    );
    expect(results).toHaveLength(1);
    expect(results[0].categories).toHaveLength(0);
  });
});

describe("mergeRustSearchResults", () => {
  const getCategoryById = (id: string): Category | null =>
    id === "cat-1" ? makeCategory("cat-1", "System") : null;

  const getItemById = (_cid: string, iid: string): LauncherItem | null =>
    iid === "found-id"
      ? makeItem({ id: "found-id", name: "FoundApp", path: "C:\\found.exe" })
      : null;

  it("maps rust results to merged format", () => {
    const results = mergeRustSearchResults(
      [
        {
          id: "found-id",
          name: "FoundApp",
          path: "C:\\found.exe",
          category_id: "cat-1",
          fuzzy_score: 1000,
          matched_pinyin_initial: false,
          matched_pinyin_full: false,
          rank_score: 0.9,
        },
      ],
      getCategoryById,
      getItemById
    );
    expect(results).toHaveLength(1);
    expect(results[0].item.name).toBe("FoundApp");
    expect(results[0].categories).toHaveLength(1);
  });

  it("filters results with unknown category", () => {
    const results = mergeRustSearchResults(
      [
        {
          id: "x",
          name: "X",
          path: "C:\\x.exe",
          category_id: "nonexistent",
          fuzzy_score: 100,
          matched_pinyin_initial: false,
          matched_pinyin_full: false,
          rank_score: 0.5,
        },
      ],
      getCategoryById,
      getItemById
    );
    expect(results).toHaveLength(0);
  });

  it("creates fallback item when not found by id", () => {
    const results = mergeRustSearchResults(
      [
        {
          id: "missing-id",
          name: "MissingApp",
          path: "C:\\missing.exe",
          category_id: "cat-1",
          fuzzy_score: 500,
          matched_pinyin_initial: false,
          matched_pinyin_full: false,
          rank_score: 0.3,
        },
      ],
      getCategoryById,
      getItemById
    );
    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe("missing-id");
    expect(results[0].item.iconBase64).toBeNull();
  });
});
