function clampProgress(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(100, Math.max(0, value));
}

export function getSmoothedProgress(
    currentProgress: number,
    targetProgress: number,
    maxStep: number
): number {
    const current = clampProgress(currentProgress);
    const target = clampProgress(targetProgress);
    const step = clampProgress(maxStep);

    if (target <= current || step === 0) {
        return current;
    }

    return Math.min(target, current + step);
}
