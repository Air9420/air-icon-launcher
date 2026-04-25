export type { NormalizedApp, CategoryRule, Candidate, ClassificationResult, PathHeuristic, CategoryOverride, CategoryKey } from "./types";
export { normalizeApp, normalizePublisher, normalizeTextForMatching, matchPublisher, cleanToken } from "./normalizer";
export { EXE_MAP, lookupExeMap } from "./exe-map";
export { CATEGORY_RULES, CATEGORY_BY_KEY, FALLBACK_CATEGORY } from "./rules";
export { PATH_HEURISTICS } from "./heuristics";
export { classifyInstalledApp, setOverrideLookupFn } from "./pipeline";
