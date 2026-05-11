import type { ScannedAppEntry } from "../types/scan-cache";

export type ScannedLaunchType = "file" | "shell" | "protocol";
export type LauncherUrlKind = "web" | "app" | "protocol";

export type ScannedLaunchTarget = {
  path: string;
  source?: string;
  targetPath?: string | null;
  launchType?: ScannedLaunchType | null;
};

export function isAbsoluteWindowsPath(value: string): boolean {
  const trimmed = value.trim();
  return /^[a-z]:[\\/]/i.test(trimmed) || /^\\\\/.test(trimmed);
}

export function hasUriScheme(value: string): boolean {
  const trimmed = value.trim();
  if (isAbsoluteWindowsPath(trimmed)) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

export function isScannedShellLaunchTarget(value: string, source?: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^shell:AppsFolder\\/i.test(trimmed)) return true;
  if (/^\{[0-9a-f-]+\}\\/i.test(trimmed)) return true;
  if (/^Microsoft\./i.test(trimmed)) return true;
  if (/^[^\\/:]+![^\\/:]+$/i.test(trimmed)) return true;
  if (targetHasFileExtension(trimmed)) return false;
  if (
    source === "应用目录" &&
    !isAbsoluteWindowsPath(trimmed) &&
    !hasUriScheme(trimmed) &&
    !targetHasFileExtension(trimmed)
  ) {
    return true;
  }
  return false;
}

function targetHasFileExtension(value: string): boolean {
  return /\.(exe|lnk|cmd|bat|appref-ms)$/i.test(value.trim());
}

export function getScannedLaunchType(entry: ScannedLaunchTarget): ScannedLaunchType {
  if (entry.launchType === "file" || entry.launchType === "shell" || entry.launchType === "protocol") {
    return entry.launchType;
  }
  if (isScannedShellLaunchTarget(entry.path, entry.source)) return "shell";
  if (hasUriScheme(entry.path)) return "protocol";
  return "file";
}

export function getScannedLaunchCommandTarget(entry: ScannedLaunchTarget): string {
  const launchType = getScannedLaunchType(entry);
  if (launchType === "file") {
    return entry.targetPath?.trim() || entry.path.trim();
  }
  return entry.path.trim();
}

export function getScannedLauncherFilePath(entry: ScannedLaunchTarget): string {
  return entry.targetPath?.trim() || entry.path.trim();
}

export function getScannedLauncherUrl(entry: ScannedLaunchTarget): string {
  const path = entry.path.trim();
  const launchType = getScannedLaunchType(entry);
  if (launchType !== "shell") return path;
  if (/^shell:AppsFolder\\/i.test(path)) return path;
  return `shell:AppsFolder\\${path}`;
}

export function getScannedIconLookupPath(entry: ScannedLaunchTarget): string {
  return entry.targetPath?.trim() || entry.path.trim();
}

export function normalizeScannedLaunchKey(entry: Pick<ScannedAppEntry, "path" | "source" | "targetPath" | "launchType">): string {
  const launchType = getScannedLaunchType(entry);
  const value = launchType === "file"
    ? getScannedLauncherFilePath(entry)
    : getScannedLauncherUrl(entry);
  return value.replace(/\\/g, "/").toLowerCase().trim();
}

export function getLauncherUrlKind(value?: string | null): LauncherUrlKind {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "web";
  if (isScannedShellLaunchTarget(trimmed, "应用目录")) return "app";
  if (/^https?:\/\//i.test(trimmed)) return "web";
  if (hasUriScheme(trimmed)) return "protocol";
  return "web";
}

export function getLauncherItemBadgeText(item: {
  itemType?: "file" | "url";
  url?: string | null;
  launchDependencies?: unknown[];
}): string {
  if (item.itemType === "url") {
    const kind = getLauncherUrlKind(item.url);
    if (kind === "app") return "应用";
    if (kind === "protocol") return "协议";
    return "URL";
  }
  if ((item.launchDependencies?.length ?? 0) > 0) return "依赖";
  return "";
}
