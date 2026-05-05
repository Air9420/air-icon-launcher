import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { useLauncherStore } from "../../stores/launcherStore";
import { useMenuActions } from "../useMenuActions";
import { enumContextMenuType, type MenuContext } from "../../menus/contextMenuTypes";

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
});
