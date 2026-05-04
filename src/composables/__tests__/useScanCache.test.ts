import { describe, it, expect } from "vitest";
import type { ScannedAppEntry } from "../../types/scan-cache";
import { matchScannedApps, normalizePathKey } from "../../utils/scan-fallback";

const mockApps: ScannedAppEntry[] = [
  { name: "Visual Studio Code", path: "C:\\Apps\\Code.exe", source: "注册表", publisher: "Microsoft", iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
  { name: "Adobe Photoshop 2025", path: "C:\\Adobe\\Photoshop.exe", source: "注册表", publisher: "Adobe", iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
  { name: "Google Chrome", path: "C:\\Google\\Chrome.exe", source: "桌面", publisher: "Google", iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
  { name: "Steam", path: "C:\\Steam\\Steam.exe", source: "开始菜单", publisher: "Valve", iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
  { name: "微信", path: "C:\\Tencent\\WeChat.exe", source: "注册表", publisher: "Tencent", iconBase64: null, namePinyinFull: "weixin", namePinyinInitial: "wx" },
  { name: "网易云音乐", path: "C:\\NetEase\\CloudMusic.exe", source: "开始菜单", publisher: "NetEase", iconBase64: null, namePinyinFull: "wangyiyunyinyue", namePinyinInitial: "wyyyy" },
  { name: "Uninstall Helper", path: "C:\\Tools\\unins.exe", source: "注册表", publisher: null, iconBase64: null, namePinyinFull: "", namePinyinInitial: "" },
];

const launcherPaths = new Set<string>([normalizePathKey("C:\\Apps\\Code.exe")]);

describe("matchScannedApps", () => {
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
});
