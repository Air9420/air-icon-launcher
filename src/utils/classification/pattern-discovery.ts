import type { CategoryOverride, CategoryKey } from "./types";

export type ProposedRule = {
    type: "publisher" | "exe" | "keyword";
    value: string;
    categoryKey: CategoryKey;
    confidence: number;
    evidence: string[];
};

type PatternAccumulator = {
    type: ProposedRule["type"];
    value: string;
    categoryKey: CategoryKey;
    confidence: number;
    evidence: string[];
};

const MIN_EVIDENCE_COUNT = 3;
const MIN_PATTERN_CONFIDENCE = 0.7;
const CONFIDENCE_INCREMENT = 0.1;
const INITIAL_PATTERN_CONFIDENCE = 0.3;

export function discoverPatterns(
    overrides: CategoryOverride[],
    getAppByOverrideKey: (key: string) => { name: string; publisherToken: string | null; exeName: string; nameTokens: string[] } | null
): ProposedRule[] {
    const patterns = new Map<string, PatternAccumulator>();

    for (const override of overrides) {
        if (override.source !== "ai") continue;

        const app = getAppByOverrideKey(override.key);
        if (!app) continue;

        if (app.publisherToken) {
            const patternKey = `publisher:${app.publisherToken}:${override.categoryKey}`;
            const existing = patterns.get(patternKey);
            if (existing) {
                existing.confidence += CONFIDENCE_INCREMENT;
                if (!existing.evidence.includes(app.name)) {
                    existing.evidence.push(app.name);
                }
            } else {
                patterns.set(patternKey, {
                    type: "publisher",
                    value: app.publisherToken,
                    categoryKey: override.categoryKey,
                    confidence: INITIAL_PATTERN_CONFIDENCE,
                    evidence: [app.name],
                });
            }
        }

        if (app.exeName) {
            const exeBase = app.exeName.replace(/\.exe$/i, "").replace(/(64|32)$/i, "");
            if (exeBase) {
                const patternKey = `exe:${exeBase}:${override.categoryKey}`;
                const existing = patterns.get(patternKey);
                if (existing) {
                    existing.confidence += CONFIDENCE_INCREMENT;
                    if (!existing.evidence.includes(app.name)) {
                        existing.evidence.push(app.name);
                    }
                } else {
                    patterns.set(patternKey, {
                        type: "exe",
                        value: exeBase,
                        categoryKey: override.categoryKey,
                        confidence: INITIAL_PATTERN_CONFIDENCE,
                        evidence: [app.name],
                    });
                }
            }
        }

        for (const token of app.nameTokens.slice(0, 3)) {
            if (token.length < 3) continue;
            const patternKey = `keyword:${token}:${override.categoryKey}`;
            const existing = patterns.get(patternKey);
            if (existing) {
                existing.confidence += CONFIDENCE_INCREMENT * 0.5;
                if (!existing.evidence.includes(app.name)) {
                    existing.evidence.push(app.name);
                }
            } else {
                patterns.set(patternKey, {
                    type: "keyword",
                    value: token,
                    categoryKey: override.categoryKey,
                    confidence: INITIAL_PATTERN_CONFIDENCE * 0.5,
                    evidence: [app.name],
                });
            }
        }
    }

    return [...patterns.values()].filter(
        p => p.confidence >= MIN_PATTERN_CONFIDENCE && p.evidence.length >= MIN_EVIDENCE_COUNT
    );
}
