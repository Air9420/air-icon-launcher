import type { Category } from "./categoryStore";
import type { GlobalSearchMergedResult, LauncherItem, RustSearchResult } from "./launcherStore";

export function normalizeLauncherItemKey(item: Pick<LauncherItem, "path" | "name">): string | null {
    const normalizedPath = item.path?.trim().replace(/\\/g, "/").toLowerCase();
    const normalizedName = item.name?.trim().toLowerCase();
    return normalizedPath || normalizedName || null;
}

export function fuzzyMatchLauncherText(text: string, keyword: string): boolean {
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    if (lowerText.includes(lowerKeyword)) return true;
    let keywordIndex = 0;
    for (let i = 0; i < lowerText.length && keywordIndex < lowerKeyword.length; i++) {
        if (lowerText[i] === lowerKeyword[keywordIndex]) {
            keywordIndex++;
        }
    }
    return keywordIndex === lowerKeyword.length;
}

export function mergeLauncherItems(
    items: Array<{ item: LauncherItem; categoryId: string }>,
    getCategoryById: (categoryId: string) => Category | null
): GlobalSearchMergedResult[] {
    const map = new Map<
        string,
        {
            key: string;
            item: LauncherItem;
            primaryCategoryId: string;
            categoryIds: string[];
        }
    >();

    for (const entry of items) {
        const key = normalizeLauncherItemKey(entry.item);
        if (!key) continue;
        const existing = map.get(key);
        if (!existing) {
            map.set(key, {
                key,
                item: entry.item,
                primaryCategoryId: entry.categoryId,
                categoryIds: [entry.categoryId],
            });
            continue;
        }
        if (!existing.categoryIds.includes(entry.categoryId)) {
            existing.categoryIds.push(entry.categoryId);
        }
    }

    return [...map.values()].map((entry) => ({
        key: entry.key,
        item: entry.item,
        primaryCategoryId: entry.primaryCategoryId,
        categories: entry.categoryIds
            .map((id) => getCategoryById(id))
            .filter((category): category is Category => category !== null),
    }));
}

export function mergeRustSearchResults(
    results: RustSearchResult[],
    getCategoryById: (categoryId: string) => Category | null,
    getLauncherItemById: (categoryId: string, itemId: string) => LauncherItem | null
): GlobalSearchMergedResult[] {
    return mergeLauncherItems(
        results
            .filter((result) => getCategoryById(result.category_id))
            .map((result) => ({
                categoryId: result.category_id,
                item:
                    getLauncherItemById(result.category_id, result.id) || {
                        id: result.id,
                        name: result.name,
                        path: result.path,
                        itemType: 'file' as const,
                        isDirectory: false,
                        iconBase64: null,
                        originalIconBase64: null,
                        launchDependencies: [],
                        launchDelaySeconds: 0,
                    },
            })),
        getCategoryById
    );
}
