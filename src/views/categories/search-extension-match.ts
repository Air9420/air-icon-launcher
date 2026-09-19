/** Pure keyword/match helpers for home search extensions (clipboard / recent-file / commands). */

export function normalizePathKey(path: string): string {
    return path.trim().replace(/\//g, "\\").toLowerCase();
}

export function normalizeKeywordTokens(keyword: string): string[] {
    return keyword
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}

export function includesAllTokens(target: string, tokens: string[]): boolean {
    if (tokens.length === 0) return false;
    const haystack = target.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
}

export function fuzzyMatchWithGapLimit(target: string, keyword: string, maxGap: number): boolean {
    let lastMatchIndex = -1;
    for (let i = 0; i < keyword.length; i += 1) {
        const ch = keyword[i];
        const nextIndex = target.indexOf(ch, lastMatchIndex + 1);
        if (nextIndex === -1) return false;
        if (lastMatchIndex >= 0 && nextIndex - lastMatchIndex - 1 > maxGap) {
            return false;
        }
        lastMatchIndex = nextIndex;
    }
    return true;
}

export function buildWordInitials(text: string): string {
    const source = text.toLowerCase();
    let initials = "";
    let prevIsAlnum = false;

    for (const ch of source) {
        const isAlnum = /[a-z0-9]/.test(ch);
        if (!isAlnum) {
            prevIsAlnum = false;
            continue;
        }
        if (!prevIsAlnum) {
            initials += ch;
        }
        prevIsAlnum = true;
    }

    return initials;
}

export function extensionMatchRank(type: "exact" | "prefix" | "substring" | "fuzzy"): number {
    switch (type) {
        case "exact":
            return 0;
        case "prefix":
            return 1;
        case "substring":
            return 2;
        case "fuzzy":
        default:
            return 3;
    }
}

export function resolveExtensionMatchType(
    rawTarget: string,
    tokens: string[]
): "exact" | "prefix" | "substring" | "fuzzy" | null {
    if (tokens.length === 0) return null;
    const target = rawTarget.trim().toLowerCase();
    const keyword = tokens.join(" ").trim().toLowerCase();
    if (!target || !keyword) return null;
    if (target === keyword) return "exact";
    if (target.startsWith(keyword)) return "prefix";
    if (includesAllTokens(target, tokens)) return "substring";
    if (tokens.length !== 1) return null;
    if (keyword.length < 3) return null;

    const compactTarget = target.replace(/[\s._\\/-]+/g, "");
    const compactKeyword = keyword.replace(/[\s._\\/-]+/g, "");
    if (compactKeyword.length < 3) return null;
    if (compactTarget.includes(compactKeyword)) return "substring";

    if (compactKeyword.length === 3) {
        const initials = buildWordInitials(rawTarget);
        if (initials.includes(compactKeyword)) {
            return "fuzzy";
        }
        return null;
    }

    if (fuzzyMatchWithGapLimit(compactTarget, compactKeyword, 2)) {
        return "fuzzy";
    }
    return null;
}

export function buildClipboardPreview(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized) return "空文本";
    if (normalized.length <= 70) return normalized;
    return `${normalized.slice(0, 70)}...`;
}
