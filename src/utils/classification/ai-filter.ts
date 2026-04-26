import type { ClassificationResult } from "./types";
import { matchPublisher, normalizePublisher } from "./normalizer";
import { lookupExeMap } from "./exe-map";
import { CATEGORY_RULES } from "./rules";

const AI_CONFIDENCE_THRESHOLD = 0.7;

const STRONG_NAME_TOKENS = ["studio", "editor", "manager", "browser", "player", "viewer", "converter", "downloader", "recorder", "cleaner"];

export function shouldSendToAI(result: ClassificationResult): boolean {
    if (result.confidence < AI_CONFIDENCE_THRESHOLD) return true;
    if (isSuspicious(result)) return true;
    return false;
}

export function isSuspicious(result: ClassificationResult): boolean {
    if (isPublisherCategoryConflict(result)) return true;
    if (isExeSemanticMismatch(result)) return true;
    if (isOtherWithStrongTokens(result)) return true;
    return false;
}

function isPublisherCategoryConflict(result: ClassificationResult): boolean {
    const app = result.app;
    if (!app.publisherToken) return false;

    for (const rule of CATEGORY_RULES) {
        if (rule.publisherKeywords?.some(kw =>
            matchPublisher(app.publisherToken!, normalizePublisher(kw))
        ) && rule.key !== result.rule.key) {
            return true;
        }
    }

    return false;
}

function isExeSemanticMismatch(result: ClassificationResult): boolean {
    const app = result.app;
    const exeCategory = lookupExeMap(app.exeName);
    if (exeCategory && exeCategory !== result.rule.key) {
        return true;
    }
    return false;
}

function isOtherWithStrongTokens(result: ClassificationResult): boolean {
    if (result.rule.key !== "other") return false;

    const app = result.app;
    if (app.nameTokens.some(t => STRONG_NAME_TOKENS.includes(t))) {
        return true;
    }
    return false;
}

export type SuspicionReport = {
    isSuspicious: boolean;
    signals: string[];
};

export function getSuspicionReport(result: ClassificationResult): SuspicionReport {
    const signals: string[] = [];

    if (isPublisherCategoryConflict(result)) {
        signals.push("Publisher 与分类冲突");
    }
    if (isExeSemanticMismatch(result)) {
        signals.push("exeName 强语义不匹配");
    }
    if (isOtherWithStrongTokens(result)) {
        signals.push("other 分类但含强 token");
    }

    return {
        isSuspicious: signals.length > 0,
        signals,
    };
}
