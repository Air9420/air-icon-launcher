import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLauncherIconCacheForTests,
  getCachedLauncherIcon,
  setCachedLauncherIcon,
  setCachedLauncherIcons,
} from "../launcher-icon-cache";

describe("launcher-icon-cache", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearLauncherIconCacheForTests();
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
    });
  });

  it("updates memory immediately for single writes", () => {
    setCachedLauncherIcon("C:\\A.exe", "icon-a");

    expect(getCachedLauncherIcon("C:\\A.exe")).toBe("icon-a");
  });

  it("persists multiple icon writes with a single storage write", () => {
    const setItemSpy = vi.spyOn(localStorage, "setItem");

    setCachedLauncherIcons([
      { path: "C:\\A.exe", iconBase64: "icon-a" },
      { path: "C:\\B.exe", iconBase64: "icon-b" },
      { path: "C:\\C.exe", iconBase64: "icon-c" },
    ]);

    expect(getCachedLauncherIcon("C:\\A.exe")).toBe("icon-a");
    expect(getCachedLauncherIcon("C:\\B.exe")).toBe("icon-b");
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });
});
