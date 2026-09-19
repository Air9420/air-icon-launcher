import { getRecordContent, type ClipboardRecord } from "../../stores/clipboardStore";
import type { ClipboardFilter, ClipboardGroupKey } from "./types";

export function looksLikeCode(content: string): boolean {
    const text = content.trim();
    if (!text) return false;

    const hasLineBreak = text.includes("\n");
    const codeKeywordPattern =
        /\b(const|let|var|function|class|import|export|return|if|else|for|while|try|catch|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i;
    const codeSymbolPattern = /[{}()[\];<>`]|=>|::|<\/?\w+>/;
    const hasCodeSignal = codeKeywordPattern.test(text) || codeSymbolPattern.test(text);

    return hasCodeSignal && (hasLineBreak || text.length >= 40);
}

export function getRecordGroupKey(record: ClipboardRecord): ClipboardGroupKey {
    if (record.content_type === "image") {
        return "image";
    }
    return looksLikeCode(getRecordContent(record)) ? "code" : "text";
}

export function getGroupLabel(group: ClipboardGroupKey): string {
    if (group === "favorites") return "已收藏";
    if (group === "text") return "文本";
    if (group === "code") return "代码";
    return "图片";
}

export function getRecordTypeLabel(record: ClipboardRecord): string {
    return getGroupLabel(getRecordGroupKey(record));
}

export function isFavorite(record: ClipboardRecord): boolean {
    return record.is_favorite;
}

export function matchesKeyword(record: ClipboardRecord, keyword: string): boolean {
    const typeLabel = getRecordTypeLabel(record).toLowerCase();
    if (typeLabel.includes(keyword)) return true;
    if (record.content_type === "image") {
        const imagePath = (record.image_path || "").toLowerCase();
        return imagePath.includes(keyword) || "图片".includes(keyword);
    }
    const content = getRecordContent(record).toLowerCase();
    return content.includes(keyword);
}

export function filterBySelection(
    records: ClipboardRecord[],
    selectedFilter: ClipboardFilter
): ClipboardRecord[] {
    if (selectedFilter === "favorites") {
        return records.filter((record) => isFavorite(record));
    }
    if (selectedFilter !== "all") {
        return records.filter((record) => getRecordGroupKey(record) === selectedFilter);
    }
    return records;
}
