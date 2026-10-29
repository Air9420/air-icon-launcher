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
/**
 * 定位后高亮闪烁的总时长。
 *
 * 必须与 `ClipboardHistoryItem.vue` 里 `animation` 的时长保持一致：
 * 该值控制何时移除 `is-anchor-flashing` 类，若短于 CSS 动画时长，
 * 动画会在播放到一半时被强行中断（看起来像「闪一下就没了」）。
 */
export const ANCHOR_FLASH_MS = 3000;
