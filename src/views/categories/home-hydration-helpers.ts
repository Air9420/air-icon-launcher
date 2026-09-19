import type { PinnedMergedItem, RecentUsedMergedItem } from "../../stores";
import type { HomeRecentDisplayItem } from "../../composables/useHomePageState";

export function normalizePathForCompare(path: string): string {
    return path.replace(/\//g, "\\").trim().toLowerCase();
}

export function hasSameRecentKeyOrder(
    prev: HomeRecentDisplayItem[],
    next: HomeRecentDisplayItem[]
): boolean {
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i += 1) {
        if (prev[i]?.key !== next[i]?.key) {
            return false;
        }
    }
    return true;
}

export function isExternalToInternalPathReplacement(
    prev: HomeRecentDisplayItem[],
    next: HomeRecentDisplayItem[]
): boolean {
    if (prev.length !== next.length || prev.length === 0) {
        return false;
    }

    let replacementCount = 0;
    for (let i = 0; i < prev.length; i += 1) {
        const prevItem = prev[i];
        const nextItem = next[i];
        if (!prevItem || !nextItem) {
            return false;
        }
        if (prevItem.key === nextItem.key) {
            continue;
        }

        if (!("external" in prevItem) || !("recent" in nextItem)) {
            return false;
        }

        const prevPath = normalizePathForCompare(prevItem.external.path);
        const nextPath = normalizePathForCompare(nextItem.item.path);
        if (!prevPath || !nextPath || prevPath !== nextPath) {
            return false;
        }
        replacementCount += 1;
    }

    return replacementCount > 0;
}

export function isExternalRecentItem(
    item: HomeRecentDisplayItem
): item is Exclude<HomeRecentDisplayItem, RecentUsedMergedItem> {
    return "external" in item;
}

export function collectVisibleHomeHydrationTargets(
    pinned: PinnedMergedItem[],
    recent: HomeRecentDisplayItem[],
    limits: { pinned: number; recent: number }
): Array<{ categoryId: string; itemId: string }> {
    return [
        ...pinned
            .slice(0, limits.pinned)
            .map((item) => ({
                categoryId: item.primaryCategoryId,
                itemId: item.item.id,
            })),
        ...recent
            .slice(0, limits.recent)
            .filter((item): item is Extract<HomeRecentDisplayItem, RecentUsedMergedItem> => "recent" in item)
            .map((item) => ({
                categoryId: item.recent.categoryId,
                itemId: item.item.id,
            })),
    ];
}

export function resolveVisibleIconMaxEdge(selector: string): number | undefined {
    const iconNode = document.querySelector<HTMLElement>(selector);
    if (!iconNode) return undefined;
    const rect = iconNode.getBoundingClientRect();
    const edge = Math.max(rect.width, rect.height);
    if (edge <= 0) return undefined;
    return Math.max(32, Math.min(256, Math.round(edge)));
}

export function getSearchResultIconMaxEdge(): number | undefined {
    return resolveVisibleIconMaxEdge(".search-result-item .result-icon");
}

export function getHomeIconMaxEdge(): number | undefined {
    return resolveVisibleIconMaxEdge('.home-card[data-home-section] .home-card-icon');
}

export function queryVisibleNodes(selector: string): HTMLElement[] {
    if (typeof document === "undefined") {
        return [];
    }

    const viewportTop = 0;
    const viewportBottom = window.innerHeight;
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.bottom > viewportTop && rect.top < viewportBottom;
        });
}

export function collectVisibleSearchResultTargets(): Array<{ categoryId: string; itemId: string }> {
    return queryVisibleNodes('.search-result-list .search-result-item[data-item-id][data-category-id]')
        .map((node) => {
            const categoryId = node.dataset.categoryId?.trim() ?? "";
            const itemId = node.dataset.itemId?.trim() ?? "";
            if (!categoryId || !itemId) return null;
            return { categoryId, itemId };
        })
        .filter((target): target is { categoryId: string; itemId: string } => !!target);
}

export function collectVisibleRecentFileResultPaths(): string[] {
    return queryVisibleNodes('.search-result-list .search-result-item[data-menu-type="Search-Recent-File-Item"][data-item-path]')
        .map((node) => node.dataset.itemPath?.trim() ?? "")
        .filter((path) => !!path);
}

export function getDocumentVisibilityHints() {
    if (typeof document === "undefined") {
        return {};
    }

    return {
        documentVisibilityState: document.visibilityState === "hidden" ? "hidden" : "visible",
        documentHasFocus: document.hasFocus(),
    } as const;
}
