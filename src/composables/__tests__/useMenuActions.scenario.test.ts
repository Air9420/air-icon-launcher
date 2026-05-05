import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { useLauncherStore } from "../../stores/launcherStore";
import { buildContextMenuModel } from "../../menus/contextMenu";
import { useMenuActions } from "../useMenuActions";
import { enumContextMenuType, type MenuContext } from "../../menus/contextMenuTypes";
import { buildMenuContextFromProps, emitContextMenuItemAction, type ContextMenuActionEmitter } from "../../menus/contextMenuContext";

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    hide: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

function createMenuContext(): MenuContext {
  return {
    menuType: enumContextMenuType.IconItem,
    itemId: "item-1",
    categoryId: "cat-1",
    homeSection: null,
  };
}

describe("useMenuActions scenario actions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("toggle-scenario-membership dispatches to store and closes menu", async () => {
    const store = useLauncherStore();
    const toggleScenarioSpy = vi.spyOn(store, "toggleScenarioItem");
    const closeContextMenu = vi.fn();

    const { onMenuAction } = useMenuActions({
      currentCategoryId: ref("cat-1"),
      currentLauncherItemId: ref("item-1"),
      currentItemPath: ref(null),
      currentClipboardRecordId: ref(null),
      currentClipboardContentType: ref(null),
      currentHomeSection: ref(null),
      lastDrop: ref(null),
      processedDropIds: new Set<string>(),
      closeContextMenu,
      confirm: vi.fn().mockResolvedValue(true),
      inputDialog: vi.fn().mockResolvedValue(null),
    });

    await onMenuAction(
      { kind: "toggle-scenario-membership", scenario: "work" },
      createMenuContext(),
    );

    expect(toggleScenarioSpy).toHaveBeenCalledTimes(1);
    expect(toggleScenarioSpy).toHaveBeenCalledWith("work", "item-1");
    expect(closeContextMenu).toHaveBeenCalledTimes(1);
  });

  it("clicking scenario child emits action then updates store via onMenuAction", async () => {
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

    const closeContextMenu = vi.fn();
    const { onMenuAction } = useMenuActions({
      currentCategoryId: ref("cat-1"),
      currentLauncherItemId: ref(itemId),
      currentItemPath: ref(null),
      currentClipboardRecordId: ref(null),
      currentClipboardContentType: ref(null),
      currentHomeSection: ref(null),
      lastDrop: ref(null),
      processedDropIds: new Set<string>(),
      closeContextMenu,
      confirm: vi.fn().mockResolvedValue(true),
      inputDialog: vi.fn().mockResolvedValue(null),
    });

    const menuContext = buildMenuContextFromProps(
      {
        currentItemId: itemId,
        currentCategoryId: "cat-1",
        currentCategorySortMode: "manual",
      },
      enumContextMenuType.IconItem,
      (scenario, id) => store.isItemInScenario(scenario, id),
    );
    const model = buildContextMenuModel(menuContext);
    const scenarioGroup = model.find(
      (item) => item.type === "group" && item.id === "builtin:group:scenario-membership",
    );

    expect(scenarioGroup?.type).toBe("group");
    if (!scenarioGroup || scenarioGroup.type !== "group") {
      throw new Error("scenario group missing");
    }

    const workItem = scenarioGroup.children.find(
      (child) => child.type === "item" && child.id === "builtin:toggle-scenario-membership:work",
    );
    expect(workItem?.type).toBe("item");
    if (!workItem || workItem.type !== "item") {
      throw new Error("work scenario child missing");
    }

    expect(store.isItemInScenario("work", itemId)).toBe(false);

    let emittedAction: typeof workItem.action | null = null;
    let emittedContext: MenuContext | null = null;
    const emitAction: ContextMenuActionEmitter = (_event, action, ctx) => {
      emittedAction = action;
      emittedContext = ctx;
    };
    emitContextMenuItemAction(workItem, menuContext, emitAction);

    expect(emittedAction).toEqual({
      kind: "toggle-scenario-membership",
      scenario: "work",
    });
    expect(emittedContext).toEqual(menuContext);

    if (!emittedAction || !emittedContext) {
      throw new Error("missing emitted action or context");
    }

    await onMenuAction(emittedAction, emittedContext);

    expect(store.isItemInScenario("work", itemId)).toBe(true);
    expect(closeContextMenu).toHaveBeenCalledTimes(1);
  });
});
