import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContextMenuModel } from "../../menus/contextMenu";
import { enumContextMenuType, evaluateCondition, resolveConditionValue } from "../../menus/contextMenuTypes";
import { buildMenuContextFromProps, type ContextMenuViewProps } from "../../menus/contextMenuContext";
import { useLauncherStore } from "../../stores/launcherStore";

function createProps(overrides: Partial<ContextMenuViewProps> = {}): ContextMenuViewProps {
  return {
    currentItemId: "item-1",
    currentCategoryId: "cat-1",
    isCurrentItemFavorite: false,
    hasCustomIconProp: false,
    hasCurrentCategoryCustomIcon: false,
    categoryCols: 5,
    launcherCols: 5,
    currentCategorySortMode: "manual",
    ...overrides,
  };
}

describe("contextMenu scenario chain", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("links launcherStore scenario membership into menu checked states", () => {
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

    const buildContext = () =>
      buildMenuContextFromProps(
        createProps({ currentItemId: itemId }),
        enumContextMenuType.IconItem,
        (scenario, id) => store.isItemInScenario(scenario, id),
      );

    const checkedStatesFor = () => {
      const menuContext = buildContext();
      const menuModel = buildContextMenuModel(menuContext);
      const group = menuModel.find(
        (item) => item.type === "group" && item.id === "builtin:group:scenario-membership",
      );
      expect(group?.type).toBe("group");
      if (!group || group.type !== "group") {
        throw new Error("scenario group missing");
      }
      return group.children.map((child) => {
        if (child.type !== "item") return null;
        return !!evaluateCondition(resolveConditionValue(child.checked, menuContext), menuContext);
      });
    };

    expect(buildContext().item?.scenarios).toEqual([]);
    expect(checkedStatesFor()).toEqual([false, false, false]);

    store.toggleScenarioItem("work", itemId);
    expect(buildContext().item?.scenarios).toEqual(["work"]);
    expect(checkedStatesFor()).toEqual([true, false, false]);

    store.toggleScenarioItem("dev", itemId);
    expect(buildContext().item?.scenarios).toEqual(["work", "dev"]);
    expect(checkedStatesFor()).toEqual([true, true, false]);
  });

  it("builds scenarios from checker callback", () => {
    const menuContext = buildMenuContextFromProps(
      createProps({ currentItemId: "item-1" }),
      enumContextMenuType.IconItem,
      (scenario) => scenario === "work",
    );

    expect(menuContext.item?.scenarios).toEqual(["work"]);
  });
});
