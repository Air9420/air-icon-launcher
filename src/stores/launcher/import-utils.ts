import {
  applyCachedOriginalIcon,
  normalizeHasCustomIcon,
  normalizeImportedLauncherItem,
  shouldRefreshDerivedIcon,
  type LauncherItemRef,
} from "../../composables/useItemsHelper";
import {
  getScannedLauncherFilePath,
  getScannedLauncherUrl,
  getScannedLaunchType,
  type ScannedLaunchType,
} from "../../utils/scanned-app-launch";
import { classifyInstalledApp } from "../../utils/classification/pipeline";
import { normalizeApp } from "../../utils/classification/normalizer";
import { compactDerivedFileIcon, normalizeOptionalPath } from "./path-utils";
import type { ImportLauncherItemsOptions, LauncherItem, ScannedAppInput } from "./types";

export type { ScannedAppInput };

export function compactImportedLauncherItem(item: LauncherItem): LauncherItem {
  return compactDerivedFileIcon(item);
}

export type NormalizedImportCategory = {
  items: LauncherItem[];
  refreshTargets: LauncherItemRef[];
};

export function normalizeImportedCategoryItems(
  categoryItems: LauncherItem[],
  options: ImportLauncherItemsOptions,
): NormalizedImportCategory {
  const refreshTargets: LauncherItemRef[] = [];
  const items = categoryItems.map((item) => {
    const normalizedImportedItem = normalizeImportedLauncherItem(
      item as LauncherItem & { originalIconBase64?: string | null },
      { cacheDerivedIcon: false },
    );
    const nextItem = compactImportedLauncherItem(applyCachedOriginalIcon(normalizedImportedItem));
    const importedHadDerivedIcon = shouldRefreshDerivedIcon(normalizedImportedItem);
    const stillMissingDerivedIcon =
      nextItem.itemType === "file" &&
      !nextItem.hasCustomIcon &&
      !nextItem.iconBase64 &&
      !!nextItem.path.trim();
    if (options.refreshDerivedIcons && (importedHadDerivedIcon || stillMissingDerivedIcon)) {
      refreshTargets.push({ categoryId: "", itemId: nextItem.id });
    }
    return nextItem;
  });
  return { items, refreshTargets };
}

/** Fill categoryId on refresh targets after the caller knows the category. */
export function withCategoryId(
  targets: LauncherItemRef[],
  categoryId: string,
): LauncherItemRef[] {
  return targets.map((t) => ({ ...t, categoryId }));
}

export type ScannedAppUpsertPayload = {
  name: string;
  path?: string;
  url?: string;
  itemType: "file" | "url";
  isDirectory: boolean;
  iconBase64: string | null;
  hasCustomIcon: boolean;
};

export type ScannedAppInsertPlan = {
  categoryName: string;
  launchType: ScannedLaunchType;
  launcherPath: string | null;
  launcherUrl: string | null;
  upsert: ScannedAppUpsertPayload;
  fallbackItemWithoutId: Omit<LauncherItem, "id">;
};

/**
 * Pure conversion: scanned installed-app record → classification name + upsert payload.
 * Category creation is left to the store (needs category store mutation).
 */
export function buildScannedAppInsertPlan(scannedApp: ScannedAppInput): ScannedAppInsertPlan {
  const launchType = getScannedLaunchType(scannedApp);
  const launcherPath = getScannedLauncherFilePath(scannedApp);
  const launcherUrl = getScannedLauncherUrl(scannedApp);
  const classificationPath = launcherPath || scannedApp.path;
  const normalized = normalizeApp({
    name: scannedApp.name,
    path: classificationPath,
    icon_base64: scannedApp.iconBase64,
    source: scannedApp.source,
    publisher: scannedApp.publisher,
  });
  const classification = classifyInstalledApp(normalized);
  const categoryName = classification.rule.name || "其他";
  const isFile = launchType === "file";

  return {
    categoryName,
    launchType,
    launcherPath,
    launcherUrl,
    upsert: {
      name: scannedApp.name,
      path: isFile ? launcherPath ?? undefined : undefined,
      url: isFile ? undefined : launcherUrl ?? undefined,
      itemType: isFile ? "file" : "url",
      isDirectory: false,
      iconBase64: scannedApp.iconBase64,
      hasCustomIcon: false,
    },
    fallbackItemWithoutId: {
      name: scannedApp.name,
      path: isFile ? launcherPath : "",
      resolvedPath: isFile ? normalizeOptionalPath(launcherPath) : undefined,
      url: isFile ? undefined : launcherUrl,
      itemType: isFile ? "file" : "url",
      isDirectory: false,
      iconBase64: scannedApp.iconBase64,
      hasCustomIcon: false,
      launchDependencies: [],
      launchDelaySeconds: 0,
    },
  };
}

export function normalizeHasCustomIconFlag(value: boolean | undefined): boolean {
  return normalizeHasCustomIcon(value);
}
