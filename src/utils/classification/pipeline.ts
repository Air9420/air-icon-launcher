import type { NormalizedApp, CategoryKey, Candidate, ClassificationResult, CategoryOverride } from "./types";
import { normalizeTextForMatching, matchPublisher } from "./normalizer";
import { lookupExeMap } from "./exe-map";
import { CATEGORY_RULES, CATEGORY_BY_KEY, FALLBACK_CATEGORY } from "./rules";
import { PATH_HEURISTICS } from "./heuristics";

const DELTA_THRESHOLD = 0.15;

const NON_LAUNCHABLE_TERMS = [
    "runtime", "redistributable", "sdk", "driver", "update helper",
    "vc_redist", "directx", ".net framework", "visual c++",
    "component", "helper", "service", "daemon",
];

function isLikelyNonLaunchableItem(app: NormalizedApp): boolean {
    const nameLower = app.name.toLowerCase();
    for (const term of NON_LAUNCHABLE_TERMS) {
        if (nameLower.includes(term)) return true;
    }
    for (const token of app.pathTokens) {
        for (const term of NON_LAUNCHABLE_TERMS) {
            if (token.includes(term)) return true;
        }
    }
    return false;
}

function layer0_ComponentCheck(app: NormalizedApp): ClassificationResult | null {
    if (!isLikelyNonLaunchableItem(app)) return null;
    return {
        rule: CATEGORY_BY_KEY.get("component") || FALLBACK_CATEGORY,
        reason: "命中组件特征：运行库/后台工具",
        confidence: 0.95,
        app,
    };
}

function layer1_HardMatch(app: NormalizedApp): CategoryKey | null {
    const exeCategory = lookupExeMap(app.exeName);
    if (exeCategory) return exeCategory;

    for (const rule of CATEGORY_RULES) {
        if (rule.exactTerms?.some(term =>
            app.nameTokens.includes(normalizeTextForMatching(term))
        )) {
            return rule.key;
        }
    }

    return null;
}

function layer2_StrongSignals(app: NormalizedApp): Candidate[] {
    const candidates: Candidate[] = [];

    if (app.publisherToken) {
        for (const rule of CATEGORY_RULES) {
            if (rule.publisherKeywords?.some(kw =>
                matchPublisher(app.publisherToken!, normalizePublisher(kw))
            )) {
                candidates.push({
                    categoryKey: rule.key,
                    confidence: 0.9,
                    reason: `发行商匹配：${app.publisherToken}`,
                });
            }
        }
    }

    for (const rule of CATEGORY_RULES) {
        if (rule.pathKeywords?.some(kw =>
            app.pathTokens.includes(normalizeTextForMatching(kw))
        )) {
            if (!candidates.some(c => c.categoryKey === rule.key)) {
                candidates.push({
                    categoryKey: rule.key,
                    confidence: 0.7,
                    reason: `安装路径匹配`,
                });
            }
        }
    }

    return candidates;
}

function resolveLayer2(candidates: Candidate[]): CategoryKey | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].categoryKey;

    candidates.sort((a, b) => b.confidence - a.confidence);

    if (candidates[0].confidence - candidates[1].confidence >= DELTA_THRESHOLD) {
        return candidates[0].categoryKey;
    }

    return null;
}

function layer3_SoftScoring(
    app: NormalizedApp,
    tiedCandidates?: Candidate[]
): { categoryKey: CategoryKey; reason: string } {
    let bestRule = FALLBACK_CATEGORY;
    let bestScore = 0;
    let bestReason = "未命中特征词，先归到其他";

    const candidateKeys = tiedCandidates?.map(c => c.categoryKey);
    const rules = candidateKeys
        ? CATEGORY_RULES.filter(r => candidateKeys.includes(r.key))
        : CATEGORY_RULES;

    for (const rule of rules) {
        const matchedSignals = new Set<string>();

        (rule.keywords || []).forEach(kw => {
            const normalized = normalizeTextForMatching(kw);
            if (app.nameTokens.includes(normalized)) {
                matchedSignals.add(normalized);
            }
        });

        (rule.pathKeywords || []).forEach(kw => {
            const normalized = normalizeTextForMatching(kw);
            if (app.pathTokens.includes(normalized)) {
                matchedSignals.add(normalized);
            }
        });

        const score = matchedSignals.size * 24;

        if (score > bestScore) {
            bestRule = rule;
            bestScore = score;
            const matchedKeywords = (rule.keywords || []).filter(kw =>
                app.nameTokens.includes(normalizeTextForMatching(kw))
            );
            bestReason = matchedKeywords.length > 0
                ? `关键词匹配：${matchedKeywords.slice(0, 2).join(" / ")}`
                : bestReason;
        }
    }

    return { categoryKey: bestRule.key, reason: bestReason };
}

function normalizePublisher(raw: string): string {
    return raw
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\b(inc|llc|ltd|gmbh|co|corp|corporation|limited|s\.?r\.?o|pvt|ab|sa|nv|bv|ag|kg)\b/g, "")
        .replace(/[.,]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

let _lookupOverride: ((app: NormalizedApp) => CategoryOverride | null) | null = null;

export function setOverrideLookupFn(fn: (app: NormalizedApp) => CategoryOverride | null): void {
    _lookupOverride = fn;
}

export function initOverrideLookupFromStore(): void {
    import("../../stores/overrideStore").then(({ useOverrideStore }) => {
        const store = useOverrideStore();
        setOverrideLookupFn((app: NormalizedApp) => store.lookupOverride(app));
    });
}

export function classifyInstalledApp(app: NormalizedApp): ClassificationResult {
    const layer0 = layer0_ComponentCheck(app);
    if (layer0) return layer0;

    if (_lookupOverride) {
        const override = _lookupOverride(app);
        if (override) {
            const effectiveConfidence = getEffectiveConfidence(override);
            if (override.source === "ai" && effectiveConfidence < 0.8) {
                const hardMatch = layer1_HardMatch(app);
                if (hardMatch) {
                    return {
                        rule: CATEGORY_BY_KEY.get(hardMatch) || FALLBACK_CATEGORY,
                        reason: "硬匹配优先于AI建议",
                        confidence: 1.0,
                        app,
                    };
                }
            }
            return {
                rule: CATEGORY_BY_KEY.get(override.categoryKey) || FALLBACK_CATEGORY,
                reason: override.source === "user" ? "用户手动修正" : "AI 建议修正",
                confidence: effectiveConfidence,
                app,
            };
        }
    }

    const hardMatch = layer1_HardMatch(app);
    if (hardMatch) {
        return {
            rule: CATEGORY_BY_KEY.get(hardMatch) || FALLBACK_CATEGORY,
            reason: buildHardMatchReason(app),
            confidence: 1.0,
            app,
        };
    }

    const candidates = layer2_StrongSignals(app);
    const resolved = resolveLayer2(candidates);
    if (resolved) {
        const best = candidates.find(c => c.categoryKey === resolved)!;
        return {
            rule: CATEGORY_BY_KEY.get(resolved) || FALLBACK_CATEGORY,
            reason: best.reason,
            confidence: best.confidence,
            app,
        };
    }

    for (const heuristic of PATH_HEURISTICS) {
        if (app.pathTokens.includes(heuristic.pathToken)) {
            return {
                rule: CATEGORY_BY_KEY.get(heuristic.categoryKey) || FALLBACK_CATEGORY,
                reason: heuristic.reason,
                confidence: 0.3,
                app,
            };
        }
    }

    const softResult = layer3_SoftScoring(
        app,
        candidates.length > 0 ? candidates : undefined
    );
    if (softResult.categoryKey !== "other") {
        return {
            rule: CATEGORY_BY_KEY.get(softResult.categoryKey) || FALLBACK_CATEGORY,
            reason: softResult.reason,
            confidence: 0.5,
            app,
        };
    }

    return {
        rule: FALLBACK_CATEGORY,
        reason: "未命中特征词，先归到其他",
        confidence: 0,
        app,
    };
}

function buildHardMatchReason(app: NormalizedApp): string {
    const exeCategory = lookupExeMap(app.exeName);
    if (exeCategory) return `可执行文件匹配：${app.exeName}`;

    for (const rule of CATEGORY_RULES) {
        const matched = rule.exactTerms?.find(term =>
            app.nameTokens.includes(normalizeTextForMatching(term))
        );
        if (matched) return `精确匹配：${matched}`;
    }

    return "硬匹配";
}

function getEffectiveConfidence(override: CategoryOverride): number {
    const now = Date.now();
    const days = (now - override.lastUsedAt) / (24 * 60 * 60 * 1000);
    return override.confidence * Math.pow(override.decayFactor, days);
}
