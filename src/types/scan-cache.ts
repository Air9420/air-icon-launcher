export type ScannedMatchType =
  | "exact"
  | "prefix"
  | "substring"
  | "pinyin_full"
  | "pinyin_initial"
  | "fuzzy";

export interface ScannedAppEntry {
  name: string;
  path: string;
  targetPath?: string | null;
  launchType?: "file" | "shell" | "protocol";
  source: string;
  publisher: string | null;
  iconBase64: string | null;
  namePinyinFull?: string;
  namePinyinInitial?: string;
  matchType?: ScannedMatchType;
  launchRisk?: "uninstall_candidate" | "installer_candidate";
  launchRiskHint?: string;
}

export interface ScannedAppCache {
  updatedAt: number;
  scanType: "full" | "quick";
  apps: ScannedAppEntry[];
}

export interface ScannedSearchMatch {
  entry: ScannedAppEntry;
  matchScore: number;
}

export interface ScannedFallbackSection {
  sectionTitle: string;
  totalMatches: number;
  items: ScannedAppEntry[];
}

export const SCANNED_MATCH_LIMIT = 8;
export const QUICK_SCAN_INTERVAL_MS = 10 * 60 * 1000;
export const FULL_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
