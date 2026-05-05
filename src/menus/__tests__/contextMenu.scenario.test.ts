import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { buildContextMenuModel } from "../contextMenu";
import { enumContextMenuType, resolveConditionValue, evaluateCondition, type MenuContext } from "../contextMenuTypes";
import { useLauncherStore } from "../../stores/launcherStore";

function createIconItemContext(overrides: Partial<MenuContext> = {}): MenuContext {
  return {
    menuType: enumContextMenuType.IconItem,
    itemId: "item-1",
    categoryId: "cat-1",
    homeSection: null,
    categorySortMode: "manual",
    item: {
      pinned: false,
      favorite: false,
      customIcon: false,
    },
    category: {
      id: "cat-1",
      customIcon: false,
    },
    layout: {
      categoryCols: 5,
      launcherCols: 5,
      pinnedPreset: "1x5",
      recentPreset: "1x5",
    },
    ...overrides,
  };
}

describe("contextMenu scenario membership group", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("shows scenario membership group for IconItem in category", () => {
    const store = useLauncherStore();
    store.addLauncherItemsToCategory("cat-1", {
      paths: ["C:\\demo.exe"],
      directories: [],
      icon_base64s: [null],
    });
    const itemId = store.getLauncherItemsByCategoryId("cat-1")[0]?.id;
    expect(itemId).toBeTruthy();

    if (!itemId) {
      throw new Error("missing item id");
    }

    store.toggleScenarioItem("work", itemId);

    const menuModel = buildContextMenuModel(
      createIconItemContext({
        itemId,
      }),
    );

    const group = menuModel.find(
      (item) => item.type === "group" && item.id === "builtin:group:scenario-membership",
    );

    expect(group).toBeDefined();
    expect(group?.type).toBe("group");

    if (!group || group.type !== "group") {
      throw new Error("scenario group missing");
    }

    expect(group.children).toHaveLength(3);
    expect(group.children.every((child) => child.type === "item")).toBe(true);
    expect(group.children.map((child) => child.type === "item" ? child.label : null)).toEqual([
      "work",
      "dev",
      "play",
    ]);
    expect(group.children.map((child) => child.type === "item" ? child.mode : null)).toEqual([
      "checkbox",
      "checkbox",
      "checkbox",
    ]);
    expect(group.children.map((child) => child.type === "item" ? child.action : null)).toEqual([
      { kind: "toggle-scenario-membership", scenario: "work" },
      { kind: "toggle-scenario-membership", scenario: "dev" },
      { kind: "toggle-scenario-membership", scenario: "play" },
    ]);
    expect(
      group.children.map((child) => {
        if (child.type !== "item") return null;
        return !!evaluateCondition(resolveConditionValue(child.checked, createIconItemContext({ itemId })), createIconItemContext({ itemId }));
      }),
    ).toEqual([true, false, false]);
  });

  it("does not show scenario membership group for non-category icon item", () => {
    const menuModel = buildContextMenuModel(
      createIconItemContext({
        categoryId: null,
        category: undefined,
      }),
    );

    const group = menuModel.find(
      (item) => item.type === "group" && item.id === "builtin:group:scenario-membership",
    );

    expect(group).toBeUndefined();
  });

  it("scenario group children have expected labels and actions", () => {
    const menuModel = buildContextMenuModel(createIconItemContext());
    const group = menuModel.find(
      (item) => item.type === "group" && item.id === "builtin:group:scenario-membership",
    );

    expect(group?.type).toBe("group");
    if (!group || group.type !== "group") {
      throw new Error("scenario group missing");
    }

    const children = group.children.filter((child) => child.type === "item");
    expect(children).toHaveLength(3);
    expect(children.map((child) => child.label)).toEqual(["work", "dev", "play"]);
    expect(children.map((child) => child.action)).toEqual([
      { kind: "toggle-scenario-membership", scenario: "work" },
      { kind: "toggle-scenario-membership", scenario: "dev" },
      { kind: "toggle-scenario-membership", scenario: "play" },
    ]);
  });
});
