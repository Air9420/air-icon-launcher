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

  it("prunes the oldest entries when the cache grows past the cap", () => {
    let tick = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      tick += 1;
      return tick;
    });

    for (let i = 0; i < 185; i += 1) {
      setCachedLauncherIcon(`C:\\${i}.exe`, `icon-${i}`);
    }

    expect(getCachedLauncherIcon("C:\\0.exe")).toBeNull();
    expect(getCachedLauncherIcon("C:\\4.exe")).toBeNull();
    expect(getCachedLauncherIcon("C:\\5.exe")).toBe("icon-5");
    expect(getCachedLauncherIcon("C:\\184.exe")).toBe("icon-184");
  });

  it("skips oversized icons instead of persisting them", () => {
    const setItemSpy = vi.spyOn(localStorage, "setItem");
    const largeIcon = "a".repeat(300 * 1024);

    setCachedLauncherIcons([
      { path: "C:\\small.exe", iconBase64: "icon-small" },
      { path: "C:\\big.png", iconBase64: largeIcon },
    ]);

    expect(getCachedLauncherIcon("C:\\small.exe")).toBe("icon-small");
    expect(getCachedLauncherIcon("C:\\big.png")).toBeNull();
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });
});
