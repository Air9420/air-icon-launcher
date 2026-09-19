import type { Category } from "../categoryStore";

export type LauncherItem = {
  id: string;
  name: string;
  path: string;
  resolvedPath?: string;
  url?: string;
  itemType: "file" | "url";
  isDirectory: boolean;
  iconBase64: string | null;
  hasCustomIcon?: boolean;
  isFavorite?: boolean;
  lastUsedAt?: number;
  launchDependencies: LaunchDependency[];
  launchDelaySeconds: number;
};

export type LaunchDependency = {
  categoryId: string;
  itemId: string;
  delayAfterSeconds: number;
};

export type ScenarioKey = "work" | "dev" | "play";
export type ScenarioItemIds = Record<ScenarioKey, string[]>;

export type GlobalSearchResult = {
  item: LauncherItem;
  categoryId: string;
  categoryName: string;
};

export type GlobalSearchMergedResult = {
  key: string;
  item: LauncherItem;
  primaryCategoryId: string;
  categories: Category[];
  matchType: RustSearchMatchType;
};

export type RecentUsedItem = {
  categoryId: string;
  itemId: string;
  usedAt: number;
  usageCount: number;
};

export type RecentUsedMergedItem = {
  key: string;
  usedAt: number;
  recent: RecentUsedItem;
  item: LauncherItem;
  categories: Category[];
};

export type PinnedMergedItem = {
  key: string;
  item: LauncherItem;
  primaryCategoryId: string;
  categories: Category[];
};

export type RustSearchMatchType =
  | "exact"
  | "prefix"
  | "substring"
  | "pinyin_full"
  | "pinyin_initial"
  | "fuzzy";

export type RustSearchResult = {
  id: string;
  name: string;
  path: string;
  category_id: string;
  match_type: RustSearchMatchType;
  fuzzy_score: number;
  matched_pinyin_initial: boolean;
  matched_pinyin_full: boolean;
  rank_score: number;
};

export type ImportLauncherItemsOptions = {
  refreshDerivedIcons?: boolean;
  suppressEvents?: boolean;
};

export type ImportLauncherSnapshotPayload = {
  items: Record<string, LauncherItem[]>;
  pinnedItemIds?: string[];
  recentUsedItems?: RecentUsedItem[];
};

export type AddPathsPayload = {
  paths: string[];
  directories: string[];
  icon_base64s: Array<string | null>;
  itemTypes?: Array<"file" | "url">;
};

export type CreateItemPayload = {
  name: string;
  path?: string;
  url?: string;
  itemType: "file" | "url";
  isDirectory?: boolean;
  iconBase64?: string | null;
  launchDependencies?: LaunchDependency[];
  launchDelaySeconds?: number;
};

export type UpdateItemPatch = Partial<
  Pick<
    LauncherItem,
    | "name"
    | "url"
    | "path"
    | "resolvedPath"
    | "launchDependencies"
    | "launchDelaySeconds"
  >
>;

export type ScannedAppInput = {
  name: string;
  path: string;
  targetPath?: string | null;
  launchType?: import("../../utils/scanned-app-launch").ScannedLaunchType | null;
  source: string;
  publisher: string | null;
  iconBase64: string | null;
};

export type ScenarioLaunchEntry = {
  categoryId: string;
  item: LauncherItem;
};

export type LnkResolveTarget = {
  itemId: string;
  path: string;
};
