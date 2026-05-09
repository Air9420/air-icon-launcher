import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScannedAppEntry } from "../../types/scan-cache";
import { matchScannedApps, normalizePathKey } from "../../utils/scan-fallback";
import { createPinia, setActivePinia } from "pinia";
import { useLauncherStore } from "../../stores/launcherStore";
import { clearScanCacheStateForTests, useScanCache } from "../useScanCache";

vi.mock("../../utils/invoke-wrapper", () => ({
  invoke: vi.fn(),
}));

import * as invokeWrapper from "../../utils/invoke-wrapper";

const RESOLVED_LNK_TARGET_STORAGE_KEY = "__resolved_lnk_target_cache__";
const localStorageStore = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem(key: string) {
    return localStorageStore.has(key) ? localStorageStore.get(key)! : null;
  },
  setItem(key: string, value: string) {
    localStorageStore.set(key, value);
  },
  removeItem(key: string) {
    localStorageStore.delete(key);
  },
});

const mockApps: ScannedAppEntry[] = [
  { name: "Visual Studio Code", path: "C:\\Apps\\Code.exe", source: "注册表", publisher: "Microsoft", iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
  { name: "Adobe Photoshop 2025", path: "C:\\Adobe\\Photoshop.exe", source: "注册表", publisher: "Adobe", iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
  { name: "Google Chrome", path: "C:\\Google\\Chrome.exe", source: "桌面", publisher: "Google", iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
  { name: "Steam", path: "C:\\Steam\\Steam.exe", source: "开始菜单", publisher: "Valve", iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
  { name: "微信", path: "C:\\Tencent\\WeChat.exe", source: "注册表", publisher: "Tencent", iconBase64: null, namePinyinFull: "weixin", namePinyinInitial: "wx" },
  { name: "网易云音乐", path: "C:\\NetEase\\CloudMusic.exe", source: "开始菜单", publisher: "NetEase", iconBase64: null, namePinyinFull: "wangyiyunyinyue", namePinyinInitial: "wyyyy" },
  { name: "Uninstall Helper", path: "C:\\Tools\\unins.exe", source: "注册表", publisher: null, iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
  { name: "Microsoft Visual C++ 2015 2022 Redistributable (x64)", path: "C:\\ProgramData\\Package Cache\\{x}\\VC_redist.x64.exe", source: "注册表", publisher: "Microsoft Corporation", iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
];

const launcherPaths = new Set<string>([normalizePathKey("C:\\Apps\\Code.exe")]);

describe("matchScannedApps", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorageStore.clear();
    localStorage.removeItem(RESOLVED_LNK_TARGET_STORAGE_KEY);
    setActivePinia(createPinia());
    clearScanCacheStateForTests();
  });

  it("matches exact name", () => {
    const results = matchScannedApps("Steam", mockApps, launcherPaths);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Steam");
  });

  it("matches partial name", () => {
    const results = matchScannedApps("Adobe", mockApps, launcherPaths);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Adobe Photoshop 2025");
  });

  it("deduplicates with launcher paths", () => {
    const results = matchScannedApps("Visual Studio Code", mockApps, launcherPaths);
    expect(results).toHaveLength(0);
  });

  it("matches by exe name prefix", () => {
    const results = matchScannedApps("chrome", mockApps, launcherPaths);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Google Chrome");
  });

  it("matches by full pinyin", () => {
    const results = matchScannedApps("weixin", mockApps, new Set());
    expect(results[0]?.name).toBe("微信");
  });

  it("matches by pinyin initial", () => {
    const results = matchScannedApps("wx", mockApps, new Set());
    expect(results[0]?.name).toBe("微信");
  });

  it("matches by pinyin substring", () => {
    const results = matchScannedApps("yinyue", mockApps, new Set());
    expect(results[0]?.name).toBe("网易云音乐");
  });

  it("filters noise names", () => {
    const results = matchScannedApps("unins", mockApps, new Set());
    expect(results).toHaveLength(0);
  });

  it("filters runtime component installers", () => {
    const results = matchScannedApps("c++", mockApps, new Set());
    expect(results).toHaveLength(0);
  });

  it("filters package-cache setup style entries", () => {
    const setupEntry: ScannedAppEntry = {
      name: "Intel(R) Serial IO",
      path: "C:\\ProgramData\\Intel\\Package Cache\\{id}\\Setup.exe",
      source: "注册表",
      publisher: "Intel Corporation",
      iconBase64: null,
      namePinyinFull: "",
      namePinyinInitial: "",
    };
    const results = matchScannedApps("intel", [setupEntry], new Set());
    expect(results).toHaveLength(0);
  });

  it("filters webview runtime components", () => {
    const webviewEntry: ScannedAppEntry = {
      name: "Microsoft Edge WebView2 Runtime",
      path: "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\120.0.2210.133\\msedgewebview2.exe",
      source: "注册表",
      publisher: "Microsoft Corporation",
      iconBase64: null,
      namePinyinFull: "",
      namePinyinInitial: "",
    };
    const results = matchScannedApps("webview", [webviewEntry], new Set());
    expect(results).toHaveLength(0);
  });

  it("keeps uninstall candidates but marks risk", () => {
    const uninstallEntry: ScannedAppEntry = {
      name: "MSI Afterburner 4.6.6 Beta 3",
      path: "E:\\MSI Afterburner\\uninstall.exe",
      source: "注册表",
      publisher: "MSI Co., LTD",
      iconBase64: null,
      namePinyinFull: "",
      namePinyinInitial: "",
    };
    const results = matchScannedApps("msi", [uninstallEntry], new Set());
    expect(results).toHaveLength(1);
    expect(results[0].launchRisk).toBe("uninstall_candidate");
    expect(results[0].launchRiskHint).toContain("卸载");
  });

  it("filters non-launcher shell executables", () => {
    const cmdEntry: ScannedAppEntry = {
      name: "Install Additional Tools for Node.js",
      path: "C:\\Windows\\System32\\cmd.exe",
      source: "开始菜单",
      publisher: null,
      iconBase64: null,
      namePinyinFull: "",
      namePinyinInitial: "",
    };
    const results = matchScannedApps("node", [cmdEntry], new Set());
    expect(results).toHaveLength(0);
  });

  it("marks installer candidates with warning risk", () => {
    const setupEntry: ScannedAppEntry = {
      name: "AntiCheatExpert",
      path: "Z:\\wegames\\foo\\ACE-Setup64.exe",
      source: "注册表",
      publisher: null,
      iconBase64: null,
      namePinyinFull: "",
      namePinyinInitial: "",
    };
    const results = matchScannedApps("anti", [setupEntry], new Set());
    expect(results).toHaveLength(1);
    expect(results[0].launchRisk).toBe("installer_candidate");
    expect(results[0].launchRiskHint).toContain("安装");
  });

  it("returns empty for empty keyword", () => {
    const results = matchScannedApps("", mockApps, launcherPaths);
    expect(results).toHaveLength(0);
  });

  it("respects match limit", () => {
    const bigApps = Array.from({ length: 20 }, (_, i) => ({
      name: `App ${i}`,
      path: `C:\\app${i}.exe`,
      source: "注册表",
      publisher: null,
      iconBase64: null,
      namePinyinFull: "",
      namePinyinInitial: "",
    } as ScannedAppEntry));
    const results = matchScannedApps("App", bigApps, new Set());
    expect(results).toHaveLength(8);
  });

  it("uses stored resolvedPath for lnk launcher dedupe without resolving again", async () => {
    const store = useLauncherStore();
    await store.importLauncherItems({
      "cat-1": [
        {
          id: "item-1",
          name: "Chrome Shortcut",
          path: "C:\\Apps\\Chrome.lnk",
          resolvedPath: "C:\\Google\\Chrome.exe",
          itemType: "file",
          isDirectory: false,
          iconBase64: null,
          hasCustomIcon: false,
          launchDependencies: [],
          launchDelaySeconds: 0,
        },
      ],
    });

    vi.spyOn(invokeWrapper, "invoke")
      .mockResolvedValueOnce({
        ok: true,
        value: {
          apps: [
            {
              name: "Google Chrome",
              path: "C:\\Google\\Chrome.exe",
              source: "桌面",
              publisher: "Google",
              iconBase64: null,
              namePinyinFull: "",
              namePinyinInitial: "",
            },
          ],
        },
      } as any);

    const cache = useScanCache();
    const section = await cache.getFallbackSection("chrome");

    expect(section).toBeNull();
    expect(invokeWrapper.invoke).toHaveBeenCalledTimes(1);
    expect(invokeWrapper.invoke).toHaveBeenCalledWith("read_scan_cache");
  });

  it("persists resolvedPath after first lnk dedupe resolution", async () => {
    const store = useLauncherStore();
    await store.importLauncherItems({
      "cat-1": [
        {
          id: "item-1",
          name: "Chrome Shortcut",
          path: "C:\\Apps\\Chrome.lnk",
          itemType: "file",
          isDirectory: false,
          iconBase64: null,
          hasCustomIcon: false,
          launchDependencies: [],
          launchDelaySeconds: 0,
        },
      ],
    });

    vi.spyOn(invokeWrapper, "invoke")
      .mockResolvedValueOnce({
        ok: true,
        value: {
          apps: [
            {
              name: "Google Chrome",
              path: "C:\\Google\\Chrome.exe",
              source: "桌面",
              publisher: "Google",
              iconBase64: null,
              namePinyinFull: "",
              namePinyinInitial: "",
            },
          ],
        },
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        value: "C:\\Google\\Chrome.exe",
      } as any);

    const cache = useScanCache();
    const section = await cache.getFallbackSection("chrome");

    expect(section).toBeNull();
    expect(store.getLauncherItemById("cat-1", "item-1")?.resolvedPath).toBe(
      "C:\\Google\\Chrome.exe"
    );
    expect(invokeWrapper.invoke).toHaveBeenCalledWith("resolve_lnk_target", {
      path: "C:\\Apps\\Chrome.lnk",
    });
  });

  it("reuses persisted lnk target cache after scan-cache state is recreated", async () => {
    const store = useLauncherStore();
    await store.importLauncherItems({
      "cat-1": [
        {
          id: "item-1",
          name: "Chrome Shortcut",
          path: "C:\\Apps\\Chrome.lnk",
          itemType: "file",
          isDirectory: false,
          iconBase64: null,
          hasCustomIcon: false,
          launchDependencies: [],
          launchDelaySeconds: 0,
        },
      ],
    });

    const invokeSpy = vi.spyOn(invokeWrapper, "invoke");
    invokeSpy
      .mockResolvedValueOnce({
        ok: true,
        value: {
          apps: [
            {
              name: "Google Chrome",
              path: "C:\\Google\\Chrome.exe",
              source: "桌面",
              publisher: "Google",
              iconBase64: null,
              namePinyinFull: "",
              namePinyinInitial: "",
            },
          ],
        },
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        value: "C:\\Google\\Chrome.exe",
      } as any);

    const firstCache = useScanCache();
    expect(await firstCache.getFallbackSection("chrome")).toBeNull();
    expect(store.getLauncherItemById("cat-1", "item-1")?.resolvedPath).toBe(
      "C:\\Google\\Chrome.exe"
    );

    clearScanCacheStateForTests();
    await store.importLauncherItems({
      "cat-1": [
        {
          id: "item-1",
          name: "Chrome Shortcut",
          path: "C:\\Apps\\Chrome.lnk",
          itemType: "file",
          isDirectory: false,
          iconBase64: null,
          hasCustomIcon: false,
          launchDependencies: [],
          launchDelaySeconds: 0,
        },
      ],
    });
    invokeSpy.mockClear();

    invokeSpy.mockResolvedValueOnce({
      ok: true,
      value: {
        apps: [
          {
            name: "Google Chrome",
            path: "C:\\Google\\Chrome.exe",
            source: "桌面",
            publisher: "Google",
            iconBase64: null,
            namePinyinFull: "",
            namePinyinInitial: "",
          },
        ],
      },
    } as any);

    const secondCache = useScanCache();
    expect(await secondCache.getFallbackSection("chrome")).toBeNull();
    expect(invokeSpy.mock.calls.filter(([command]) => command === "resolve_lnk_target")).toHaveLength(0);
    expect(store.getLauncherItemById("cat-1", "item-1")?.resolvedPath).toBe(
      "C:\\Google\\Chrome.exe"
    );
  });
});
