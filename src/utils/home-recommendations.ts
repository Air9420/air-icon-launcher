type KeyedItem = {
  key: string;
};

export function getRecentRecommendationTailQuota(recentLimit: number): number {
  if (recentLimit <= 0) return 0;
  return Math.max(1, Math.floor(recentLimit / 3));
}

export function splitRecentDisplayItems<T extends KeyedItem>(
  recentItems: readonly T[],
  timeCandidates: readonly T[],
  recentLimit: number,
  tailQuota: number = getRecentRecommendationTailQuota(recentLimit)
): {
  headItems: T[];
  tailItems: T[];
} {
  if (recentLimit <= 0) {
    return { headItems: [], tailItems: [] };
  }

  const maxTailCount = Math.min(recentLimit, tailQuota, timeCandidates.length);
  if (maxTailCount <= 0) {
    return {
      headItems: recentItems.slice(0, recentLimit),
      tailItems: [],
    };
  }

  for (let tailCount = maxTailCount; tailCount >= 1; tailCount -= 1) {
    const headCount = Math.max(0, recentLimit - tailCount);
    const visibleHeadItems = recentItems.slice(0, headCount);
    const visibleHeadKeys = new Set(visibleHeadItems.map((item) => item.key));
    const emittedTailKeys = new Set<string>();
    const tailItems: T[] = [];

    for (const candidate of timeCandidates) {
      if (visibleHeadKeys.has(candidate.key) || emittedTailKeys.has(candidate.key)) {
        continue;
      }

      tailItems.push(candidate);
      emittedTailKeys.add(candidate.key);

      if (tailItems.length === tailCount) {
        return {
          headItems: visibleHeadItems,
          tailItems,
        };
      }
    }
  }

  return {
    headItems: recentItems.slice(0, recentLimit),
    tailItems: [],
  };
}
