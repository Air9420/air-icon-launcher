import { enumContextMenuType } from "./contextMenuTypes";
import type { CategorySortMode, HomeLayoutPresetKey } from "../stores";

export type VisibilityCondition =
  | { menuType: enumContextMenuType | enumContextMenuType[] }
  | { homeSection: "pinned" | "recent" | ("pinned" | "recent")[] }
  | { categorySortMode: CategorySortMode | CategorySortMode[] }
  | { item: { pinned?: boolean; favorite?: boolean; customIcon?: boolean } }
  | { category: true | { customIcon?: boolean } }
  | { layout: { categoryCols?: number; launcherCols?: number; pinnedPreset?: string; recentPreset?: string } }
  | { and: VisibilityCondition[] }
  | { or: VisibilityCondition[] }
  | { not: VisibilityCondition };

export type ConditionValue<T> =
  | T
  | { if: VisibilityCondition; then: T; else?: ConditionValue<T> };

export type ResolveContext = {
  menuType: enumContextMenuType;
  itemId: string | null;
  categoryId: string | null;
  homeSection: "pinned" | "recent" | null;
  categorySortMode?: CategorySortMode;
  item?: {
    pinned: boolean;
    favorite: boolean;
    customIcon: boolean;
  };
  category?: {
    id: string;
    customIcon: boolean;
  };
  layout?: {
    categoryCols: number;
    launcherCols: number;
    pinnedPreset: HomeLayoutPresetKey;
    recentPreset: HomeLayoutPresetKey;
  };
};

function isMenuTypeMatch(
  condition: { menuType: enumContextMenuType | enumContextMenuType[] },
  ctx: ResolveContext,
): boolean {
  const types = Array.isArray(condition.menuType)
    ? condition.menuType
    : [condition.menuType];
  return types.includes(ctx.menuType);
}

function isHomeSectionMatch(
  condition: { homeSection: "pinned" | "recent" | ("pinned" | "recent")[] },
  ctx: ResolveContext,
): boolean {
  if (!ctx.homeSection) return false;
  const sections = Array.isArray(condition.homeSection)
    ? condition.homeSection
    : [condition.homeSection];
  return sections.includes(ctx.homeSection);
}

function isCategorySortModeMatch(
  condition: { categorySortMode: CategorySortMode | CategorySortMode[] },
  ctx: ResolveContext,
): boolean {
  if (!ctx.categorySortMode) return false;
  const modes = Array.isArray(condition.categorySortMode)
    ? condition.categorySortMode
    : [condition.categorySortMode];
  return modes.includes(ctx.categorySortMode);
}

function isItemMatch(
  condition: {
    item: { pinned?: boolean; favorite?: boolean; customIcon?: boolean };
  },
  ctx: ResolveContext,
): boolean {
  if (!ctx.item) return false;
  const { pinned, favorite, customIcon } = condition.item;
  if (pinned !== undefined && ctx.item.pinned !== pinned) return false;
  if (favorite !== undefined && ctx.item.favorite !== favorite) return false;
  if (customIcon !== undefined && ctx.item.customIcon !== customIcon)
    return false;
  return true;
}

function isCategoryMatch(
  condition: { category: true | { customIcon?: boolean } },
  ctx: ResolveContext,
): boolean {
  if (!ctx.category || ctx.categoryId === null) {
    return false;
  }

  if (condition.category === true) {
    return true;
  }

  const { customIcon } = condition.category;
  if (customIcon !== undefined && ctx.category.customIcon !== customIcon) {
    return false;
  }
  return true;
}

function isLayoutMatch(
  condition: { layout: { categoryCols?: number; launcherCols?: number; pinnedPreset?: string; recentPreset?: string } },
  ctx: ResolveContext,
): boolean {
  if (!ctx.layout) return false;
  const { categoryCols, launcherCols, pinnedPreset, recentPreset } = condition.layout;
  if (categoryCols !== undefined && ctx.layout.categoryCols !== categoryCols) return false;
  if (launcherCols !== undefined && ctx.layout.launcherCols !== launcherCols) return false;
  if (pinnedPreset !== undefined && ctx.layout.pinnedPreset !== pinnedPreset) return false;
  if (recentPreset !== undefined && ctx.layout.recentPreset !== recentPreset) return false;
  return true;
}

export function evaluateCondition(
  condition: VisibilityCondition | undefined,
  ctx: ResolveContext,
): boolean {
  if (!condition) return false;
  if ("menuType" in condition) {
    return isMenuTypeMatch(condition, ctx);
  }
  if ("homeSection" in condition) {
    return isHomeSectionMatch(condition, ctx);
  }
  if ("categorySortMode" in condition) {
    return isCategorySortModeMatch(condition, ctx);
  }
  if ("item" in condition) {
    return isItemMatch(condition, ctx);
  }
  if ("category" in condition) {
    return isCategoryMatch(condition, ctx);
  }
  if ("layout" in condition) {
    return isLayoutMatch(condition, ctx);
  }
  if ("and" in condition) {
    return condition.and.every((c) => evaluateCondition(c, ctx));
  }
  if ("or" in condition) {
    return condition.or.some((c) => evaluateCondition(c, ctx));
  }
  if ("not" in condition) {
    return !evaluateCondition(condition.not, ctx);
  }
  return true;
}

export type LabelValue =
  | string
  | { if: VisibilityCondition; then: LabelValue; else?: LabelValue };

export function resolveLabel(label: LabelValue, ctx: ResolveContext): string {
  if (typeof label === "string") {
    return label;
  }
  const result = evaluateCondition(label.if, ctx);
  const value = result ? label.then : (label.else ?? "");
  return resolveLabel(value, ctx);
}

export function resolveConditionValue<T>(
  value: ConditionValue<T>,
  ctx: ResolveContext,
): T | undefined {
  if (typeof value !== "object" || value === null) {
    return value as T;
  }
  if (!("if" in value)) {
    return value as T;
  }
  const result = evaluateCondition(value.if, ctx);
  const resolved = result ? value.then : value.else;
  if (resolved === undefined) {
    return undefined;
  }
  return resolveConditionValue(resolved, ctx);
}
