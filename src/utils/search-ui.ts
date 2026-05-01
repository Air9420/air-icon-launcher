import type { LauncherItem } from "../types/config";

export function getSearchShortcutIndex(code: string, key: string): number | null {
  if (code === "Digit1" || code === "Numpad1" || key === "1") return 0;
  if (code === "Digit2" || code === "Numpad2" || key === "2") return 1;
  if (code === "Digit3" || code === "Numpad3" || key === "3") return 2;
  if (code === "Digit4" || code === "Numpad4" || key === "4") return 3;
  if (code === "Digit5" || code === "Numpad5" || key === "5") return 4;
  if (code === "Digit6" || code === "Numpad6" || key === "6") return 5;
  if (code === "Digit7" || code === "Numpad7" || key === "7") return 6;
  if (code === "Digit8" || code === "Numpad8" || key === "8") return 7;
  if (code === "Digit9" || code === "Numpad9" || key === "9") return 8;
  if (code === "Digit0" || code === "Numpad0" || key === "0") return 9;
  return null;
}

export function getHotkeyForIndex(index: number): string {
  return index === 9 ? "0" : `${index + 1}`;
}

export function getHomeShortcutTarget(
  shortcutIndex: number,
  pinnedCount: number,
  recentCount: number
): { type: "pinned" | "recent"; index: number } | null {
  if (shortcutIndex < 0) return null;

  if (shortcutIndex < pinnedCount) {
    return { type: "pinned", index: shortcutIndex };
  }

  const recentIndex = shortcutIndex - pinnedCount;
  if (recentIndex < recentCount) {
    return { type: "recent", index: recentIndex };
  }

  return null;
}
