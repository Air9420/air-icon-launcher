import type { NormalizedApp } from "./types";

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return (hash >>> 0).toString(36);
}

const AI_CACHE = new Map<string, string>();

const MAX_CACHE_SIZE = 500;

function getAICacheKey(app: NormalizedApp): string {
    return simpleHash(app.nameTokens.join(" ") + "|" + (app.publisherToken || ""));
}

export function getCachedAICategory(app: NormalizedApp): string | null {
    const key = getAICacheKey(app);
    return AI_CACHE.get(key) || null;
}

export function setCachedAICategory(app: NormalizedApp, categoryKey: string): void {
    const key = getAICacheKey(app);
    AI_CACHE.set(key, categoryKey);

    if (AI_CACHE.size > MAX_CACHE_SIZE) {
        const firstKey = AI_CACHE.keys().next().value;
        if (firstKey !== undefined) {
            AI_CACHE.delete(firstKey);
        }
    }
}

export function clearAICache(): void {
    AI_CACHE.clear();
}

export function getAICacheSize(): number {
    return AI_CACHE.size;
}
