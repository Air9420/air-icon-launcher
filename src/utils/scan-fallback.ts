import { SCANNED_MATCH_LIMIT, type ScannedAppEntry, type ScannedSearchMatch } from "../types/scan-cache";

const NOISE_NAMES = new Set([
  "uninstall", "unins", "卸载", "删除",
  "update", "updater", "更新程序",
  "repair", "remove", "installer", "setup",
  "官网", "website", "readme", "license",
  "help", "manual", "documentation", "release notes",
  "changelog", "crash", "debug", "safe mode",
]);

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

    const name = entry.name.toLowerCase();
    const namePinyinFull = normalizePinyin(entry.namePinyinFull);
    const namePinyinInitial = normalizePinyin(entry.namePinyinInitial);
    const exeStem = entry.path
      .split("\\")
      .pop()
      ?.replace(/\.[^.]+$/, "")
      .toLowerCase() || "";

    let score = 0;

    if (name === lower) {
      score = 100;
    } else if (namePinyinFull && namePinyinFull === lower) {
      score = 95;
    } else if (namePinyinInitial && namePinyinInitial === lower) {
      score = 90;
    } else if (exeStem === lower) {
      score = 85;
    } else if (name.startsWith(lower)) {
      score = 80;
    } else if (name.includes(lower)) {
      score = 60;
    } else if (namePinyinFull && namePinyinFull.startsWith(lower)) {
      score = 55;
    } else if (namePinyinFull && namePinyinFull.includes(lower)) {
      score = 50;
    } else if (namePinyinInitial && namePinyinInitial.startsWith(lower)) {
      score = 45;
    } else if (namePinyinInitial && namePinyinInitial.includes(lower)) {
      score = 40;
    } else {
      const tokens = name.split(/[\s_-]+/);
      let tokenMatch = false;

      for (const token of tokens) {
        if (token.startsWith(lower)) {
          score = 40;
          tokenMatch = true;
          break;
        }
        if (token.includes(lower)) {
          score = 25;
          tokenMatch = true;
          break;
        }
      }

      if (!tokenMatch && exeStem.includes(lower)) {
        score = 15;
      }
    }

    if (score > 0) {
      results.push({ entry, matchScore: score });
    }
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  return results.slice(0, limit).map((result) => result.entry);
}
