import type {
    GlobalSearchMergedResult,
    RustSearchMatchType,
} from "../stores/launcherStore";

export type SearchHighlightSegment = {
    text: string;
    highlighted: boolean;
};

export type SearchHistoryEntryLike = {
    keyword: string;
    displayKeyword?: string | null;
    lastUsedAt: number;
};

export type SearchSelectionTarget = {
    key?: string;
    itemId: string;
    primaryCategoryId: string;
};

export type HomeSearchViewState = "home" | "pending" | "results" | "fallback";

const DIRECT_MATCH_TYPES = new Set<RustSearchMatchType>([
    "exact",
    "prefix",
    "substring",
]);

export function buildSearchHighlightSegments(
    text: string,
    keyword: string,
    matchType: RustSearchMatchType
): SearchHighlightSegment[] {
    if (!text) {
        return [{ text: "", highlighted: false }];
    }

    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword || !DIRECT_MATCH_TYPES.has(matchType)) {
        return [{ text, highlighted: false }];
    }

    const lowerText = text.toLowerCase();
    const lowerKeyword = trimmedKeyword.toLowerCase();
    const matchStart = lowerText.indexOf(lowerKeyword);

    if (matchStart === -1) {
        return [{ text, highlighted: false }];
    }

    const matchEnd = matchStart + trimmedKeyword.length;
    const segments: SearchHighlightSegment[] = [];

    if (matchStart > 0) {
        segments.push({
            text: text.slice(0, matchStart),
            highlighted: false,
        });
    }

    segments.push({
        text: text.slice(matchStart, matchEnd),
        highlighted: true,
    });

    if (matchEnd < text.length) {
        segments.push({
            text: text.slice(matchEnd),
            highlighted: false,
        });
    }

    return segments;
}

export function getSearchMatchTypeLabel(matchType: RustSearchMatchType): string {
    switch (matchType) {
        case "exact":
            return "精确";
        case "prefix":
            return "前缀";
        case "substring":
            return "包含";
        case "pinyin_full":
            return "全拼";
        case "pinyin_initial":
            return "首字母";
        case "fuzzy":
        default:
            return "模糊";
    }
}

export function getRecentSearchHistoryEntries<T extends { lastUsedAt: number }>(
    entries: T[],
    limit: number = 8
): T[] {
    return [...entries]
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .slice(0, limit);
}

export function getSearchHistoryDisplayKeyword(
    entry: Pick<SearchHistoryEntryLike, "keyword" | "displayKeyword">
): string {
    const displayKeyword = entry.displayKeyword?.trim();
    return displayKeyword || entry.keyword;
}

export function createSearchSelectionTarget(
    result: Pick<GlobalSearchMergedResult, "key" | "primaryCategoryId"> & {
        item: Pick<GlobalSearchMergedResult["item"], "id">;
    }
): SearchSelectionTarget {
    return {
        key: result.key,
        itemId: result.item.id,
        primaryCategoryId: result.primaryCategoryId,
    };
}

export function findSearchSelectionIndex(
    results: Array<
        Pick<GlobalSearchMergedResult, "key" | "primaryCategoryId"> & {
            item: Pick<GlobalSearchMergedResult["item"], "id">;
        }
    >,
    target: SearchSelectionTarget | null
): number {
    if (!target) return -1;

    return results.findIndex((result) => {
        if (target.key && result.key === target.key) {
            return true;
        }

        return (
            result.item.id === target.itemId &&
            result.primaryCategoryId === target.primaryCategoryId
        );
    });
}

export function getHomeSearchViewState(
    keyword: string,
    resultCount: number,
    isPending: boolean
): HomeSearchViewState {
    if (!keyword.trim()) return "home";
    if (isPending) return "pending";
    return resultCount > 0 ? "results" : "fallback";
}

export function getSearchShortcutIndex(event: Pick<KeyboardEvent, "key" | "code">): number | null {
    if (event.code?.startsWith("Digit")) {
        const value = Number(event.code.slice(5));
        return value >= 1 && value <= 9 ? value - 1 : null;
    }

    if (event.code?.startsWith("Numpad")) {
        const value = Number(event.code.slice(6));
        return value >= 1 && value <= 9 ? value - 1 : null;
    }

    const value = Number(event.key);
    return Number.isInteger(value) && value >= 1 && value <= 9 ? value - 1 : null;
}
