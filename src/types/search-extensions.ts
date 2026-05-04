export type ExtensionSearchMatchType = "exact" | "prefix" | "substring" | "fuzzy";

export type ClipboardSearchResult = {
    key: string;
    id: string;
    hash: string;
    contentType: "text" | "image";
    textContent: string;
    imagePath: string | null;
    timestamp: number;
    preview: string;
    matchType?: ExtensionSearchMatchType;
};

export type RecentFileSearchResult = {
    key: string;
    name: string;
    path: string;
    usedAt: number;
    iconBase64: string | null;
    matchType?: ExtensionSearchMatchType;
};
