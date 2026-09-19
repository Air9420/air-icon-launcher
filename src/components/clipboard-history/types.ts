import type { ClipboardRecord } from "../../stores/clipboardStore";

export type ClipboardFilter = "all" | "favorites" | "text" | "code" | "image";
export type ClipboardGroupKey = "favorites" | "text" | "code" | "image";
export type ClipboardTabRegion = "search" | "filter" | "content" | "none";

export type ClipboardGroup = {
    key: ClipboardGroupKey;
    label: string;
    items: ClipboardRecord[];
};

export const FILTER_OPTIONS: Array<{ key: ClipboardFilter; label: string }> = [
    { key: "all", label: "全部" },
    { key: "favorites", label: "收藏" },
    { key: "text", label: "文本" },
    { key: "code", label: "代码" },
    { key: "image", label: "图片" },
];

export const TEXT_PREVIEW_LENGTH = 180;
export const SCROLL_EDGE_PADDING = 12;
export const SCROLL_ANIMATION_MS = 460;
export const ANCHOR_FLASH_MS = 1000;
