import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { saveAppConfigPatchMock } = vi.hoisted(() => ({
  saveAppConfigPatchMock: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../utils/config-sync", () => ({
  saveAppConfigPatch: saveAppConfigPatchMock,
}));

import { useUIStore } from "../uiStore";

describe("uiStore layout persistence", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    saveAppConfigPatchMock.mockClear();
  });

  it("persists category cols changes by default", async () => {
    const store = useUIStore();
    store.setCategoryCols(6);
    await Promise.resolve();

    expect(saveAppConfigPatchMock).toHaveBeenCalledTimes(1);
    expect(saveAppConfigPatchMock).toHaveBeenCalledWith({ category_cols: 6 });
  });

  it("persists launcher cols changes by default", async () => {
    const store = useUIStore();
    store.setLauncherCols(4);
    await Promise.resolve();

    expect(saveAppConfigPatchMock).toHaveBeenCalledTimes(1);
    expect(saveAppConfigPatchMock).toHaveBeenCalledWith({ launcher_cols: 4 });
  });

  it("persists home section layout preset changes by default", async () => {
    const store = useUIStore();
    store.setHomeSectionLayoutPreset("pinned", "2x5");
    await Promise.resolve();

    expect(saveAppConfigPatchMock).toHaveBeenCalledTimes(1);
    expect(saveAppConfigPatchMock).toHaveBeenCalledWith({
      home_section_layouts: {
        pinned: { preset: "2x5", rows: 2, cols: 5 },
        recent: { preset: "1x5", rows: 1, cols: 5 },
      },
    });
  });

  it("skips persistence when persist option is false", async () => {
    const store = useUIStore();
    store.setCategoryCols(6, { persist: false });
    store.setLauncherCols(4, { persist: false });
    store.setHomeSectionLayoutPreset("recent", "2x4", { persist: false });
    store.setHomeSectionLayouts(
      {
        pinned: { preset: "1x4", rows: 1, cols: 4 },
        recent: { preset: "2x6", rows: 2, cols: 6 },
      },
      { persist: false }
    );
    await Promise.resolve();

    expect(saveAppConfigPatchMock).not.toHaveBeenCalled();
  });
});
