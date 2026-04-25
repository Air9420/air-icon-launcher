import { describe, expect, it } from "vitest";
import {
  getRecentRecommendationTailQuota,
  splitRecentDisplayItems,
} from "../home-recommendations";

type MockItem = {
  key: string;
};

function createItems(keys: string[]): MockItem[] {
  return keys.map((key) => ({ key }));
}

describe("home-recommendations", () => {
  describe("getRecentRecommendationTailQuota", () => {
    it("reserves one third of the visible recent slots", () => {
      expect(getRecentRecommendationTailQuota(12)).toBe(4);
      expect(getRecentRecommendationTailQuota(10)).toBe(3);
      expect(getRecentRecommendationTailQuota(2)).toBe(1);
      expect(getRecentRecommendationTailQuota(0)).toBe(0);
    });
  });

  describe("splitRecentDisplayItems", () => {
    it("filters duplicates only against the visible recent head", () => {
      const recentItems = createItems([
        "watt",
        "chrome",
        "wechat",
        "terminal",
        "docker",
        "obsidian",
        "steam",
        "notion",
        "qq",
        "todesk",
        "browser",
        "music",
      ]);
      const timeCandidates = createItems(["watt", "qq", "todesk", "clash", "raiden"]);

      const result = splitRecentDisplayItems(recentItems, timeCandidates, 12, 4);

      expect(result.headItems.map((item) => item.key)).toEqual([
        "watt",
        "chrome",
        "wechat",
        "terminal",
        "docker",
        "obsidian",
        "steam",
        "notion",
      ]);
      expect(result.tailItems.map((item) => item.key)).toEqual([
        "qq",
        "todesk",
        "clash",
        "raiden",
      ]);
    });

    it("falls back to pure recent items when no unique tail candidates remain", () => {
      const recentItems = createItems(["a", "b", "c", "d", "e", "f"]);
      const timeCandidates = createItems(["a", "b"]);

      const result = splitRecentDisplayItems(recentItems, timeCandidates, 6, 2);

      expect(result.headItems.map((item) => item.key)).toEqual(["a", "b", "c", "d", "e", "f"]);
      expect(result.tailItems).toEqual([]);
    });
  });
});
