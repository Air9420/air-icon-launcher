import type { NormalizedApp } from "./types";

export function normalizePublisher(raw: string): string {
    return raw
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\b(inc|llc|ltd|gmbh|co|corp|corporation|limited|s\.?r\.?o|pvt|ab|sa|nv|bv|ag|kg)\b/g, "")
        .replace(/[.,]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function cleanToken(token: string): string {
    return token
        .replace(/\d+(\.\d+)*/g, "")
        .replace(/(x64|x86|win64|win32)/gi, "")
        .trim();
}

export function normalizeTextForMatching(text: string): string {
    return text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[()[\]{}\-_.]/g, " ")
        .split(/\s+/)
        .map(cleanToken)
        .filter(t => t.length > 0)
        .join(" ");
}

export function extractExeName(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const filename = normalized.split("/").pop() || "";
    return filename.toLowerCase();
}

export function tokenizePath(path: string): string[] {
    return path
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .map(segment => normalizeTextForMatching(segment))
        .filter(t => t.length > 0);
}

export function tokenizeName(name: string): string[] {
    return normalizeTextForMatching(name)
        .split(" ")
        .filter(t => t.length > 0);
}

export function normalizeApp(raw: {
    name: string;
    path: string;
    icon_base64?: string | null;
    source: string;
    publisher?: string | null;
}): NormalizedApp {
    const publisherToken = raw.publisher
        ? normalizePublisher(raw.publisher)
        : null;

    return {
        name: raw.name,
        path: raw.path,
        icon_base64: raw.icon_base64 ?? null,
        source: raw.source,
        publisher: raw.publisher ?? null,
        nameTokens: tokenizeName(raw.name),
        pathTokens: tokenizePath(raw.path),
        publisherToken: publisherToken && publisherToken.length > 0 ? publisherToken : null,
        exeName: extractExeName(raw.path),
    };
}

export function matchPublisher(publisher: string, keyword: string): boolean {
    const pubTokens = publisher.split(" ");
    const kwTokens = keyword.split(" ");
    return kwTokens.every(t => pubTokens.includes(t));
}
