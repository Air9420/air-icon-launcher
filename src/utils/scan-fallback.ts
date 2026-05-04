import {
  SCANNED_MATCH_LIMIT,
  type ScannedAppEntry,
  type ScannedMatchType,
  type ScannedSearchMatch,
} from "../types/scan-cache";

const NOISE_NAMES = new Set([
  "uninstall", "unins", "卸载", "删除",
  "update", "updater", "更新程序",
  "repair", "remove", "installer", "setup",
  "官网", "website", "readme", "license",
  "help", "manual", "documentation", "release notes",
  "changelog", "crash", "debug", "safe mode",
]);

const UNINSTALL_PATH_KEYWORDS = [
  "uninstall",
  "unins",
  "uninstaller",
  "卸载",
  "remove",
];

const COMPONENT_NAME_KEYWORDS = [
  "visual c++",
  "redistributable",
  "runtime",
  ".net runtime",
  "desktop runtime",
  "software development kit",
  "sdk",
  "webview2 runtime",
];

const COMPONENT_EXE_STEMS = new Set([
  "vcredist_x64",
  "vcredist_x86",
  "vc_redist.x64",
  "vc_redist.x86",
  "dotnet-runtime-6.0.16-win-x64",
  "windowsdesktop-runtime-6.0.30-win-x64",
  "windowsdesktop-runtime-8.0.13-win-x64",
  "winsdksetup",
]);

const COMPONENT_PATH_KEYWORDS = [
  "/programdata/package cache/",
  "/appdata/local/package cache/",
  "/windows/installer/",
  "/intel package cache ",
  "/intel/package cache/",
];

const INSTALLER_EXE_KEYWORDS = [
  "setup",
  "installer",
  "install",
  "package",
  "bootstrapper",
];

const COMPONENT_PATH_EXE_WHITELIST = new Set([
  "pgadmin4",
]);

const NON_LAUNCHER_EXECUTABLES = new Set([
  "cmd",
  "arpproducticon",
]);

const INSTALLER_ONLY_EXE_STEMS = new Set([
  "setup",
  "setupchipset",
  "setupme",
  "winsdksetup",
  "voicemeeter8setup",
  "eaappinstaller",
]);

const INSTALLER_PATH_KEYWORDS = [
  "/package cache/",
  "/windows/installer/",
];

export function isNoiseName(name: string): boolean {
  const lower = name.toLowerCase();
  return [...NOISE_NAMES].some((kw) => lower.includes(kw));
}

export function normalizePathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/").toLowerCase().trim();
  if (normalized.endsWith(".lnk")) {
    return normalized.slice(0, -4);
  }
  return normalized;
}

function isUninstallPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return UNINSTALL_PATH_KEYWORDS.some((kw) => normalized.includes(kw));
}

function getExeStem(path: string): string {
  return path
    .split("\\")
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .toLowerCase()
    .trim() || "";
}

function isNonLauncherExecutable(path: string): boolean {
  return NON_LAUNCHER_EXECUTABLES.has(getExeStem(path));
}

function isInstallerEntry(entry: ScannedAppEntry): boolean {
  const normalizedPath = entry.path.replace(/\\/g, "/").toLowerCase();
  const exeStem = getExeStem(entry.path);
  const lowerName = entry.name.toLowerCase();

  if (INSTALLER_ONLY_EXE_STEMS.has(exeStem)) return true;
  if (lowerName.includes("installer")) return true;
  if (INSTALLER_EXE_KEYWORDS.some((kw) => exeStem.includes(kw))) {
    return true;
  }
  if (INSTALLER_EXE_KEYWORDS.some((kw) => exeStem.includes(kw)) && INSTALLER_PATH_KEYWORDS.some((kw) => normalizedPath.includes(kw))) {
    return true;
  }
  return false;
}

function isRuntimeComponent(entry: ScannedAppEntry): boolean {
  const normalizedPath = entry.path.replace(/\\/g, "/").toLowerCase();
  const lowerName = entry.name.toLowerCase();
  const lowerPublisher = (entry.publisher || "").toLowerCase();
  const exeStem = getExeStem(entry.path);
  const isPackageCache = COMPONENT_PATH_KEYWORDS.some((kw) => normalizedPath.includes(kw));
  const hasComponentName = COMPONENT_NAME_KEYWORDS.some((kw) => lowerName.includes(kw));
  const hasComponentExe = COMPONENT_EXE_STEMS.has(exeStem);
  const looksLikeInstallerExe = INSTALLER_EXE_KEYWORDS.some((kw) => exeStem.includes(kw));
  const isWhitelistedExecutable = COMPONENT_PATH_EXE_WHITELIST.has(exeStem);
  const isMicrosoftComponent = lowerPublisher.includes("microsoft");

  if (isWhitelistedExecutable) return false;
  if (isPackageCache) return true;
  if (hasComponentExe) return true;
  if (lowerName.includes("webview2 runtime")) return true;
  if (isPackageCache && hasComponentName) return true;
  if (isPackageCache && lowerName.includes("installer")) return true;
  if (isPackageCache && looksLikeInstallerExe) return true;
  if (isMicrosoftComponent && hasComponentName) return true;
  return false;
}

function normalizePinyin(value?: string): string {
  return value?.toLowerCase().trim() || "";
}

export function matchScannedApps(
  keyword: string,
  apps: ScannedAppEntry[],
  launcherPathKeys: Set<string>,
  limit: number = SCANNED_MATCH_LIMIT
): ScannedAppEntry[] {
  const lower = keyword.toLowerCase().trim();
  if (!lower) return [];

  const results: ScannedSearchMatch[] = [];

  for (const entry of apps) {
    const pathKey = normalizePathKey(entry.path);
    if (launcherPathKeys.has(pathKey)) continue;
    if (isNoiseName(entry.name)) continue;
    if (isNonLauncherExecutable(entry.path)) continue;

    const name = entry.name.toLowerCase();
    const namePinyinFull = normalizePinyin(entry.namePinyinFull);
    const namePinyinInitial = normalizePinyin(entry.namePinyinInitial);
    const exeStem = getExeStem(entry.path);
    if (isRuntimeComponent(entry)) continue;

    let score = 0;
    let matchType: ScannedMatchType | undefined;

    if (name === lower) {
      score = 100;
      matchType = "exact";
    } else if (namePinyinFull && namePinyinFull === lower) {
      score = 95;
      matchType = "pinyin_full";
    } else if (namePinyinInitial && namePinyinInitial === lower) {
      score = 90;
      matchType = "pinyin_initial";
    } else if (exeStem === lower) {
      score = 85;
      matchType = "exact";
    } else if (name.startsWith(lower)) {
      score = 80;
      matchType = "prefix";
    } else if (name.includes(lower)) {
      score = 60;
      matchType = "substring";
    } else if (namePinyinFull && namePinyinFull.startsWith(lower)) {
      score = 55;
      matchType = "pinyin_full";
    } else if (namePinyinFull && namePinyinFull.includes(lower)) {
      score = 50;
      matchType = "pinyin_full";
    } else if (namePinyinInitial && namePinyinInitial.startsWith(lower)) {
      score = 45;
      matchType = "pinyin_initial";
    } else if (namePinyinInitial && namePinyinInitial.includes(lower)) {
      score = 40;
      matchType = "pinyin_initial";
    } else {
      const tokens = name.split(/[\s_-]+/);
      let tokenMatch = false;

      for (const token of tokens) {
        if (token.startsWith(lower)) {
          score = 40;
          matchType = "fuzzy";
          tokenMatch = true;
          break;
        }
        if (token.includes(lower)) {
          score = 25;
          matchType = "fuzzy";
          tokenMatch = true;
          break;
        }
      }

      if (!tokenMatch && exeStem.includes(lower)) {
        score = 15;
        matchType = "fuzzy";
      }
    }

    if (score > 0) {
      const uninstallCandidate = isUninstallPath(entry.path);
      const installerCandidate = isInstallerEntry(entry);
      let mergedEntry: ScannedAppEntry = entry;
      if (uninstallCandidate) {
        mergedEntry = {
          ...entry,
          matchType: matchType ?? "fuzzy",
          launchRisk: "uninstall_candidate",
          launchRiskHint: "疑似卸载程序，启动后可能进入卸载流程",
        };
      } else if (installerCandidate) {
        mergedEntry = {
          ...entry,
          matchType: matchType ?? "fuzzy",
          launchRisk: "installer_candidate",
          launchRiskHint: "疑似安装器入口，启动后可能进入安装/修复流程",
        };
      } else {
        mergedEntry = {
          ...entry,
          matchType: matchType ?? "fuzzy",
        };
      }
      results.push({ entry: mergedEntry, matchScore: score });
    }
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  return results.slice(0, limit).map((result) => result.entry);
}
