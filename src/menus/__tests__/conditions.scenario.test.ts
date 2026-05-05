import { describe, expect, it } from "vitest";
import { evaluateCondition, type ResolveContext } from "../conditions";
import { enumContextMenuType } from "../contextMenuTypes";

function createContext(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    menuType: enumContextMenuType.IconItem,
    itemId: "item-1",
    categoryId: "cat-1",
    homeSection: null,
    item: {
      pinned: false,
      favorite: false,
      customIcon: false,
      scenarios: ["work"],
    },
    ...overrides,
  };
}

describe("conditions scenario matching", () => {
  it("matches single scenario key", () => {
    expect(
      evaluateCondition(
        { item: { scenario: "work" } },
        createContext({ item: { pinned: false, favorite: false, customIcon: false, scenarios: ["work"] } }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { item: { scenario: "work" } },
        createContext({ item: { pinned: false, favorite: false, customIcon: false, scenarios: ["dev"] } }),
      ),
    ).toBe(false);
  });

  it("matches any scenario in array", () => {
    expect(
      evaluateCondition(
        { item: { scenario: ["work", "dev"] } },
        createContext({ item: { pinned: false, favorite: false, customIcon: false, scenarios: ["dev"] } }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { item: { scenario: ["work", "dev"] } },
        createContext({ item: { pinned: false, favorite: false, customIcon: false, scenarios: ["play"] } }),
      ),
    ).toBe(false);
  });

  it("returns false when ctx.item.scenarios is missing", () => {
    expect(
      evaluateCondition(
        { item: { scenario: "work" } },
        createContext({ item: { pinned: false, favorite: false, customIcon: false } }),
      ),
    ).toBe(false);
  });

  it("returns false when ctx.item.scenarios is empty array", () => {
    expect(
      evaluateCondition(
        { item: { scenario: "work" } },
        createContext({ item: { pinned: false, favorite: false, customIcon: false, scenarios: [] } }),
      ),
    ).toBe(false);
  });
});
