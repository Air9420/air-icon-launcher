import { CATEGORY_RULES, CATEGORY_BY_KEY } from "./rules";

const MAX_CUSTOM_CATEGORIES = 12;
const SIMILARITY_THRESHOLD = 3;
const COOLDOWN_DAYS = 7;
const WEAK_CATEGORY_MIN_ITEMS = 3;
const WEAK_CATEGORY_MAX_AGE_DAYS = 14;

export type PendingCategory = {
    key: string;
    name: string;
    description: string;
    proposedBy: "ai";
    itemCount: number;
    sampleItems: string[];
    proposedAt: number;
};

function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }

    return dp[m][n];
}

export function isTooSimilar(a: string, b: string): boolean {
    if (a.includes(b) || b.includes(a)) return true;
    return levenshtein(a.toLowerCase(), b.toLowerCase()) < SIMILARITY_THRESHOLD;
}

export function findSimilarCategoryKey(newKey: string, existingKeys: string[]): string | null {
    for (const existing of existingKeys) {
        if (isTooSimilar(newKey, existing)) return existing;
    }
    return null;
}

export function canCreateCustomCategory(existingCustomCount: number): boolean {
    return existingCustomCount < MAX_CUSTOM_CATEGORIES;
}

export function isWithinCooldown(proposedAt: number, now: number = Date.now()): boolean {
    const daysSinceProposal = (now - proposedAt) / (24 * 60 * 60 * 1000);
    return daysSinceProposal < COOLDOWN_DAYS;
}

export function shouldRecycleWeakCategory(
    itemCount: number,
    createdAt: number,
    now: number = Date.now()
): boolean {
    if (itemCount >= WEAK_CATEGORY_MIN_ITEMS) return false;
    const ageDays = (now - createdAt) / (24 * 60 * 60 * 1000);
    return ageDays > WEAK_CATEGORY_MAX_AGE_DAYS;
}

export function validateNewCategory(
    key: string,
    name: string,
    description: string,
    customCategoryCount: number
): { valid: boolean; error?: string } {
    if (!key || key.length > 40) {
        return { valid: false, error: "分类 key 不能为空或超过 40 字符" };
    }
    if (!name || !description) {
        return { valid: false, error: "新分类必须有名称和描述" };
    }
    if (CATEGORY_BY_KEY.has(key)) {
        return { valid: false, error: `分类 ${key} 已存在` };
    }
    const similarKey = findSimilarCategoryKey(key, CATEGORY_RULES.map(r => r.key));
    if (similarKey) {
        return { valid: false, error: `新分类与已有分类 ${similarKey} 过于相似` };
    }
    if (!canCreateCustomCategory(customCategoryCount)) {
        return { valid: false, error: `自定义分类数量已达上限 ${MAX_CUSTOM_CATEGORIES}` };
    }
    return { valid: true };
}
