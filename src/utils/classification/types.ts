export type CategoryKey = string;

export type NormalizedApp = {
    name: string;
    path: string;
    icon_base64: string | null;
    source: string;
    publisher: string | null;
    nameTokens: string[];
    pathTokens: string[];
    publisherToken: string | null;
    exeName: string;
};

export type CategoryRule = {
    key: CategoryKey;
    name: string;
    description: string;
    exactTerms?: string[];
    keywords?: string[];
    pathKeywords?: string[];
    publisherKeywords?: string[];
};

export type Candidate = {
    categoryKey: CategoryKey;
    confidence: number;
    reason: string;
};

export type ClassificationResult = {
    rule: CategoryRule;
    reason: string;
    confidence: number;
    app: NormalizedApp;
};

export type PathHeuristic = {
    pathToken: string;
    categoryKey: CategoryKey;
    reason: string;
};

export type CategoryOverride = {
    key: string;
    categoryKey: CategoryKey;
    confidence: number;
    source: "user" | "ai";
    createdAt: number;
    lastUsedAt: number;
    hitCount: number;
    decayFactor: number;
};
