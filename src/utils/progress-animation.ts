export const UPDATE_PROGRESS_ANIMATION_MS = 650;

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function getSmoothedProgressFrame(
  current: number,
  target: number,
  elapsedMs: number,
  durationMs = UPDATE_PROGRESS_ANIMATION_MS,
): number {
  const safeCurrent = clampProgress(current);
  const safeTarget = clampProgress(target);

  if (safeTarget <= safeCurrent || durationMs <= 0) {
    return safeTarget;
  }

  if (elapsedMs >= durationMs) {
    return safeTarget;
  }

  const ratio = Math.min(1, Math.max(0, elapsedMs / durationMs));
  const eased = 1 - Math.pow(1 - ratio, 3);
  return Math.min(safeTarget, clampProgress(safeCurrent + (safeTarget - safeCurrent) * eased));
}
