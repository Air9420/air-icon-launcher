<template>
    <div class="global-search-results">
        <div v-if="safeResults.length > 0 || showBrowserSearch" class="search-result-header">
            搜索结果 ( {{ safeResults.length }} )
        </div>
        <div v-if="safeResults.length > 0" class="search-result-list">
            <div
                v-for="(result, index) in safeResults"
                :key="result.key"
                :ref="el => setItemRef(el, index)"
                class="search-result-item"
                :class="{
                    'is-launching': getLaunchStatus(result.item.id) === 'launching',
                    'is-success': getLaunchStatus(result.item.id) === 'success',
                    'is-selected': selectedIndex === index
                }"
                :data-menu-type="'Icon-Item'"
                :data-item-id="result.item.id"
                :data-category-id="result.categories[0]?.id || ''"
                :data-item-path="result.item.path || ''"
                @click.left="$emit('select', result)"
            >
                <div
                    v-if="index < 10"
                    class="shortcut-hint"
                    :class="{ 'is-visible': !!showShortcutHints }"
                    aria-hidden="true"
                >
                    {{ getShortcutLabel(index) }}
                </div>
                <div class="result-icon">
                    <img
                        v-if="result.item.iconBase64"
                        class="icon-real"
                        :src="getIconSrc(result.item.iconBase64)"
                        alt=""
                        draggable="false"
                    />
                    <div v-else class="icon-fallback">
                        {{ getFallbackText(result.item.name) }}
                    </div>
                </div>
                <div class="result-info">
                    <div class="result-name" :title="result.item.name">
                        <template
                            v-for="(segment, segmentIndex) in getNameSegments(result)"
                            :key="`${result.key}-${segmentIndex}`"
                        >
                            <mark
                                v-if="segment.highlighted"
                                class="result-name-highlight"
                            >
                                {{ segment.text }}
                            </mark>
                            <span v-else>{{ segment.text }}</span>
                        </template>
                    </div>
                    <div class="result-meta">
                        <span
                            class="match-type-chip"
                            :class="`is-${result.matchType}`"
                        >
                            {{ getSearchMatchTypeLabel(result.matchType) }}
                        </span>
                        <div class="result-categories">
                            <span
                                v-for="c in result.categories"
                                :key="c.id"
                                class="result-category-chip"
                                :title="c.name"
                            >
                                {{ c.name }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div
            v-if="showBrowserSearch"
            :ref="el => setItemRef(el, browserSearchIndex)"
            class="browser-search-item"
            :class="{ 'is-selected': selectedIndex === browserSearchIndex }"
            @click.left="$emit('browser-search')"
        >
            <div
                v-if="browserSearchIndex < 10"
                class="shortcut-hint browser-shortcut-hint"
                :class="{ 'is-visible': !!showShortcutHints }"
                aria-hidden="true"
            >
                {{ getShortcutLabel(browserSearchIndex) }}
            </div>
            <span class="browser-search-icon">🌐</span>
            <span class="browser-search-text">用浏览器搜索 "{{ keyword }}"</span>
        </div>

        <template v-if="scannedSection && scannedSection.items && scannedSection.items.length > 0">
            <div class="scanned-section-divider">
                <span class="scanned-section-title">📂 {{ scannedSection.sectionTitle }}（匹配 {{ scannedSection.totalMatches }}）</span>
            </div>
            <div class="search-result-list">
                <div
                    v-for="(entry, i) in scannedSection.items"
                    :key="entry.path"
                    :ref="el => setItemRef(el, scannedStartIndex + i)"
                    class="search-result-item scanned-item"
                    :class="{ 'is-selected': selectedIndex === scannedStartIndex + i }"
                    :data-menu-type="'Search-Scanned-Item'"
                    :data-item-path="entry.path"
                    @click.left="$emit('select-scanned', entry)"
                >
                    <div
                        v-if="scannedStartIndex + i < 10"
                        class="shortcut-hint"
                        :class="{ 'is-visible': !!showShortcutHints }"
                        aria-hidden="true"
                    >
                        {{ getShortcutLabel(scannedStartIndex + i) }}
                    </div>
                    <div class="result-icon">
                        <img
                            v-if="entry.iconBase64"
                            class="icon-real"
                            :src="getIconSrc(entry.iconBase64)"
                            alt=""
                            draggable="false"
                        />
                        <div v-else class="icon-fallback">
                            {{ getFallbackText(entry.name) }}
                        </div>
                    </div>
                    <div class="result-info">
                        <div class="result-name">{{ entry.name }}</div>
                        <div class="result-meta">
                            <span
                                class="match-type-chip"
                                :class="`is-${entry.matchType || 'fuzzy'}`"
                            >
                                {{ getSearchMatchTypeLabel(entry.matchType || "fuzzy") }}
                            </span>
                            <span class="scanned-source-tag" :class="getSourceClass(entry.source)">
                                {{ entry.source }}
                            </span>
                            <span
                                v-if="entry.launchRisk === 'uninstall_candidate'"
                                class="scanned-risk-tag"
                                :title="entry.launchRiskHint"
                            >
                                卸载/异常启动项
                            </span>
                            <span
                                v-else-if="entry.launchRisk === 'installer_candidate'"
                                class="scanned-risk-tag is-installer"
                                :title="entry.launchRiskHint"
                            >
                                安装器/修复入口
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            <div v-if="scannedSection.totalMatches > safeScannedItems.length" class="scanned-more-hint">
                + {{ scannedSection.totalMatches - safeScannedItems.length }} 个匹配
            </div>
        </template>

        <template v-if="clipboardResults.length > 0">
            <div class="extension-section-divider">
                <span class="extension-section-title">📋 剪贴板匹配（{{ clipboardResults.length }}）</span>
            </div>
            <div class="search-result-list">
                <div
                    v-for="(entry, i) in clipboardResults"
                    :key="entry.key"
                    :ref="el => setItemRef(el, clipboardStartIndex + i)"
                    class="search-result-item extension-item"
                    :class="{ 'is-selected': selectedIndex === clipboardStartIndex + i }"
                    :data-menu-type="'Search-Clipboard-Item'"
                    :data-clipboard-record-id="entry.id"
                    :data-clipboard-content-type="entry.contentType"
                    @click.left="$emit('select-clipboard', entry)"
                >
                    <div
                        v-if="clipboardStartIndex + i < 10"
                        class="shortcut-hint"
                        :class="{ 'is-visible': !!showShortcutHints }"
                        aria-hidden="true"
                    >
                        {{ getShortcutLabel(clipboardStartIndex + i) }}
                    </div>
                    <div class="result-icon">
                        <div class="icon-fallback extension-icon">📋</div>
                    </div>
                    <div class="result-info">
                        <div class="result-name">{{ entry.preview }}</div>
                        <div class="result-meta">
                            <span
                                class="match-type-chip"
                                :class="`is-${entry.matchType || 'fuzzy'}`"
                            >
                                {{ getSearchMatchTypeLabel(entry.matchType || "fuzzy") }}
                            </span>
                            <span class="result-category-chip">
                                {{ entry.contentType === "image" ? "图片" : "文本" }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <template v-if="recentFileResults.length > 0">
            <div class="extension-section-divider">
                <span class="extension-section-title">🗂 最近文件匹配（{{ recentFileResults.length }}）</span>
            </div>
            <div class="search-result-list">
                <div
                    v-for="(entry, i) in recentFileResults"
                    :key="entry.key"
                    :ref="el => setItemRef(el, recentFileStartIndex + i)"
                    class="search-result-item extension-item"
                    :class="{ 'is-selected': selectedIndex === recentFileStartIndex + i }"
                    :data-menu-type="'Search-Recent-File-Item'"
                    :data-item-path="entry.path"
                    @click.left="$emit('select-recent-file', entry)"
                >
                    <div
                        v-if="recentFileStartIndex + i < 10"
                        class="shortcut-hint"
                        :class="{ 'is-visible': !!showShortcutHints }"
                        aria-hidden="true"
                    >
                        {{ getShortcutLabel(recentFileStartIndex + i) }}
                    </div>
                    <div class="result-icon">
                        <img
                            v-if="entry.iconBase64"
                            class="icon-real"
                            :src="getIconSrc(entry.iconBase64)"
                            alt=""
                            draggable="false"
                        />
                        <div v-else class="icon-fallback">
                            {{ getFallbackText(entry.name) }}
                        </div>
                    </div>
                    <div class="result-info">
                        <div class="result-name">{{ entry.name }}</div>
                        <div class="result-meta">
                            <span
                                class="match-type-chip"
                                :class="`is-${entry.matchType || 'fuzzy'}`"
                            >
                                {{ getSearchMatchTypeLabel(entry.matchType || "fuzzy") }}
                            </span>
                            <span class="result-category-chip">{{ entry.path }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, type ComponentPublicInstance } from "vue";
import type { GlobalSearchMergedResult } from "../../stores";
import {
    buildSearchHighlightSegments,
    getSearchMatchTypeLabel,
    getHotkeyForIndex,
} from "../../utils/search-ui";
import type { ScannedAppEntry, ScannedFallbackSection } from "../../types/scan-cache";
import type { ClipboardSearchResult, RecentFileSearchResult } from "../../types/search-extensions";

const props = defineProps<{
    results: GlobalSearchMergedResult[];
    getLaunchStatus: (itemId: string) => "launching" | "success" | undefined;
    selectedIndex: number;
    keyword: string;
    showShortcutHints?: boolean;
    isPending?: boolean;
    scannedSection?: ScannedFallbackSection | null;
    clipboardResults?: ClipboardSearchResult[];
    recentFileResults?: RecentFileSearchResult[];
}>();

defineEmits<{
    (e: "select", result: GlobalSearchMergedResult): void;
    (e: "browser-search"): void;
    (e: "select-scanned", entry: ScannedAppEntry): void;
    (e: "select-clipboard", entry: ClipboardSearchResult): void;
    (e: "select-recent-file", entry: RecentFileSearchResult): void;
}>();

const safeResults = computed(() => props.results ?? []);
const safeScannedItems = computed(() => props.scannedSection?.items ?? []);
const clipboardResults = computed(() => props.clipboardResults ?? []);
const recentFileResults = computed(() => props.recentFileResults ?? []);

const showBrowserSearch = computed(() => {
    return props.keyword.trim().length > 0 && (props.isPending || safeResults.value.length <= 3);
});

const browserSearchIndex = computed(() => safeResults.value.length);

const scannedStartIndex = computed(() => {
    return safeResults.value.length + (showBrowserSearch.value ? 1 : 0);
});

const clipboardStartIndex = computed(() => {
    return scannedStartIndex.value + safeScannedItems.value.length;
});

const recentFileStartIndex = computed(() => {
    return clipboardStartIndex.value + clipboardResults.value.length;
});

const itemRefs = ref<Record<number, HTMLElement | null>>({});

function setItemRef(el: Element | ComponentPublicInstance | null, index: number) {
    itemRefs.value[index] = el as HTMLElement | null;
}

watch(() => props.selectedIndex, async (newIndex) => {
    if (newIndex < 0) return;
    await nextTick();
    const el = itemRefs.value[newIndex];
    if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
});

function getIconSrc(iconBase64: string) {
    if (iconBase64.startsWith("data:")) return iconBase64;
    return `data:image/png;base64,${iconBase64}`;
}

function getFallbackText(name: string) {
    const text = name.trim();
    if (!text) return "?";
    return text.slice(0, 1).toUpperCase();
}

function getNameSegments(result: GlobalSearchMergedResult) {
    return buildSearchHighlightSegments(
        result.item.name,
        props.keyword,
        result.matchType
    );
}

function getSourceClass(source: string): string {
    const map: Record<string, string> = {
        "注册表": "source-registry",
        "桌面": "source-desktop",
        "开始菜单": "source-startmenu",
    };
    return map[source] || "source-other";
}

function getShortcutLabel(index: number): string {
    return getHotkeyForIndex(index);
}
</script>

<style lang="scss" scoped>
.global-search-results {
    flex: 1;
    padding: 0 16px 16px;
    overflow-y: auto;
    scroll-padding-top: 8px;
    scroll-padding-bottom: 8px;
    &::-webkit-scrollbar {
        display: none;
    }
}

.search-result-header {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color-secondary);
    text-shadow: var(--text-shadow);
    margin-bottom: 12px;
}

.search-result-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.search-result-item {
    position: relative;
    scroll-margin-top: 8px;
    scroll-margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: var(--card-bg-solid);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.2s ease, box-shadow 0.2s ease;
    box-shadow: var(--card-shadow-light);

    &:hover {
        @media (hover: hover) {
            background: var(--card-bg-hover);
            transform: scale(calc(1 + 0.02 * (1 - var(--performance-mode, 0))));
            box-shadow: var(--card-shadow-light), 0 4px 12px calc(0px * var(--performance-mode, 0)) rgba(0, 0, 0, 0.15);
        }
    }

    &.is-launching {
        animation: launching-shadow 1.2s ease-in-out infinite;
    }

    &.is-success {
        animation: success-shadow 1.2s ease-in-out infinite;
    }

    &.is-selected {
        background: var(--card-bg-hover);
        box-shadow: 0 0 0 2px var(--primary-color, #0078d4), var(--card-shadow-light);
    }
}

.shortcut-hint {
    position: absolute;
    right: 10px;
    top: 50%;
    z-index: 1;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--primary-color) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary-color) 45%, transparent);
    color: var(--primary-color);
    font-size: 12px;
    font-weight: 700;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-50%) scale(0.92);
    transition: opacity 0.12s ease, transform 0.12s ease;
}

.shortcut-hint.is-visible {
    opacity: 1;
    transform: translateY(-50%) scale(1);
}

.result-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    .icon-real {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .icon-fallback {
        width: 100%;
        height: 100%;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-color-secondary);
        font-weight: 800;
        color: var(--text-color);
        font-size: 18px;
    }
}

.result-info {
    flex: 1;
    min-width: 0;
}

.result-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.result-name-highlight {
    background: color-mix(in srgb, var(--primary-color) 20%, transparent);
    color: var(--text-color);
    border-radius: 4px;
    padding: 0 2px;
}

.result-meta {
    margin-top: 4px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
}

.result-categories {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 34px;
    overflow-y: auto;
    min-width: 0;
    scrollbar-width: none;
    -ms-overflow-style: none;
    &::-webkit-scrollbar {
        display: none;
    }
}

.match-type-chip {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--bg-color-secondary);
    color: var(--text-color-secondary);
}

.match-type-chip.is-exact,
.match-type-chip.is-prefix {
    background: color-mix(in srgb, var(--success-color, #4caf50) 18%, transparent);
    color: var(--success-color, #2e7d32);
}

.match-type-chip.is-substring {
    background: color-mix(in srgb, var(--primary-color) 18%, transparent);
    color: var(--primary-color);
}

.match-type-chip.is-pinyin_full,
.match-type-chip.is-pinyin_initial {
    background: color-mix(in srgb, var(--warning-color, #ff9800) 18%, transparent);
    color: var(--warning-color, #f57c00);
}

.match-type-chip.is-fuzzy {
    background: color-mix(in srgb, var(--text-color-tertiary) 18%, transparent);
    color: var(--text-color-secondary);
}

.result-category-chip {
    font-size: 11px;
    color: var(--text-color-tertiary);
    background: var(--bg-color-secondary);
    padding: 2px 6px;
    border-radius: 999px;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

@keyframes launching-shadow {
    0% {
        box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.3), var(--card-shadow-light);
    }
    50% {
        box-shadow: 0 0 0 4px rgba(0, 120, 212, 0.6), var(--card-shadow-light);
    }
    100% {
        box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.3), var(--card-shadow-light);
    }
}

@keyframes success-shadow {
    0% {
        box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.3), var(--card-shadow-light);
    }
    50% {
        box-shadow: 0 0 0 4px rgba(76, 175, 80, 0.6), var(--card-shadow-light);
    }
    100% {
        box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.3), var(--card-shadow-light);
    }
}

.browser-search-item {
    position: relative;
    scroll-margin-top: 8px;
    scroll-margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    margin-top: 8px;
    background: var(--card-bg-solid);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s ease, box-shadow 0.15s ease;
    box-shadow: var(--card-shadow-light);

    &:hover {
        @media (hover: hover) {
            background: var(--card-bg-hover);
        }
    }

    &.is-selected {
        background: var(--card-bg-hover);
        box-shadow: 0 0 0 2px var(--primary-color, #0078d4), var(--card-shadow-light);
    }

    .browser-search-icon {
        font-size: 18px;
    }

    .browser-search-text {
        font-size: 14px;
        color: var(--text-color);
    }
}

.browser-shortcut-hint {
    right: 10px;
}

.scanned-section-divider {
    margin: 16px 0 8px;
    padding: 6px 0;
    border-top: 1px solid var(--border-color);

    .scanned-section-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-color-secondary);
    }
}

.scanned-source-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;

    &.source-registry {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
    }

    &.source-desktop {
        background: rgba(34, 197, 94, 0.15);
        color: #22c55e;
    }

    &.source-startmenu {
        background: rgba(168, 85, 247, 0.15);
        color: #a855f7;
    }

    &.source-other {
        background: var(--bg-color-secondary);
        color: var(--text-color-tertiary);
    }
}

.scanned-more-hint {
    font-size: 12px;
    color: var(--text-color-tertiary);
    text-align: center;
    padding: 4px 0;
}

.extension-section-divider {
    margin: 12px 0 8px;
    padding: 6px 0;
    border-top: 1px solid var(--border-color);
}

.extension-section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color-secondary);
}

.extension-item .result-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.extension-icon {
    font-size: 18px;
}

.scanned-risk-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;
    background: rgba(239, 68, 68, 0.18);
    color: #ef4444;

    &.is-installer {
        background: rgba(245, 158, 11, 0.2);
        color: #f59e0b;
    }
}
</style>
