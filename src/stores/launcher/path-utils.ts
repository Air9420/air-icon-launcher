import { normalizeHasCustomIcon } from "../../composables/useItemsHelper";
import type { LauncherItem } from "./types";

export function normalizeOptionalPath(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function compactDerivedFileIcon(item: LauncherItem): LauncherItem {
  if (item.itemType !== "file") return item;
  if (normalizeHasCustomIcon(item.hasCustomIcon)) return item;
  return { ...item, iconBase64: null, hasCustomIcon: false };
}

export function isLnkPath(path: string | null | undefined): boolean {
  const normalizedPath = normalizeOptionalPath(path);
  return !!normalizedPath && normalizedPath.toLowerCase().endsWith(".lnk");
}
