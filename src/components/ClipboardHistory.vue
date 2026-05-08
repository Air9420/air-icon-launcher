<template>
    <div
        ref="clipboardHistoryRef"
        class="clipboard-history"
        data-tauri-drag-region
        data-menu-type="Clipboard-History-View"
    >
        <header class="clipboard-header" data-tauri-drag-region>
            <button class="back-btn" type="button" @click="onBack" @mousedown.stop>
                返回
            </button>
            <div class="title" data-tauri-drag-region>剪贴板历史</div>
            <button
                class="clear-btn"
                type="button"
                @click="onClearAll"
                @mousedown.stop
                :disabled="history.length === 0"
            >
                清空
            </button>
        </header>

        <div class="toolbar" v-if="history.length > 0">
            <div
                class="search-wrap"
                :class="{ 'is-keyboard-focus': tabRegion === 'search' }"
            >
                <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                    ref="searchInputRef"
                    v-model="searchKeyword"
                    type="text"
                    class="search-input"
                    placeholder="搜索文本、代码、图片路径"
                    @keydown.escape.prevent.stop="clearSearchKeyword"
                />
                <button
                    v-if="searchKeyword"
                    type="button"
                    class="search-clear-btn"
                    title="清空搜索"
                    @click="clearSearchKeyword"
                    @mousedown.stop
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div class="filter-row">
                <button
                    v-for="option in filterOptions"
                    :key="option.key"
                    type="button"
                    class="filter-chip"
                    :class="{
                        'is-active': selectedFilter === option.key,
                        'is-keyboard-focus': tabRegion === 'filter' && focusedFilterKey === option.key,
                    }"
                    :data-filter-key="option.key"
                    :ref="(el) => setFilterChipRef(el, option.key)"
                    @click="selectedFilter = option.key"
                >
                    {{ option.label }}
                </button>
            </div>

            <div class="usage-hint">单击条目即可复制，点击 ☆ 收藏常用内容</div>
        </div>

        <div ref="contentRef" class="content" v-if="history.length > 0">
            <template v-if="groupedHistory.length > 0">
                <section
                    v-for="group in groupedHistory"
                    :key="group.key"
                    class="group-section"
                >
                    <div class="group-title">{{ group.label }} · {{ group.items.length }}</div>
                    <div
                        v-for="item in group.items"
                        :key="item.id"
                        class="history-item"
                        :ref="(el) => setItemRef(el, item.id)"
                        :data-item-id="item.id"
                        :class="{
                            'is-current': item.hash === currentHash,
                            'is-anchor-flashing': anchorFlashItemId === item.id,
                            'is-keyboard-focus': tabRegion === 'content' && focusedRecordId === item.id,
                        }"
                        @click="onCopyItem(item)"
                    >
                        <div class="item-content">
                            <div class="item-head">
                                <span class="item-type">{{ getRecordTypeLabel(item) }}</span>
                                <span class="item-copy-tip">点击复制</span>
                            </div>

                            <template v-if="item.content_type === 'image'">
                                <img
                                    v-if="imagePreviewMap[item.id]"
                                    :src="imagePreviewMap[item.id]"
                                    class="item-image"
                                    alt="剪贴板图片"
                                />
                                <div v-else class="item-image-placeholder">图片预览加载中</div>
                                <div v-if="item.image_path" class="item-meta">{{ item.image_path }}</div>
                            </template>

                            <template v-else>
                                <div class="item-text">
                                    {{ getVisibleText(item) }}
                                </div>
                                <button
                                    v-if="isExpandableText(item)"
                                    type="button"
                                    class="expand-btn"
                                    @click.stop="toggleExpand(item.id)"
                                    @mousedown.stop
                                >
                                    {{ isExpanded(item.id) ? "收起" : "展开" }}
                                </button>
                            </template>

                            <div class="item-time">{{ formatTime(item.timestamp) }}</div>
                        </div>

                        <div class="item-actions">
                            <button
                                class="favorite-btn"
                                type="button"
                                :class="{ 'is-active': isFavorite(item) }"
                                :title="isFavorite(item) ? '取消收藏' : '收藏'"
                                @click.stop="onToggleFavorite(item)"
                                @mousedown.stop
                            >
                                {{ isFavorite(item) ? "★" : "☆" }}
                            </button>
                            <button
                                class="delete-btn"
                                type="button"
                                @click.stop="onDeleteItem(item.id)"
                                @mousedown.stop
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 6L6 18M6 6l12 12"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </section>
            </template>

            <div v-else class="filtered-empty">
                <div class="filtered-empty-title">未找到匹配内容</div>
                <div class="filtered-empty-hint">可以尝试更短关键词或切换筛选类型</div>
            </div>
        </div>

        <div class="empty-state" v-else>
            <div class="empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
            </div>
            <div class="empty-text">暂无剪贴板历史</div>
            <div class="empty-hint">复制文本后会自动记录到这里</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getRecordContent, type ClipboardRecord } from "../stores/clipboardStore";
import { useClipboardStore } from "../stores/clipboardStore";
import { useClipboardEvents } from "../composables/useClipboardEvents";
import { readLocalImageAsDataUrl } from "../utils/system-commands";

const router = useRouter();
const route = useRoute();
const clipboardStore = useClipboardStore();
const {
    history,
    onCopyItem,
    onDeleteItem,
    onClearAll,
    formatTime,
} = useClipboardEvents();

const currentHash = computed(() => clipboardStore.currentClipboardHash);
const imagePreviewMap = ref<Record<string, string>>({});
const searchKeyword = ref("");
const selectedFilter = ref<ClipboardFilter>("all");
const expandedRecordIds = ref<Record<string, boolean>>({});
const itemRefs = ref<Record<string, HTMLElement | null>>({});
const contentRef = ref<HTMLElement | null>(null);
const anchorFlashItemId = ref<string | null>(null);
const clipboardHistoryRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const filterChipRefs = ref<Record<ClipboardFilter, HTMLButtonElement | null>>({
    all: null,
    favorites: null,
    text: null,
    code: null,
    image: null,
});
const tabRegion = ref<ClipboardTabRegion>("search");
const focusedFilterIndex = ref(0);
const focusedRecordIndex = ref(0);

const filterOptions: Array<{ key: ClipboardFilter; label: string }> = [
    { key: "all", label: "全部" },
    { key: "favorites", label: "收藏" },
    { key: "text", label: "文本" },
    { key: "code", label: "代码" },
    { key: "image", label: "图片" },
];

const TEXT_PREVIEW_LENGTH = 180;
const SCROLL_EDGE_PADDING = 12;
const SCROLL_ANIMATION_MS = 460;
const ANCHOR_FLASH_MS = 1000;
let scrollAnimationFrame: number | null = null;
let anchorFlashTimer: number | null = null;

type ClipboardFilter = "all" | "favorites" | "text" | "code" | "image";
type ClipboardGroupKey = "favorites" | "text" | "code" | "image";
type ClipboardTabRegion = "search" | "filter" | "content" | "none";
type ClipboardGroup = {
    key: ClipboardGroupKey;
    label: string;
    items: ClipboardRecord[];
};

const filterOrder = computed<ClipboardFilter[]>(() => filterOptions.map((option) => option.key));
const focusedFilterKey = computed<ClipboardFilter>(() => {
    const list = filterOrder.value;
    if (list.length === 0) return "all";
    const safeIndex = Math.max(0, Math.min(focusedFilterIndex.value, list.length - 1));
    return list[safeIndex];
});
const flatVisibleRecords = computed<ClipboardRecord[]>(() => {
    const rows: ClipboardRecord[] = [];
    for (const group of groupedHistory.value) {
        rows.push(...group.items);
    }
    return rows;
});
const focusedRecordId = computed<string | null>(() => {
    const list = flatVisibleRecords.value;
    if (list.length === 0) return null;
    const safeIndex = Math.max(0, Math.min(focusedRecordIndex.value, list.length - 1));
    return list[safeIndex]?.id ?? null;
});

watch(
    history,
    (records) => {
        void hydrateImagePreviews(records);
        const validIds = new Set(records.map((record) => record.id));
        expandedRecordIds.value = Object.fromEntries(
            Object.entries(expandedRecordIds.value).filter(([id]) => validIds.has(id))
        );
        itemRefs.value = Object.fromEntries(
            Object.entries(itemRefs.value).filter(([id]) => validIds.has(id))
        ) as Record<string, HTMLElement | null>;

        if (anchorFlashItemId.value && !validIds.has(anchorFlashItemId.value)) {
            anchorFlashItemId.value = null;
            if (anchorFlashTimer !== null) {
                clearTimeout(anchorFlashTimer);
                anchorFlashTimer = null;
            }
        }
    },
    { immediate: true }
);

watch(filterOrder, (list) => {
    if (list.length === 0) {
        focusedFilterIndex.value = 0;
        return;
    }
    focusedFilterIndex.value = Math.max(0, Math.min(focusedFilterIndex.value, list.length - 1));
});

watch(
    () => route.query.anchor,
    async (anchor) => {
        if (typeof anchor !== "string" || !anchor) return;
        await nextTick();
        const target = itemRefs.value[anchor];
        const container = contentRef.value;
        if (!target || !container) return;
        await triggerAnchorFlash(anchor);
        const nextScrollTop = getAnchorScrollTop(container, target);
        animateScrollTo(container, nextScrollTop);
    },
    { immediate: true }
);

onMounted(() => {
    document.addEventListener("keydown", onClipboardKeydown, true);
    document.addEventListener("mousedown", onClipboardMouseDown, true);
    searchInputRef.value?.addEventListener("blur", onSearchInputBlur);
    nextTick(() => {
        searchInputRef.value?.focus();
    });
});

onBeforeUnmount(() => {
    document.removeEventListener("keydown", onClipboardKeydown, true);
    document.removeEventListener("mousedown", onClipboardMouseDown, true);
    searchInputRef.value?.removeEventListener("blur", onSearchInputBlur);

    if (scrollAnimationFrame === null) {
        if (anchorFlashTimer !== null) {
            clearTimeout(anchorFlashTimer);
            anchorFlashTimer = null;
        }
        return;
    }
    cancelAnimationFrame(scrollAnimationFrame);
    scrollAnimationFrame = null;

    if (anchorFlashTimer !== null) {
        clearTimeout(anchorFlashTimer);
        anchorFlashTimer = null;
    }
});

const normalizedKeyword = computed(() => searchKeyword.value.trim().toLowerCase());

const visibleRecords = computed(() => {
    let records = history.value;

    if (selectedFilter.value === "favorites") {
        records = records.filter((record) => isFavorite(record));
    } else if (selectedFilter.value !== "all") {
        records = records.filter((record) => getRecordGroupKey(record) === selectedFilter.value);
    }

    const keyword = normalizedKeyword.value;
    if (!keyword) {
        return records;
    }

    return records.filter((record) => {
        const typeLabel = getRecordTypeLabel(record).toLowerCase();
        if (typeLabel.includes(keyword)) {
            return true;
        }

        if (record.content_type === "image") {
            const imagePath = (record.image_path || "").toLowerCase();
            return imagePath.includes(keyword) || "图片".includes(keyword);
        }

        const content = getRecordContent(record).toLowerCase();
        return content.includes(keyword);
    });
});

const groupedHistory = computed<ClipboardGroup[]>(() => {
    const records = visibleRecords.value;
    if (records.length === 0) {
        return [];
    }

    if (selectedFilter.value === "favorites") {
        return [{
            key: "favorites",
            label: "已收藏",
            items: records,
        }];
    }

    if (selectedFilter.value !== "all") {
        const groupKey = selectedFilter.value;
        return [{
            key: groupKey,
            label: getGroupLabel(groupKey),
            items: records,
        }];
    }

    const favorites = records.filter((record) => isFavorite(record));
    const rest = records.filter((record) => !isFavorite(record));
    const sections: ClipboardGroup[] = [];

    if (favorites.length > 0) {
        sections.push({
            key: "favorites",
            label: "已收藏",
            items: favorites,
        });
    }

    const typeOrder: ClipboardGroupKey[] = ["text", "code", "image"];
    for (const key of typeOrder) {
        const groupItems = rest.filter((record) => getRecordGroupKey(record) === key);
        if (groupItems.length === 0) {
            continue;
        }
        sections.push({
            key,
            label: getGroupLabel(key),
            items: groupItems,
        });
    }

    return sections;
});

watch(flatVisibleRecords, (records) => {
    if (records.length === 0) {
        focusedRecordIndex.value = 0;
        if (tabRegion.value === "content") {
            tabRegion.value = "search";
            nextTick(() => {
                searchInputRef.value?.focus();
            });
        }
        return;
    }
    focusedRecordIndex.value = Math.max(0, Math.min(focusedRecordIndex.value, records.length - 1));
});

function onBack() {
    router.back();
}

function resetTabCycleState() {
    tabRegion.value = "none";
    focusedFilterIndex.value = 0;
    focusedRecordIndex.value = 0;
}

function blurSearchInput() {
    searchInputRef.value?.blur();
}

function onSearchInputBlur() {
    if (tabRegion.value === "search") {
        tabRegion.value = "none";
    }
}

function setFilterChipRef(target: Element | ComponentPublicInstance | null, key: ClipboardFilter) {
    if (target instanceof HTMLButtonElement) {
        filterChipRefs.value[key] = target;
        return;
    }
    if (target && "$el" in target && target.$el instanceof HTMLButtonElement) {
        filterChipRefs.value[key] = target.$el;
        return;
    }
    filterChipRefs.value[key] = null;
}

function scrollFocusedRecordIntoView() {
    if (tabRegion.value !== "content") return;
    const focusedId = focusedRecordId.value;
    if (!focusedId) return;
    const node = itemRefs.value[focusedId];
    node?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function rotateTabRegion(reverse = false) {
    const order: ClipboardTabRegion[] = ["search", "filter", "content"];
    const step = reverse ? -1 : 1;
    const current = order.indexOf(tabRegion.value);
    if (current < 0) {
        if (reverse) {
            tabRegion.value = "content";
            blurSearchInput();
            nextTick(() => {
                scrollFocusedRecordIntoView();
            });
            return;
        }
        resetTabCycleState();
        tabRegion.value = "search";
        nextTick(() => {
            searchInputRef.value?.focus();
        });
        return;
    }
    const nextIndex = (current + step + order.length) % order.length;
    const nextRegion = order[nextIndex];

    if (nextRegion === "search") {
        resetTabCycleState();
        tabRegion.value = "search";
        nextTick(() => {
            searchInputRef.value?.focus();
        });
        return;
    }

    if (nextRegion === "filter") {
        tabRegion.value = "filter";
        blurSearchInput();
        nextTick(() => {
            filterChipRefs.value[focusedFilterKey.value]?.focus();
        });
        return;
    }

    tabRegion.value = "content";
    blurSearchInput();
    nextTick(() => {
        scrollFocusedRecordIntoView();
    });
}

function moveFilterFocusByArrow(key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") {
    const list = filterOrder.value;
    if (list.length === 0) return;
    const current = Math.max(0, Math.min(focusedFilterIndex.value, list.length - 1));
    const delta = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(current + delta, list.length - 1));
    focusedFilterIndex.value = nextIndex;
    nextTick(() => {
        filterChipRefs.value[focusedFilterKey.value]?.focus();
    });
}

function moveContentFocusByArrow(key: "ArrowUp" | "ArrowDown") {
    const list = flatVisibleRecords.value;
    if (list.length === 0) return;
    const current = Math.max(0, Math.min(focusedRecordIndex.value, list.length - 1));
    const nextIndex = key === "ArrowUp"
        ? Math.max(0, current - 1)
        : Math.min(list.length - 1, current + 1);
    focusedRecordIndex.value = nextIndex;
    nextTick(() => {
        scrollFocusedRecordIntoView();
    });
}

function triggerFocusedFilterSelection() {
    const key = focusedFilterKey.value;
    selectedFilter.value = key;
}

function triggerFocusedRecordCopy() {
    const focusedId = focusedRecordId.value;
    if (!focusedId) return;
    const item = flatVisibleRecords.value.find((record) => record.id === focusedId);
    if (!item) return;
    onCopyItem(item);
}

function onClipboardKeydown(e: KeyboardEvent) {
    const hasBlockingDialog = !!document.querySelector(".confirm-overlay, .input-overlay");
    if (hasBlockingDialog) return;

    if (e.key === "Tab") {
        e.preventDefault();
        rotateTabRegion(e.shiftKey);
        return;
    }

    if (e.key === "Escape") {
        const isSearchInputTarget = e.target instanceof HTMLInputElement
            && e.target.classList.contains("search-input");
        const targetInputValue = isSearchInputTarget ? e.target.value.trim() : "";

        if (isSearchInputTarget && targetInputValue.length > 0) {
            return;
        }

        e.preventDefault();
        onBack();
        return;
    }

    if (tabRegion.value === "filter") {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            moveFilterFocusByArrow(e.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown");
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            triggerFocusedFilterSelection();
            return;
        }
        return;
    }

    if (tabRegion.value === "content") {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            moveContentFocusByArrow(e.key as "ArrowUp" | "ArrowDown");
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            triggerFocusedRecordCopy();
            return;
        }
    }
}

function onClipboardMouseDown(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;

    const clickedBackButton = !!event.target.closest(".back-btn");
    if (clickedBackButton) {
        resetTabCycleState();
        blurSearchInput();
        return;
    }

    if (!clipboardHistoryRef.value?.contains(event.target)) {
        resetTabCycleState();
        blurSearchInput();
        return;
    }

    const clickedSearch = !!event.target.closest(".search-wrap");
    const clickedFilter = event.target.closest<HTMLElement>(".filter-chip[data-filter-key]");
    const clickedItem = event.target.closest<HTMLElement>(".history-item[data-item-id]");

    const isOnCurrentKeyboardFocus = (() => {
        if (tabRegion.value === "search") {
            return clickedSearch;
        }
        if (tabRegion.value === "filter") {
            const key = clickedFilter?.dataset.filterKey as ClipboardFilter | undefined;
            return key === focusedFilterKey.value;
        }
        if (tabRegion.value === "content") {
            const itemId = clickedItem?.dataset.itemId;
            return itemId === focusedRecordId.value;
        }
        return false;
    })();

    if (tabRegion.value !== "none" && !isOnCurrentKeyboardFocus) {
        resetTabCycleState();
        if (!clickedSearch) {
            blurSearchInput();
        }
        return;
    }

    if (clickedFilter) {
        const key = clickedFilter.dataset.filterKey as ClipboardFilter | undefined;
        const index = filterOrder.value.findIndex((option) => option === key);
        if (index >= 0) {
            focusedFilterIndex.value = index;
        }
        return;
    }

    if (clickedItem) {
        const itemId = clickedItem.dataset.itemId;
        if (itemId) {
            const index = flatVisibleRecords.value.findIndex((record) => record.id === itemId);
            if (index >= 0) {
                focusedRecordIndex.value = index;
            }
        }
    }
}

function clearSearchKeyword() {
    if (!searchKeyword.value) {
        return;
    }
    searchKeyword.value = "";
}

function looksLikeCode(content: string): boolean {
    const text = content.trim();
    if (!text) return false;

    const hasLineBreak = text.includes("\n");
    const codeKeywordPattern = /\b(const|let|var|function|class|import|export|return|if|else|for|while|try|catch|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i;
    const codeSymbolPattern = /[{}()[\];<>`]|=>|::|<\/?\w+>/;
    const hasCodeSignal = codeKeywordPattern.test(text) || codeSymbolPattern.test(text);

    return hasCodeSignal && (hasLineBreak || text.length >= 40);
}

function getRecordGroupKey(record: ClipboardRecord): ClipboardGroupKey {
    if (record.content_type === "image") {
        return "image";
    }
    return looksLikeCode(getRecordContent(record)) ? "code" : "text";
}

function getRecordTypeLabel(record: ClipboardRecord): string {
    const key = getRecordGroupKey(record);
    return getGroupLabel(key);
}

function getGroupLabel(group: ClipboardGroupKey): string {
    if (group === "favorites") return "已收藏";
    if (group === "text") return "文本";
    if (group === "code") return "代码";
    return "图片";
}

function isFavorite(record: ClipboardRecord): boolean {
    return clipboardStore.isFavoriteHash(record.hash);
}

function onToggleFavorite(record: ClipboardRecord) {
    clipboardStore.toggleFavoriteHash(record.hash);
}

function isExpandableText(record: ClipboardRecord): boolean {
    if (record.content_type !== "text") return false;
    return getRecordContent(record).length > TEXT_PREVIEW_LENGTH;
}

function isExpanded(recordId: string): boolean {
    return !!expandedRecordIds.value[recordId];
}

function setItemRef(target: Element | ComponentPublicInstance | null, recordId: string) {
    if (target instanceof HTMLElement) {
        itemRefs.value[recordId] = target;
        return;
    }

    if (target && "$el" in target && target.$el instanceof HTMLElement) {
        itemRefs.value[recordId] = target.$el;
        return;
    }

    delete itemRefs.value[recordId];
}

async function toggleExpand(recordId: string) {
    const wasExpanded = isExpanded(recordId);
    const next = { ...expandedRecordIds.value };
    next[recordId] = !wasExpanded;
    expandedRecordIds.value = next;

    if (!wasExpanded) {
        return;
    }

    await nextTick();
    const container = contentRef.value;
    const target = itemRefs.value[recordId];
    if (!target || !container) {
        return;
    }

    await triggerAnchorFlash(recordId);

    if (!isPartiallyOutsideViewport(container, target)) {
        return;
    }

    const nextScrollTop = getAnchorScrollTop(container, target);
    animateScrollTo(container, nextScrollTop);
}

async function triggerAnchorFlash(recordId: string) {
    if (anchorFlashTimer !== null) {
        clearTimeout(anchorFlashTimer);
        anchorFlashTimer = null;
    }

    if (anchorFlashItemId.value === recordId) {
        anchorFlashItemId.value = null;
        await nextTick();
    }

    anchorFlashItemId.value = recordId;
    anchorFlashTimer = window.setTimeout(() => {
        if (anchorFlashItemId.value === recordId) {
            anchorFlashItemId.value = null;
        }
        anchorFlashTimer = null;
    }, ANCHOR_FLASH_MS);
}

function getVisibleText(record: ClipboardRecord): string {
    const content = getRecordContent(record);
    if (!isExpandableText(record) || isExpanded(record.id)) {
        return content;
    }
    return content.slice(0, TEXT_PREVIEW_LENGTH) + "...";
}

async function hydrateImagePreviews(records: typeof history.value) {
    const imageRecords = records.filter(
        (record) => record.content_type === "image" && !!record.image_path
    );
    const nextMap = { ...imagePreviewMap.value };

    await Promise.all(
        imageRecords.map(async (record) => {
            if (nextMap[record.id] || !record.image_path) {
                return;
            }

            try {
                nextMap[record.id] = await readLocalImageAsDataUrl(record.image_path);
            } catch (error) {
                console.warn("Failed to load clipboard image preview:", error);
            }
        })
    );

    const validIds = new Set(imageRecords.map((record) => record.id));
    for (const id of Object.keys(nextMap)) {
        if (!validIds.has(id)) {
            delete nextMap[id];
        }
    }

    imagePreviewMap.value = nextMap;
}

function isPartiallyOutsideViewport(container: HTMLElement, target: HTMLElement): boolean {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return targetRect.top < containerRect.top || targetRect.bottom > containerRect.bottom;
}

function getAnchorScrollTop(container: HTMLElement, target: HTMLElement): number {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    let desiredScrollTop = container.scrollTop;
    if (targetRect.top < containerRect.top) {
        desiredScrollTop += targetRect.top - containerRect.top - SCROLL_EDGE_PADDING;
    } else if (targetRect.bottom > containerRect.bottom) {
        desiredScrollTop += targetRect.bottom - containerRect.bottom + SCROLL_EDGE_PADDING;
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    return Math.min(maxScrollTop, Math.max(0, desiredScrollTop));
}

function animateScrollTo(container: HTMLElement, targetScrollTop: number) {
    if (scrollAnimationFrame !== null) {
        cancelAnimationFrame(scrollAnimationFrame);
        scrollAnimationFrame = null;
    }

    const startScrollTop = container.scrollTop;
    const delta = targetScrollTop - startScrollTop;
    if (Math.abs(delta) < 1) {
        container.scrollTop = targetScrollTop;
        return;
    }

    const startTime = performance.now();
    const easeInOutCubic = (progress: number) => (
        progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2
    );

    const tick = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / SCROLL_ANIMATION_MS);
        const eased = easeInOutCubic(progress);
        container.scrollTop = startScrollTop + delta * eased;

        if (progress < 1) {
            scrollAnimationFrame = requestAnimationFrame(tick);
            return;
        }

        scrollAnimationFrame = null;
        container.scrollTop = targetScrollTop;
    };

    scrollAnimationFrame = requestAnimationFrame(tick);
}
</script>

<style lang="scss" scoped>
@use "../styles/scrollbar" as *;
.clipboard-history {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
}

.clipboard-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
}

.back-btn,
.clear-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--hover-bg);
    color: var(--text-color);
    cursor: pointer;
    -webkit-app-region: no-drag;
    font-size: 13px;
}

.back-btn:hover,
.clear-btn:hover:not(:disabled) {
    background: var(--hover-bg-strong);
}

.clear-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.title {
    flex: 1;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.toolbar {
    padding: 10px 12px 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--card-bg);
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.search-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--input-bg);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 8px 10px;
}

.search-wrap.is-keyboard-focus {
    border: 1px solid var(--primary-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 35%, transparent);
}

.search-icon {
    width: 16px;
    height: 16px;
    color: var(--text-hint);
    flex-shrink: 0;
}

.search-input {
    border: 0;
    outline: none;
    background: transparent;
    width: 100%;
    color: var(--text-color);
    font-size: 13px;
}

.search-input::placeholder {
    color: var(--text-hint);
}

.search-clear-btn {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-hint);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
}

.search-clear-btn svg {
    width: 12px;
    height: 12px;
}

.search-clear-btn:hover {
    background: var(--hover-bg);
    color: var(--text-color);
}

.filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.filter-chip {
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 4px 10px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.filter-chip:hover {
    background: var(--hover-bg);
}

.filter-chip.is-active {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--primary-color) 70%, transparent);
    background: var(--primary-bg);
    color: var(--primary-color);
}

.filter-chip.is-keyboard-focus {
    border: 1px solid var(--primary-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 35%, transparent);
}

.usage-hint {
    font-size: 12px;
    color: var(--text-hint);
}

.content {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    padding-right: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;

    @include custom-scrollbar;
}

.group-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.group-title {
    font-size: 12px;
    color: var(--text-hint);
    font-weight: 600;
    letter-spacing: 0.3px;
}

.history-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    -webkit-app-region: no-drag;
}

.history-item:hover {
    background: var(--card-bg-solid);
    border-color: color-mix(in srgb, var(--primary-color) 60%, transparent);
    box-shadow: var(--card-shadow);
}

.history-item.is-current {
    background: var(--primary-bg);
    border: 1px dashed color-mix(in srgb, var(--primary-color) 70%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 22%, transparent);
}

.history-item.is-keyboard-focus:not(.is-current) {
    border: 1px solid var(--primary-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 35%, transparent), var(--card-shadow);
}

.history-item.is-current.is-keyboard-focus {
    border: 1px solid var(--primary-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 40%, transparent), var(--card-shadow);
}

.history-item.is-anchor-flashing:not(.is-current) {
    animation: anchor-item-flash 2s ease-in-out;
}

.history-item.is-current.is-anchor-flashing {
    animation: anchor-item-flash-current 2s ease-in-out;
}

@keyframes anchor-item-flash {
    0%,
    100% {
        background: var(--card-bg);
        border-color: var(--border-color);
        box-shadow: none;
    }
    20%,
    60% {
        background: var(--primary-bg);
        border-color: var(--primary-color);
        box-shadow: 0 0 0 1px var(--primary-color);
    }
    40%,
    80% {
        background: var(--card-bg);
        border-color: var(--border-color);
        box-shadow: none;
    }
}

@keyframes anchor-item-flash-current {
    0%,
    100% {
        background: var(--primary-bg);
        border-color: var(--primary-color);
        box-shadow: 0 0 0 1px var(--primary-color);
    }
    25%,
    75% {
        background: var(--card-bg-solid);
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px var(--primary-color);
    }
}

.item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.item-type {
    font-size: 11px;
    color: var(--text-hint);
    background: var(--hover-bg);
    border-radius: 999px;
    padding: 2px 8px;
}

.item-copy-tip {
    font-size: 11px;
    color: var(--text-hint);
}

.item-text {
    font-size: 14px;
    color: var(--text-color);
    line-height: 1.4;
    word-break: break-all;
    white-space: pre-wrap;
}

.item-meta {
    margin-top: 8px;
    font-size: 11px;
    color: var(--text-hint);
    word-break: break-all;
}

.expand-btn {
    margin-top: 6px;
    border: 0;
    background: transparent;
    color: var(--primary-color);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
}

.item-time {
    font-size: 12px;
    color: var(--text-hint);
}

.item-image {
    max-width: 100%;
    border-radius: 8px;
}

.item-image-placeholder {
    margin-top: 8px;
    padding: 12px;
    border-radius: 8px;
    background: var(--hover-bg);
    color: var(--text-hint);
    font-size: 12px;
}

.item-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}

.favorite-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--text-hint);
    cursor: pointer;
    border-radius: 6px;
    font-size: 16px;
    line-height: 1;
}

.favorite-btn:hover {
    background: var(--hover-bg);
    color: #f6b100;
}

.favorite-btn.is-active {
    color: #f6b100;
}

.delete-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s ease;
}

.delete-btn:hover {
    background: var(--error-bg);
    color: var(--error-color);
}

.filtered-empty {
    border: 1px dashed var(--border-color);
    border-radius: 12px;
    padding: 24px 16px;
    text-align: center;
    background: var(--card-bg);
}

.filtered-empty-title {
    font-size: 14px;
    color: var(--text-secondary);
    margin-bottom: 4px;
}

.filtered-empty-hint {
    font-size: 12px;
    color: var(--text-hint);
}

.empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px;
}

.empty-icon {
    color: var(--text-hint);
}

.empty-text {
    font-size: 16px;
    font-weight: 500;
    color: var(--text-secondary);
}

.empty-hint {
    font-size: 13px;
    color: var(--text-hint);
}
</style>
