<template>
    <div
        class="categorie-view"
        :class="{ 'is-editing': isEditingCategory }"
        tabindex="0"
    >
        <div class="search-header">
            <div ref="searchShellRef" class="search-shell">
                <SearchBox
                    ref="searchBoxRef"
                    v-model="searchKeyword"
                    placeholder="搜索启动项..."
                    :intercept-tab="true"
                    @nav="onSearchNav"
                >
                    <template #actions>
                        <button
                            v-if="!searchKeyword.trim()"
                            class="history-toggle-btn"
                            type="button"
                            @mousedown.prevent
                            @click="toggleSearchHistoryPanel"
                        >
                            {{ showSearchHistoryPanel ? "收起历史" : "展示历史" }}
                        </button>
                    </template>
                </SearchBox>

                <div v-if="showSearchHistoryPanel" class="search-history-panel">
                    <div class="search-history-head">
                        <div class="search-history-title">最近搜索</div>
                        <button
                            v-if="searchHistoryEntries.length > 0"
                            class="search-history-clear-btn"
                            type="button"
                            @mousedown.prevent
                            @click="onClearSearchHistory"
                        >
                            清空
                        </button>
                    </div>
                    <template v-if="searchHistoryEntries.length > 0">
                        <div
                            v-for="entry in searchHistoryEntries"
                            :key="entry.keyword"
                            class="search-history-row"
                        >
                            <button
                                class="search-history-item"
                                type="button"
                                @mousedown.prevent
                                @click="onSelectSearchHistory(getSearchHistoryLabel(entry))"
                            >
                                <span class="history-keyword">{{ getSearchHistoryLabel(entry) }}</span>
                                <span class="history-meta">{{ entry.count }} 次</span>
                            </button>
                            <button
                                class="search-history-remove-btn"
                                type="button"
                                :title="`删除 ${getSearchHistoryLabel(entry)}`"
                                @mousedown.prevent
                                @click.stop="onRemoveSearchHistory(entry.keyword)"
                            >
                                ×
                            </button>
                        </div>
                    </template>
                    <div v-else class="search-history-empty">暂无最近搜索</div>
                </div>
            </div>
        </div>

        <SearchResults
            v-if="homeSearchViewState === 'results'"
            :results="rustSearchMergedResults"
            :get-launch-status="getLaunchStatus"
            :selected-index="selectedIndex"
            :keyword="searchKeyword"
            :show-shortcut-hints="showShortcutHints"
            :is-pending="isHomeSearchPending"
            :scanned-section="scannedFallbackSection"
            :command-results="commandSearchResults"
            :clipboard-results="clipboardSearchResults"
            :recent-file-results="recentFileSearchResults"
            @select="launchSearchWithCd"
            @select-command="launchCommandWithCd"
            @browser-search="onBrowserSearch"
            @select-scanned="onSelectScannedApp"
            @select-clipboard="selectClipboardWithCd"
            @select-recent-file="openRecentFileWithCd"
        />

        <template v-if="homeSearchViewState === 'home'">
            <div
                v-if="pinnedMergedItems.length > 0 || stableRecentDisplayItems.length > 0"
                class="home-sections"
                data-menu-type="Home"
            >
                <PinnedItems
                    :items="pinnedMergedItems"
                    :layout="pinnedLayout"
                    :get-launch-status="getLaunchStatus"
                    :start-index="0"
                    :show-shortcut-badge="showShortcutHints"
                    :selected-index="isHomeKeyboardNavActive && homeFocusRegion === 'pinned' ? homePinnedSelectedIndex : undefined"
                    @select="launchPinnedWithCd"
                    @reorder="onReorderPinnedItems"
                />

                <RecentItems
                    :items="stableRecentDisplayItems"
                    :layout="recentLayout"
                    :get-launch-status="getLaunchStatus"
                    :start-index="pinnedMergedItems.length"
                    :show-shortcut-badge="showShortcutHints"
                    :selected-index="isHomeKeyboardNavActive && homeFocusRegion === 'recent' ? homeRecentSelectedIndex : undefined"
                    @select="launchRecentWithCd"
                />
            </div>

            <CategoryGrid
                :categories="displayCategories"
                :cols="categoryCols"
                :is-editing="isEditingCategory"
                :editing-category-id="editingCategoryId"
                :editing-category-name="editingCategoryName"
                :is-new-category="isNewCategory"
                :selected-category-id="isHomeKeyboardNavActive && homeFocusRegion === 'category' ? homeSelectedCategoryId : null"
                @update:categories="onUpdateCategories"
                @update:editing-category-name="editingCategoryName = $event"
                @select="onClickCategory"
                @confirm-edit="onConfirmCategoryEdit"
                @cancel-edit="onCancelCategoryEdit"
            />
        </template>

        <SearchFallback
            v-else-if="homeSearchViewState === 'fallback'"
            :keyword="searchKeyword"
            @browser-search="onBrowserSearch"
        />

        <div
            v-if="externalConvertDragVisible"
            class="external-convert-drag-overlay"
        >
            <div
                class="external-convert-drag-ghost"
                :style="externalConvertGhostStyle"
            >
                {{ externalConvertDragName || "添加到分类" }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import { onClickOutside, useThrottleFn } from "@vueuse/core";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useLaunchCooldown } from "../composables/useLaunchCooldown";

import SearchBox from "../components/SearchBox.vue";
import SearchResults from "../components/home/SearchResults.vue";
import SearchFallback from "../components/SearchFallback.vue";
import PinnedItems from "../components/home/PinnedItems.vue";
import RecentItems from "../components/home/RecentItems.vue";
import CategoryGrid from "../components/home/CategoryGrid.vue";

import {
    Store,
    useClipboardStore,
    getRecordContent,
    useSettingsStore,
    useUIStore,
    useCategoryStore,
    useSearchExtensionsStore,
    type GlobalSearchMergedResult,
    type RecentUsedMergedItem,
    type PinnedMergedItem,
    type Category as CategoryType,
} from "../stores";
import { useStatsStore, type SearchKeywordRecord } from "../stores/statsStore";
import { useLaunchStatus } from "../composables/useLaunchStatus";
import { useHomePageState, type HomeRecentDisplayItem } from "../composables/useHomePageState";
import { normalizeIconBase64 } from "../composables/useItemsHelper";
import { showToast } from "../composables/useGlobalToast";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import { launchStoredItem } from "../utils/launcher-service";
import { SEARCH_THROTTLE_MS } from "../utils/search-config";
import { openPathWithSystem } from "../utils/system-commands";
import {
    createSearchSelectionTarget,
    findSearchSelectionIndex,
    getSearchHistoryDisplayKeyword,
    getRecentSearchHistoryEntries,
    getSearchSectionIndex,
    getSearchShortcutIndex,
    getHomeShortcutTarget,
    type SearchSelectionTarget,
} from "../utils/search-ui";
import { useScanCache } from "../composables/useScanCache";
import { SCENARIO_KEYS } from "../menus/contextMenu";
import type { ScannedAppEntry, ScannedFallbackSection } from "../types/scan-cache";
import type { ClipboardSearchResult, CommandSearchResult, RecentFileSearchResult } from "../types/search-extensions";
import type { ScenarioKey } from "../stores/launcherStore";

const DEBUG_SEARCH = false;
const RECENT_FILE_CACHE_KEY = "home-search-recent-file-candidates-v1";
const EXTERNAL_CONVERT_DRAG_EVENT = "external-convert-drag-start";

type RecentFileRow = {
    name: string;
    path: string;
    usedAt: number;
    iconBase64: string | null;
};

type ExternalConvertDragPayload = {
    itemPath: string;
    clientX: number;
    clientY: number;
};

function debugLog(...args: unknown[]) {
  if (DEBUG_SEARCH) {
    console.log("[Search]", ...args);
  }
}

function normalizeRecentFileRows(rows: RecentFileRow[]): RecentFileSearchResult[] {
    return rows
        .map((row) => ({
            key: `recent-file:${normalizePathKey(row.path)}`,
            name: row.name?.trim() || row.path,
            path: row.path,
            usedAt: Number.isFinite(row.usedAt) ? row.usedAt : Date.now(),
            iconBase64: row.iconBase64 || null,
        }))
        .filter((row) => !!row.path.trim());
}

function mergeRecentFileIcons(
    rows: RecentFileSearchResult[],
    iconByPath: Map<string, string>
): RecentFileSearchResult[] {
    return rows.map((row) => {
        const existing = normalizeIconBase64(row.iconBase64);
        if (existing) return row;
        const mergedIcon = iconByPath.get(normalizePathKey(row.path));
        if (!mergedIcon) return row;
        return {
            ...row,
            iconBase64: mergedIcon,
        };
    });
}

function readRecentFileCandidatesCache(): RecentFileSearchResult[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.sessionStorage.getItem(RECENT_FILE_CACHE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const rows = parsed as RecentFileSearchResult[];
        return rows
            .filter((row) => typeof row?.path === "string")
            .map((row) => ({
                key: typeof row.key === "string" ? row.key : `recent-file:${normalizePathKey(row.path)}`,
                name: typeof row.name === "string" ? row.name : row.path,
                path: row.path,
                usedAt: Number.isFinite(row.usedAt) ? row.usedAt : Date.now(),
                iconBase64: row.iconBase64 || null,
            }));
    } catch {
        return [];
    }
}

function writeRecentFileCandidatesCache(rows: RecentFileSearchResult[]): void {
    if (typeof window === "undefined") return;
    try {
        const compactRows = rows.map((row) => ({
            key: row.key,
            name: row.name,
            path: row.path,
            usedAt: row.usedAt,
            iconBase64: null,
        }));
        window.sessionStorage.setItem(RECENT_FILE_CACHE_KEY, JSON.stringify(compactRows));
    } catch {
        // ignore cache write failures
    }
}

const store = Store();
const settingsStore = useSettingsStore();
const statsStore = useStatsStore();
const clipboardStore = useClipboardStore();
const uiStore = useUIStore();
const categoryStore = useCategoryStore();
const searchExtensionsStore = useSearchExtensionsStore();
const router = useRouter();

const {
    searchKeyword,
    rustSearchResults,
    rustSearchMergedResults,
    isRustSearchReady,
} = storeToRefs(store);
const { categoryCols } = storeToRefs(uiStore);
const { getFallbackSection, loadCache, warmLauncherPathKeys, hydrateSectionIcons } = useScanCache();
const scannedFallbackSection = ref<ScannedFallbackSection | null>(null);
const {
    displayCategories,
    editingCategoryId,
    editingCategoryName,
    isEditingCategory,
    isNewCategory,
} = storeToRefs(categoryStore);
const { autoHideAfterLaunch } = storeToRefs(settingsStore);

const searchBoxRef = ref<InstanceType<typeof SearchBox> | null>(null);
const searchShellRef = ref<HTMLElement | null>(null);

const selectedIndex = ref(-1);
const isSearchHistoryOpen = ref(false);
const isHomeSearchPending = ref(false);
const showShortcutHints = ref(false);
const stableRecentDisplayItems = ref<HomeRecentDisplayItem[]>([]);
type HomeFocusRegion = "pinned" | "recent" | "category";
const isHomeKeyboardNavActive = ref(false);
const homeFocusRegion = ref<HomeFocusRegion>("pinned");
const homePinnedSelectedIndex = ref(0);
const homeRecentSelectedIndex = ref(0);
const homeCategorySelectedIndex = ref(0);
const recentFileCandidates = ref<RecentFileSearchResult[]>(
    searchExtensionsStore.recentFileCandidates.length > 0
        ? [...searchExtensionsStore.recentFileCandidates]
        : readRecentFileCandidatesCache()
);
let recentFileIconHydrationRequestId = 0;
let recentStabilizeTimer: ReturnType<typeof setTimeout> | null = null;
const RECENT_STABILIZE_DELAY_MS = 280;
const externalConvertDragVisible = ref(false);
const externalConvertDragPath = ref("");
const externalConvertDragName = ref("");
const externalConvertDragIconBase64 = ref<string | null>(null);
const externalConvertPointerId = ref<number | null>(null);
const externalConvertPointerX = ref(0);
const externalConvertPointerY = ref(0);

const externalConvertGhostStyle = computed(() => ({
    left: `${externalConvertPointerX.value}px`,
    top: `${externalConvertPointerY.value}px`,
}));

function hasSameRecentKeyOrder(
    prev: HomeRecentDisplayItem[],
    next: HomeRecentDisplayItem[]
): boolean {
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i += 1) {
        if (prev[i]?.key !== next[i]?.key) {
            return false;
        }
    }
    return true;
}

function isExternalToInternalPathReplacement(
    prev: HomeRecentDisplayItem[],
    next: HomeRecentDisplayItem[]
): boolean {
    if (prev.length !== next.length || prev.length === 0) {
        return false;
    }

    let replacementCount = 0;
    for (let i = 0; i < prev.length; i += 1) {
        const prevItem = prev[i];
        const nextItem = next[i];
        if (!prevItem || !nextItem) {
            return false;
        }
        if (prevItem.key === nextItem.key) {
            continue;
        }

        if (!("external" in prevItem) || !("recent" in nextItem)) {
            return false;
        }

        const prevPath = normalizePathForCompare(prevItem.external.path);
        const nextPath = normalizePathForCompare(nextItem.item.path);
        if (!prevPath || !nextPath || prevPath !== nextPath) {
            return false;
        }
        replacementCount += 1;
    }

    return replacementCount > 0;
}

function normalizePathKey(path: string): string {
    return path.trim().replace(/\//g, "\\").toLowerCase();
}

function normalizeKeywordTokens(keyword: string): string[] {
    return keyword
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}

function includesAllTokens(target: string, tokens: string[]): boolean {
    if (tokens.length === 0) return false;
    const haystack = target.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
}

function fuzzyMatchWithGapLimit(target: string, keyword: string, maxGap: number): boolean {
    let lastMatchIndex = -1;
    for (let i = 0; i < keyword.length; i += 1) {
        const ch = keyword[i];
        const nextIndex = target.indexOf(ch, lastMatchIndex + 1);
        if (nextIndex === -1) return false;
        if (lastMatchIndex >= 0 && nextIndex - lastMatchIndex - 1 > maxGap) {
            return false;
        }
        lastMatchIndex = nextIndex;
    }
    return true;
}

function buildWordInitials(text: string): string {
    const source = text.toLowerCase();
    let initials = "";
    let prevIsAlnum = false;

    for (const ch of source) {
        const isAlnum = /[a-z0-9]/.test(ch);
        if (!isAlnum) {
            prevIsAlnum = false;
            continue;
        }
        if (!prevIsAlnum) {
            initials += ch;
        }
        prevIsAlnum = true;
    }

    return initials;
}

function extensionMatchRank(type: "exact" | "prefix" | "substring" | "fuzzy"): number {
    switch (type) {
        case "exact":
            return 0;
        case "prefix":
            return 1;
        case "substring":
            return 2;
        case "fuzzy":
        default:
            return 3;
    }
}

function resolveExtensionMatchType(
    rawTarget: string,
    tokens: string[]
): "exact" | "prefix" | "substring" | "fuzzy" | null {
    if (tokens.length === 0) return null;
    const target = rawTarget.trim().toLowerCase();
    const keyword = tokens.join(" ").trim().toLowerCase();
    if (!target || !keyword) return null;
    if (target === keyword) return "exact";
    if (target.startsWith(keyword)) return "prefix";
    if (includesAllTokens(target, tokens)) return "substring";
    if (tokens.length !== 1) return null;
    if (keyword.length < 3) return null;

    const compactTarget = target.replace(/[\s._\\/-]+/g, "");
    const compactKeyword = keyword.replace(/[\s._\\/-]+/g, "");
    if (compactKeyword.length < 3) return null;
    if (compactTarget.includes(compactKeyword)) return "substring";

    if (compactKeyword.length === 3) {
        const initials = buildWordInitials(rawTarget);
        if (initials.includes(compactKeyword)) {
            return "fuzzy";
        }
        return null;
    }

    if (fuzzyMatchWithGapLimit(compactTarget, compactKeyword, 2)) {
        return "fuzzy";
    }
    return null;
}

function buildClipboardPreview(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized) return "空文本";
    if (normalized.length <= 70) return normalized;
    return `${normalized.slice(0, 70)}...`;
}

const SCENARIO_COMMANDS: ReadonlyArray<{
    scenario: ScenarioKey;
    title: string;
    command: string;
    subtitle: string;
}> = [
    { scenario: "work", title: "启动工作场景", command: "/work", subtitle: "批量启动 work 场景启动项" },
    { scenario: "dev", title: "启动开发场景", command: "/dev", subtitle: "批量启动 dev 场景启动项" },
    { scenario: "play", title: "启动娱乐场景", command: "/play", subtitle: "批量启动 play 场景启动项" },
];

function isScenarioKey(value: string): value is ScenarioKey {
    return (SCENARIO_KEYS as readonly string[]).includes(value);
}

const { setLaunchStatus, clearLaunchStatus, getLaunchStatus } = useLaunchStatus({
    autoHideAfterLaunch,
});

const showSearchHistoryPanel = computed(() => (
    isSearchHistoryOpen.value && !searchKeyword.value.trim()
));
const searchHistoryEntries = computed<SearchKeywordRecord[]>(() =>
    getRecentSearchHistoryEntries<SearchKeywordRecord>(statsStore.searchHistory, 8)
);
const homeSearchViewState = computed(() => {
    if (searchKeyword.value.trim()) {
        const launcherCount = rustSearchMergedResults.value?.length ?? 0;
        const hasFallbackResults = scannedFallbackSection.value && scannedFallbackSection.value.items.length > 0;
        const hasExtensionResults = commandSearchResults.value.length > 0
            || clipboardSearchResults.value.length > 0
            || recentFileSearchResults.value.length > 0;

        if (launcherCount > 0 || hasFallbackResults || hasExtensionResults) {
            return "results";
        }
        if (launcherCount === 0 && !hasFallbackResults && !hasExtensionResults && !isHomeSearchPending.value) {
            return "fallback";
        }
        return "results";
    }
    return "home";
});

let unlistenFocus: (() => void) | null = null;
let unlistenShow: (() => void) | null = null;
let pendingHomeSearchSelection: (SearchSelectionTarget & { keyword: string }) | null = null;
let homeSearchRequestId = 0;

onClickOutside(searchShellRef, () => {
    if (showSearchHistoryPanel.value) {
        closeSearchHistoryPanel();
    }
});

onMounted(async () => {
    const win = getCurrentWindow();

    if (searchExtensionsStore.recentFileCandidates.length > 0) {
        recentFileCandidates.value = [...searchExtensionsStore.recentFileCandidates];
    } else if (recentFileCandidates.value.length === 0) {
        recentFileCandidates.value = readRecentFileCandidatesCache();
    }

    void loadRecentFileCandidates();
    if (!ensureIndexPromise) {
        ensureIndexPromise = store.syncSearchIndex().finally(() => {
            ensureIndexPromise = null;
        });
    }
    void ensureIndexPromise;
    void loadCache().catch((error) => {
        console.warn("Failed to preload scan cache:", error);
    });
    void warmLauncherPathKeys().catch((error) => {
        console.warn("Failed to warm launcher path keys:", error);
    });
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("keyup", onKeyup);
    document.addEventListener("mousedown", onDocumentMouseDown, true);

    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        if (!focused) {
            showShortcutHints.value = false;
            closeSearchHistoryPanel();
            resetHomeKeyboardNav();
            return;
        }

        nextTick(() => {
            searchBoxRef.value?.focus();
        });
    });

    unlistenShow = await listen("window-shown", () => {
        closeSearchHistoryPanel();
        isHomeSearchPending.value = false;
        pendingHomeSearchSelection = null;
        showShortcutHints.value = false;
        store.clearSearch();
        selectedIndex.value = -1;
        nextTick(() => {
            searchBoxRef.value?.focus();
        });
    });

    nextTick(() => {
        searchBoxRef.value?.focus();
    });

    window.addEventListener(
        EXTERNAL_CONVERT_DRAG_EVENT,
        onExternalConvertDragStart as EventListener
    );
    window.addEventListener("pointermove", onExternalConvertPointerMove, true);
    window.addEventListener("pointerup", onExternalConvertPointerUp, true);
    window.addEventListener("pointercancel", cancelExternalConvertDrag, true);
});

async function loadRecentFileCandidates(): Promise<void> {
    try {
        const rows = await invokeOrThrow<RecentFileRow[]>("get_recent_files", {
            limit: 80,
            includeIcons: false,
        });
        const normalizedRows = normalizeRecentFileRows(rows);
        const iconByPath = new Map<string, string>();
        for (const row of recentFileCandidates.value) {
            const icon = normalizeIconBase64(row.iconBase64);
            if (!icon) continue;
            iconByPath.set(normalizePathKey(row.path), icon);
        }

        const mergedRows = mergeRecentFileIcons(normalizedRows, iconByPath);
        recentFileCandidates.value = mergedRows;
        searchExtensionsStore.setRecentFileCandidates(mergedRows);
        writeRecentFileCandidatesCache(mergedRows);
        void hydrateRecentFileCandidateIcons(mergedRows);
    } catch (error) {
        console.warn("Failed to load recent file candidates:", error);
    }
}

async function hydrateRecentFileCandidateIcons(rows: RecentFileSearchResult[]): Promise<void> {
    const missingPaths: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        if (normalizeIconBase64(row.iconBase64)) continue;
        const normalizedPath = normalizePathKey(row.path);
        if (!normalizedPath || seen.has(normalizedPath)) continue;
        seen.add(normalizedPath);
        missingPaths.push(row.path);
    }

    if (missingPaths.length === 0) return;

    const requestId = ++recentFileIconHydrationRequestId;
    try {
        const iconRows = await invokeOrThrow<Array<string | null>>("extract_icons_from_paths", {
            paths: missingPaths,
        });
        if (requestId !== recentFileIconHydrationRequestId) return;

        const iconByPath = new Map<string, string>();
        for (let i = 0; i < missingPaths.length; i += 1) {
            const icon = normalizeIconBase64(iconRows[i]);
            if (!icon) continue;
            iconByPath.set(normalizePathKey(missingPaths[i]), icon);
        }
        if (iconByPath.size === 0) return;

        const mergedRows = mergeRecentFileIcons(recentFileCandidates.value, iconByPath);
        recentFileCandidates.value = mergedRows;
        searchExtensionsStore.setRecentFileCandidates(mergedRows);
        writeRecentFileCandidatesCache(mergedRows);
    } catch (error) {
        console.warn("Failed to hydrate recent file icons:", error);
    }
}

onUnmounted(() => {
    if (unlistenFocus) unlistenFocus();
    if (unlistenShow) unlistenShow();
    if (recentStabilizeTimer) {
        clearTimeout(recentStabilizeTimer);
        recentStabilizeTimer = null;
    }
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("keyup", onKeyup);
    document.removeEventListener("mousedown", onDocumentMouseDown, true);
    window.removeEventListener(
        EXTERNAL_CONVERT_DRAG_EVENT,
        onExternalConvertDragStart as EventListener
    );
    window.removeEventListener("pointermove", onExternalConvertPointerMove, true);
    window.removeEventListener("pointerup", onExternalConvertPointerUp, true);
    window.removeEventListener("pointercancel", cancelExternalConvertDrag, true);
    cancelExternalConvertDrag();
});

const { pinnedMergedItems, mergedRecentDisplayItems } = useHomePageState();

watchEffect(() => {
    const next = mergedRecentDisplayItems.value;
    const previous = stableRecentDisplayItems.value;
    if (recentStabilizeTimer) {
        clearTimeout(recentStabilizeTimer);
    }
    if (next.length < previous.length) {
        // Dedup/cleanup updates (e.g. lnk target resolution) should be immediate
        // to avoid showing transient duplicate recent items on startup.
        stableRecentDisplayItems.value = [...next];
        recentStabilizeTimer = null;
        return;
    }
    if (previous.length === 0 || next.length === 0) {
        stableRecentDisplayItems.value = [...next];
        recentStabilizeTimer = null;
        return;
    }
    if (hasSameRecentKeyOrder(previous, next)) {
        stableRecentDisplayItems.value = [...next];
        recentStabilizeTimer = null;
        return;
    }
    if (isExternalToInternalPathReplacement(previous, next)) {
        stableRecentDisplayItems.value = [...next];
        recentStabilizeTimer = null;
        return;
    }
    recentStabilizeTimer = setTimeout(() => {
        stableRecentDisplayItems.value = [...next];
        recentStabilizeTimer = null;
    }, RECENT_STABILIZE_DELAY_MS);
});

const pinnedLayout = computed(() => uiStore.getHomeSectionLayout("pinned"));
const recentLayout = computed(() => uiStore.getHomeSectionLayout("recent"));

function closeSearchHistoryPanel() {
    isSearchHistoryOpen.value = false;
}

function toggleSearchHistoryPanel() {
    if (searchKeyword.value.trim()) return;
    isSearchHistoryOpen.value = !isSearchHistoryOpen.value;
    nextTick(() => {
        searchBoxRef.value?.focus();
    });
}

function onSelectSearchHistory(keyword: string) {
    closeSearchHistoryPanel();
    pendingHomeSearchSelection = null;
    selectedIndex.value = -1;
    searchKeyword.value = keyword;
    nextTick(() => {
        searchBoxRef.value?.focus();
    });
}

function getSearchHistoryLabel(entry: SearchKeywordRecord) {
    return getSearchHistoryDisplayKeyword(entry);
}

function onRemoveSearchHistory(keyword: string) {
    statsStore.removeSearchHistory(keyword);
    nextTick(() => {
        searchBoxRef.value?.focus();
    });
}

function onClearSearchHistory() {
    statsStore.clearSearchHistory();
    nextTick(() => {
        searchBoxRef.value?.focus();
    });
}

function onClickCategory(element: CategoryType) {
    if (isEditingCategory.value) return;
    categoryStore.setCurrentCategory(element.id);
    router.push({ name: "category", params: { categoryId: element.id } });
}

function onUpdateCategories(newCategories: CategoryType[]) {
    categoryStore.reorderCategories(newCategories);
}

function onConfirmCategoryEdit() {
    if (!editingCategoryName.value.trim()) {
        showToast("分类名称不能为空");
        return;
    }
    categoryStore.confirmCategoryEdit(editingCategoryName.value);
}

function onCancelCategoryEdit() {
    categoryStore.cancelCategoryEdit();
}

async function onBrowserSearch() {
    const keyword = searchKeyword.value.trim();
    if (!keyword) return;

    try {
        await invokeOrThrow("open_browser_search", { query: keyword });
        closeSearchHistoryPanel();
        store.recordConfirmedSearch();
        store.clearSearch();
        selectedIndex.value = -1;
    } catch (error) {
        console.error(error);
        showToast("无法使用默认浏览器搜索", { type: "error" });
    }
}

async function onSelectScannedApp(entry: ScannedAppEntry) {
    try {
        await invokeOrThrow("launch_scanned_app", { path: entry.path });
    } catch (e) {
        showToast(`无法启动 ${entry.name}，可能已被卸载`, { type: "error" });
        return;
    }

    const itemId = await store.addScannedAppToLauncher({
        name: entry.name,
        path: entry.path,
        source: entry.source,
        publisher: entry.publisher,
        iconBase64: entry.iconBase64,
    });

    if (itemId) {
        invokeOrThrow("extract_icon_lazy", { path: entry.path }).catch(() => {});
    }

    closeSearchHistoryPanel();
    store.recordConfirmedSearch();
    store.clearSearch();
    selectedIndex.value = -1;
}

async function onOpenSearchResult(result: GlobalSearchMergedResult) {
    store.recordConfirmedSearch();

    if (!result?.item || !result?.primaryCategoryId) return;
    const item = result.item;
    closeSearchHistoryPanel();
    store.clearSearch();
    setLaunchStatus(item.id, "launching");
    try {
        await launchStoredItem(
            {
                categoryId: result.primaryCategoryId,
                itemId: item.id,
            },
            {
                store,
                notifyError: true,
            }
        );
        setLaunchStatus(item.id, "success");
    } catch (e) {
        console.error(e);
        clearLaunchStatus(item.id);
    }
}

function normalizePathForCompare(path: string): string {
    return path.replace(/\//g, "\\").trim().toLowerCase();
}

function findExternalRecordByPath(path: string) {
    const normalized = normalizePathForCompare(path);
    return statsStore.externalRecentLaunches.find(
        (entry) => normalizePathForCompare(entry.path) === normalized
    );
}

function tryResolveCategoryIdFromPoint(x: number, y: number): string | null {
    const elements = document.elementsFromPoint(x, y);
    for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        const target = element.closest(".categorie-item[data-category-id]");
        if (!(target instanceof HTMLElement)) continue;
        const categoryId = target.dataset.categoryId || null;
        if (categoryId) return categoryId;
    }
    return null;
}

function addExternalPathToCategory(path: string, categoryId: string): boolean {
    const category = categoryStore.getCategoryById(categoryId);
    if (!category) return false;

    const normalizedPath = normalizePathForCompare(path);
    const duplicateExists = store
        .getLauncherItemsByCategoryId(categoryId)
        .some((item) => item.itemType === "file" && normalizePathForCompare(item.path) === normalizedPath);
    if (duplicateExists) {
        showToast(`「${category.name}」中已存在该启动项`);
        return false;
    }

    const externalRecord = findExternalRecordByPath(path);
    const createdItemIds = store.addLauncherItemsToCategory(categoryId, {
        paths: [path],
        directories: [],
        icon_base64s: [externalRecord?.iconBase64 ?? null],
        itemTypes: ["file"],
    });
    const createdItemId = createdItemIds[0];
    if (createdItemId) {
        store.recordItemUsage(
            categoryId,
            createdItemId,
            externalRecord?.usedAt ?? Date.now()
        );
    }
    showToast(`已添加到「${category.name}」`);
    return true;
}

function onExternalConvertDragStart(event: CustomEvent<ExternalConvertDragPayload>) {
    const payload = event.detail;
    const rawPath = payload?.itemPath?.trim() || "";
    if (!rawPath) return;

    const record = findExternalRecordByPath(rawPath);
    externalConvertDragPath.value = rawPath;
    externalConvertDragName.value =
        record?.name ||
        rawPath.split(/[\\/]/).pop() ||
        rawPath;
    externalConvertDragIconBase64.value = record?.iconBase64 || null;
    externalConvertDragVisible.value = true;
    externalConvertPointerId.value = null;
    externalConvertPointerX.value = Number.isFinite(payload.clientX)
        ? payload.clientX
        : window.innerWidth / 2;
    externalConvertPointerY.value = Number.isFinite(payload.clientY)
        ? payload.clientY
        : window.innerHeight / 2;
}

function onExternalConvertPointerMove(event: PointerEvent) {
    if (!externalConvertDragVisible.value) return;
    if (
        externalConvertPointerId.value !== null &&
        event.pointerId !== externalConvertPointerId.value
    ) {
        return;
    }
    externalConvertPointerId.value = event.pointerId;
    externalConvertPointerX.value = event.clientX;
    externalConvertPointerY.value = event.clientY;
}

function onExternalConvertPointerUp(event: PointerEvent) {
    if (!externalConvertDragVisible.value) return;
    if (
        externalConvertPointerId.value !== null &&
        event.pointerId !== externalConvertPointerId.value
    ) {
        return;
    }

    const targetCategoryId = tryResolveCategoryIdFromPoint(event.clientX, event.clientY);
    if (!targetCategoryId) {
        cancelExternalConvertDrag();
        return;
    }

    addExternalPathToCategory(externalConvertDragPath.value, targetCategoryId);
    cancelExternalConvertDrag();
}

function cancelExternalConvertDrag() {
    externalConvertDragVisible.value = false;
    externalConvertDragPath.value = "";
    externalConvertDragName.value = "";
    externalConvertDragIconBase64.value = null;
    externalConvertPointerId.value = null;
}

async function onSelectClipboardResult(entry: ClipboardSearchResult) {
    if (!entry) return;
    try {
        if (entry.contentType === "image" && entry.imagePath) {
            await invokeOrThrow("set_clipboard_content", {
                content: entry.imagePath,
                isImage: true,
            });
        } else {
            await invokeOrThrow("set_clipboard_content", {
                content: entry.textContent,
                isImage: false,
            });
        }
        showToast("已复制剪贴板历史项");
    } catch (error) {
        console.error("Failed to select clipboard result:", error);
        showToast("复制失败", { type: "error" });
    }
}

async function onOpenCommandResult(entry: CommandSearchResult) {
    const scenario = (entry.action || "").trim();
    if (!isScenarioKey(scenario)) return;

    const targets = store.getScenarioLaunchItems(scenario);
    if (targets.length === 0) {
        showToast(`场景 ${entry.commandText} 暂无启动项`);
        return;
    }

    closeSearchHistoryPanel();
    store.recordConfirmedSearch();
    store.clearSearch();
    selectedIndex.value = -1;

    let successCount = 0;
    for (const target of targets) {
        try {
            await launchStoredItem(
                {
                    categoryId: target.categoryId,
                    itemId: target.item.id,
                },
                {
                    store,
                    notifyError: false,
                }
            );
            successCount += 1;
        } catch (error) {
            console.error("Failed to launch scenario item:", error);
        }
    }

    if (successCount === targets.length) {
        showToast(`${entry.commandText} 已启动 ${successCount} 个项目`);
        return;
    }

    if (successCount > 0) {
        showToast(
            `${entry.commandText} 启动完成 ${successCount}/${targets.length}`,
            { type: "info" }
        );
        return;
    }

    showToast(`${entry.commandText} 启动失败`, { type: "error" });
}

async function onOpenRecentFileResult(entry: RecentFileSearchResult) {
    if (!entry?.path) return;
    try {
        await openPathWithSystem(entry.path);
    } catch (error) {
        console.error("Failed to open recent file:", error);
        showToast(`无法打开 ${entry.name}`, { type: "error" });
    }
}

function isExternalRecentItem(item: HomeRecentDisplayItem): item is Exclude<HomeRecentDisplayItem, RecentUsedMergedItem> {
    return "external" in item;
}

async function onOpenRecentItem(item: HomeRecentDisplayItem) {
    if (isExternalRecentItem(item)) {
        const statusKey = item.key;
        setLaunchStatus(statusKey, "launching");
        try {
            await openPathWithSystem(item.external.path);
            setLaunchStatus(statusKey, "success");
            statsStore.recordExternalLaunch({
                path: item.external.path,
                name: item.external.name,
                source: item.external.source,
                iconBase64: item.external.iconBase64,
                usedAt: Date.now(),
            });
        } catch (e) {
            console.error(e);
            clearLaunchStatus(statusKey);
            showToast(`无法启动 ${item.external.name}`, { type: "error" });
        }
        return;
    }

    if (!item?.item || !item?.recent?.categoryId) return;
    setLaunchStatus(item.item.id, "launching");
    try {
        await launchStoredItem(
            {
                categoryId: item.recent.categoryId,
                itemId: item.item.id,
            },
            {
                store,
                notifyError: true,
            }
        );
        setLaunchStatus(item.item.id, "success");
    } catch (e) {
        console.error(e);
        clearLaunchStatus(item.item.id);
    }
}

async function onOpenPinnedItem(item: PinnedMergedItem) {
    if (!item?.item || !item?.primaryCategoryId) return;
    setLaunchStatus(item.item.id, "launching");
    try {
        await launchStoredItem(
            {
                categoryId: item.primaryCategoryId,
                itemId: item.item.id,
            },
            {
                store,
                notifyError: true,
            }
        );
        setLaunchStatus(item.item.id, "success");
    } catch (e) {
        console.error(e);
        clearLaunchStatus(item.item.id);
    }
}

function onReorderPinnedItems(newOrder: string[]) {
    store.reorderPinnedItemIds(newOrder);
}

const { createCooldown } = useLaunchCooldown({ cooldown: 2500 });

const launchSearchWithCd = createCooldown(onOpenSearchResult);
const launchCommandWithCd = createCooldown(onOpenCommandResult);
const launchRecentWithCd = createCooldown(onOpenRecentItem);
const launchPinnedWithCd = createCooldown(onOpenPinnedItem);
const selectClipboardWithCd = createCooldown(onSelectClipboardResult);
const openRecentFileWithCd = createCooldown(onOpenRecentFileResult);

watch(editingCategoryId, async (value) => {
    if (!value) return;
    await nextTick();
});

const throttledRustSearch = useThrottleFn(async (keyword: string, requestId: number) => {
    const fallbackPromise = getFallbackSection(keyword).catch((error) => {
        console.warn("Search fallback error:", error);
        return null;
    });

    try {
        const results = await store.searchLauncherItems({ keyword });
        if (requestId !== homeSearchRequestId) return;
        rustSearchResults.value = results;
        debugLog("results length:", results.length, "keyword:", keyword);

        if (results.length <= 3) {
            debugLog("awaiting fallback section for:", keyword);
            const fallbackSection = await fallbackPromise;
            if (requestId !== homeSearchRequestId) return;
            scannedFallbackSection.value = fallbackSection;
            if (fallbackSection) {
                void hydrateSectionIcons(fallbackSection).then((hydratedSection) => {
                    if (requestId !== homeSearchRequestId) return;
                    scannedFallbackSection.value = hydratedSection;
                });
            }
            debugLog("fallback result:", !!scannedFallbackSection.value, scannedFallbackSection.value?.items?.length);
        } else {
            scannedFallbackSection.value = null;
        }
    } catch (e) {
        console.warn("Launcher search error:", e);
        if (requestId === homeSearchRequestId) {
            scannedFallbackSection.value = null;
        }
    } finally {
        if (requestId === homeSearchRequestId) {
            isHomeSearchPending.value = false;
        }
    }
}, SEARCH_THROTTLE_MS, true);

let ensureIndexPromise: Promise<void> | null = null;

async function ensureRustSearchReady(): Promise<boolean> {
    if (isRustSearchReady.value) return true;
    if (!ensureIndexPromise) {
        ensureIndexPromise = store.syncSearchIndex().finally(() => {
            ensureIndexPromise = null;
        });
    }
    await ensureIndexPromise;
    return isRustSearchReady.value;
}

watch(searchKeyword, async (keyword) => {
    debugLog("keyword changed:", keyword);
    const trimmedKeyword = keyword.trim();
    const isPendingTabSelection = pendingHomeSearchSelection?.keyword === trimmedKeyword;
    if (!isPendingTabSelection) {
        pendingHomeSearchSelection = null;
        selectedIndex.value = -1;
    }

    homeSearchRequestId += 1;
    const requestId = homeSearchRequestId;

    if (!trimmedKeyword) {
        pendingHomeSearchSelection = null;
        rustSearchResults.value = [];
        scannedFallbackSection.value = null;
        isHomeSearchPending.value = false;
        showShortcutHints.value = false;
        resetHomeKeyboardNav();
        return;
    }

    closeSearchHistoryPanel();
    isHomeSearchPending.value = true;
    const ready = await ensureRustSearchReady();
    if (!ready || requestId !== homeSearchRequestId) {
        if (requestId === homeSearchRequestId) {
            isHomeSearchPending.value = false;
        }
        return;
    }
    await throttledRustSearch(trimmedKeyword, requestId);
});

const currentSearchResults = computed(() => {
    return rustSearchMergedResults.value ?? [];
});

const clipboardSearchResults = computed<ClipboardSearchResult[]>(() => {
    const keyword = searchKeyword.value.trim();
    if (!keyword) return [];
    const tokens = normalizeKeywordTokens(keyword);
    if (tokens.length === 0) return [];

    const matched: ClipboardSearchResult[] = [];

    for (const record of clipboardStore.clipboardHistory) {
        const textContent = record.content_type === "text"
            ? getRecordContent(record)
            : (record.image_path || "");
        const normalizedTarget = record.content_type === "image"
            ? textContent
            : `${textContent} ${buildClipboardPreview(textContent)}`;
        const matchType = resolveExtensionMatchType(normalizedTarget, tokens);
        if (!matchType) continue;

        matched.push({
            key: `clipboard:${record.id}`,
            id: record.id,
            hash: record.hash,
            contentType: record.content_type,
            textContent,
            imagePath: record.image_path,
            timestamp: record.timestamp,
            preview: record.content_type === "image"
                ? `图片：${record.image_path || "未命名图片"}`
                : buildClipboardPreview(textContent),
            matchType,
        });
    }
    matched.sort((a, b) => {
        const rankDiff = extensionMatchRank(a.matchType || "fuzzy") - extensionMatchRank(b.matchType || "fuzzy");
        if (rankDiff !== 0) return rankDiff;
        return b.timestamp - a.timestamp;
    });
    return matched.slice(0, 8);
});

const recentFileSearchResults = computed<RecentFileSearchResult[]>(() => {
    const keyword = searchKeyword.value.trim();
    if (!keyword) return [];
    const tokens = normalizeKeywordTokens(keyword);
    if (tokens.length === 0) return [];

    const launcherPathSet = new Set<string>();
    for (const items of Object.values(store.launcherItemsByCategoryId)) {
        for (const item of items) {
            if (item.itemType !== "file") continue;
            const normalized = normalizePathKey(item.path || "");
            if (normalized) launcherPathSet.add(normalized);
        }
    }

    const matched: RecentFileSearchResult[] = [];
    for (const entry of recentFileCandidates.value) {
        const normalizedPath = normalizePathKey(entry.path);
        if (!normalizedPath) continue;
        if (launcherPathSet.has(normalizedPath)) continue;
        const matchType = resolveExtensionMatchType(`${entry.name} ${entry.path}`, tokens);
        if (!matchType) continue;

        matched.push({
            ...entry,
            matchType,
        });
    }
    matched.sort((a, b) => {
        const rankDiff = extensionMatchRank(a.matchType || "fuzzy") - extensionMatchRank(b.matchType || "fuzzy");
        if (rankDiff !== 0) return rankDiff;
        return b.usedAt - a.usedAt;
    });
    return matched.slice(0, 10);
});

const commandSearchResults = computed<CommandSearchResult[]>(() => {
    const keyword = searchKeyword.value.trim();
    if (!keyword) return [];
    const tokens = normalizeKeywordTokens(keyword);
    if (tokens.length === 0) return [];

    const getMatchType = (value: string): "exact" | "prefix" | "substring" | "fuzzy" | null =>
        resolveExtensionMatchType(value, tokens);

    const matched = SCENARIO_COMMANDS
        .flatMap((entry) => {
            const targetText = `${entry.command} ${entry.title} ${entry.subtitle}`;
            const commandMatch = getMatchType(entry.command);
            const textMatch = getMatchType(targetText);
            const matchType = commandMatch ?? textMatch;
            if (!matchType) return [];
            return [{
                key: `command:${entry.scenario}`,
                title: entry.title,
                subtitle: entry.subtitle,
                commandText: entry.command,
                action: entry.scenario,
                matchType,
            } satisfies CommandSearchResult];
        })
        .filter((entry) => !!entry);

    matched.sort((a, b) => {
        const rankDiff = extensionMatchRank(a.matchType || "fuzzy") - extensionMatchRank(b.matchType || "fuzzy");
        if (rankDiff !== 0) return rankDiff;
        return a.commandText.localeCompare(b.commandText);
    });

    return matched;
});

const searchSectionCounts = computed(() => ({
    command: commandSearchResults.value.length,
    launcher: currentSearchResults.value.length,
    browser: showBrowserSearchOption.value ? 1 : 0,
    scanned: scannedFallbackSection.value?.items.length ?? 0,
    clipboard: clipboardSearchResults.value.length,
    "recent-file": recentFileSearchResults.value.length,
}));

function triggerSearchSelectionAt(index: number): void {
    const sectionTarget = getSearchSectionIndex(index, searchSectionCounts.value);
    if (!sectionTarget) return;

    if (sectionTarget.section === "command") {
        const commandEntry = commandSearchResults.value[sectionTarget.offset];
        if (commandEntry) launchCommandWithCd(commandEntry);
        return;
    }

    if (sectionTarget.section === "launcher") {
        const launcherEntry = currentSearchResults.value[sectionTarget.offset];
        if (launcherEntry) launchSearchWithCd(launcherEntry);
        return;
    }

    if (sectionTarget.section === "browser") {
        onBrowserSearch();
        return;
    }

    if (sectionTarget.section === "scanned") {
        const item = scannedFallbackSection.value?.items[sectionTarget.offset];
        if (item) onSelectScannedApp(item);
        return;
    }

    if (sectionTarget.section === "clipboard") {
        const clipboardEntry = clipboardSearchResults.value[sectionTarget.offset];
        if (clipboardEntry) selectClipboardWithCd(clipboardEntry);
        return;
    }

    if (sectionTarget.section === "recent-file") {
        const recentFileEntry = recentFileSearchResults.value[sectionTarget.offset];
        if (recentFileEntry) openRecentFileWithCd(recentFileEntry);
    }
}

const showBrowserSearchOption = computed(() => {
    return searchKeyword.value.trim().length > 0
        && (isHomeSearchPending.value || currentSearchResults.value.length <= 3);
});

const homeFocusRegions = computed<HomeFocusRegion[]>(() => {
    const regions: HomeFocusRegion[] = [];
    if (pinnedMergedItems.value.length > 0) regions.push("pinned");
    if (stableRecentDisplayItems.value.length > 0) regions.push("recent");
    if (displayCategories.value.length > 0) regions.push("category");
    return regions;
});

const homeSelectedCategoryId = computed(() => {
    const categories = displayCategories.value;
    if (categories.length === 0) return null;
    const safeIndex = Math.max(0, Math.min(homeCategorySelectedIndex.value, categories.length - 1));
    return categories[safeIndex]?.id ?? null;
});

function setHomeFocusRegionToDefault(): void {
    const regions = homeFocusRegions.value;
    if (regions.length === 0) return;
    homeFocusRegion.value = regions[0];
    normalizeHomeFocusState();
}

function activateHomeKeyboardNav(): void {
    isHomeKeyboardNavActive.value = true;
    setHomeFocusRegionToDefault();
    nextTick(() => {
        scrollHomeSelectionIntoView();
    });
}

function deactivateHomeKeyboardNav(): void {
    isHomeKeyboardNavActive.value = false;
}

function resetHomeKeyboardNav(): void {
    deactivateHomeKeyboardNav();
    setHomeFocusRegionToDefault();
}

function blurSearchInput(): void {
    const input = searchShellRef.value?.querySelector<HTMLInputElement>("input.search-input");
    input?.blur();
}

function rotateHomeTabCycle(reverse = false): void {
    const regions = homeFocusRegions.value;
    if (regions.length === 0) {
        searchBoxRef.value?.focus();
        resetHomeKeyboardNav();
        return;
    }

    if (!isHomeKeyboardNavActive.value) {
        blurSearchInput();
        activateHomeKeyboardNav();
        return;
    }

    const current = regions.indexOf(homeFocusRegion.value);
    const step = reverse ? -1 : 1;
    const next = current + step;

    if (next < 0 || next >= regions.length) {
        resetHomeKeyboardNav();
        nextTick(() => {
            searchBoxRef.value?.focus();
        });
        return;
    }

    homeFocusRegion.value = regions[next];
    blurSearchInput();
    normalizeHomeFocusState();
    nextTick(() => {
        scrollHomeSelectionIntoView();
    });
}

function onDocumentMouseDown(event: MouseEvent): void {
    if (!isHomeKeyboardNavActive.value) return;
    if (searchKeyword.value.trim() || homeSearchViewState.value !== "home") return;
    if (!(event.target instanceof Element)) return;

    if (
        event.target.closest('.home-card[data-home-section]')
        || event.target.closest(".categorie-item[data-category-id]")
        || event.target.closest(".search-shell")
    ) {
        return;
    }

    resetHomeKeyboardNav();
}

function clampIndex(index: number, count: number): number {
    if (count <= 0) return 0;
    return Math.max(0, Math.min(index, count - 1));
}

function getHomeRegionCount(region: HomeFocusRegion): number {
    if (region === "pinned") return pinnedMergedItems.value.length;
    if (region === "recent") return stableRecentDisplayItems.value.length;
    return displayCategories.value.length;
}

function getHomeRegionCols(region: HomeFocusRegion): number {
    if (region === "pinned") return Math.max(1, pinnedLayout.value.cols || 1);
    if (region === "recent") return Math.max(1, recentLayout.value.cols || 1);
    return Math.max(1, categoryCols.value || 1);
}

function getHomeRegionIndex(region: HomeFocusRegion): number {
    if (region === "pinned") return homePinnedSelectedIndex.value;
    if (region === "recent") return homeRecentSelectedIndex.value;
    return homeCategorySelectedIndex.value;
}

function setHomeRegionIndex(region: HomeFocusRegion, index: number): void {
    if (region === "pinned") {
        homePinnedSelectedIndex.value = index;
        return;
    }
    if (region === "recent") {
        homeRecentSelectedIndex.value = index;
        return;
    }
    homeCategorySelectedIndex.value = index;
}

function normalizeHomeFocusState(): void {
    const availableRegions = homeFocusRegions.value;
    if (availableRegions.length === 0) return;

    if (!availableRegions.includes(homeFocusRegion.value)) {
        homeFocusRegion.value = availableRegions[0];
    }

    homePinnedSelectedIndex.value = clampIndex(homePinnedSelectedIndex.value, pinnedMergedItems.value.length);
    homeRecentSelectedIndex.value = clampIndex(homeRecentSelectedIndex.value, stableRecentDisplayItems.value.length);
    homeCategorySelectedIndex.value = clampIndex(homeCategorySelectedIndex.value, displayCategories.value.length);
}

function getMovedGridIndex(
    currentIndex: number,
    key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
    cols: number,
    count: number
): number {
    if (count <= 0) return 0;
    const safeCols = Math.max(1, cols);
    const safeIndex = clampIndex(currentIndex, count);

    if (key === "ArrowLeft") {
        return Math.max(0, safeIndex - 1);
    }
    if (key === "ArrowRight") {
        return Math.min(count - 1, safeIndex + 1);
    }
    if (key === "ArrowUp") {
        const next = safeIndex - safeCols;
        return next >= 0 ? next : safeIndex;
    }
    const next = safeIndex + safeCols;
    return next < count ? next : safeIndex;
}

function scrollHomeSelectionIntoView(): void {
    if (searchKeyword.value.trim() || homeSearchViewState.value !== "home") return;

    const region = homeFocusRegion.value;
    if (region === "pinned") {
        const nodes = document.querySelectorAll<HTMLElement>('.home-card[data-home-section="pinned"]');
        const node = nodes[homePinnedSelectedIndex.value];
        node?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        return;
    }

    if (region === "recent") {
        const nodes = document.querySelectorAll<HTMLElement>('.home-card[data-home-section="recent"]');
        const node = nodes[homeRecentSelectedIndex.value];
        node?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        return;
    }

    const selectedCategory = displayCategories.value[homeCategorySelectedIndex.value];
    if (!selectedCategory) return;

    const nodes = document.querySelectorAll<HTMLElement>(".categorie-item[data-category-id]");
    for (const node of nodes) {
        if (node.dataset.categoryId === selectedCategory.id) {
            node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
            return;
        }
    }
}

function moveHomeSelectionByKey(key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): void {
    normalizeHomeFocusState();
    const region = homeFocusRegion.value;
    const count = getHomeRegionCount(region);
    if (count <= 0) return;

    const nextIndex = getMovedGridIndex(
        getHomeRegionIndex(region),
        key,
        getHomeRegionCols(region),
        count
    );
    setHomeRegionIndex(region, nextIndex);
    nextTick(() => {
        scrollHomeSelectionIntoView();
    });
}

function triggerHomeSelection(): void {
    normalizeHomeFocusState();
    if (homeFocusRegion.value === "pinned") {
        const item = pinnedMergedItems.value[homePinnedSelectedIndex.value];
        if (item) {
            launchPinnedWithCd(item);
        }
        return;
    }

    if (homeFocusRegion.value === "recent") {
        const item = stableRecentDisplayItems.value[homeRecentSelectedIndex.value];
        if (item) {
            launchRecentWithCd(item);
        }
        return;
    }

    const category = displayCategories.value[homeCategorySelectedIndex.value];
    if (category) {
        onClickCategory(category);
    }
}

const totalSearchItemCount = computed(() => {
    const counts = searchSectionCounts.value;
    return counts.command
        + counts.launcher
        + counts.browser
        + counts.scanned
        + counts.clipboard
        + counts["recent-file"];
});

watch(
    currentSearchResults,
    (results) => {
        if (pendingHomeSearchSelection && !isHomeSearchPending.value) {
            selectedIndex.value = findSearchSelectionIndex(
                results,
                pendingHomeSearchSelection
            );
            pendingHomeSearchSelection = null;
        }

        if (!searchKeyword.value.trim()) return;
        const targets = results.map((result) => ({
            categoryId: result.primaryCategoryId,
            itemId: result.item.id,
        }));
        void store.hydrateMissingIconsForItems(targets);
    },
    { immediate: true }
);

watch(totalSearchItemCount, (count) => {
    if (count <= 0) {
        selectedIndex.value = -1;
        return;
    }
    if (selectedIndex.value >= count) {
        selectedIndex.value = count - 1;
    }
});

watch(
    [
        () => pinnedMergedItems.value.length,
        () => stableRecentDisplayItems.value.length,
        () => displayCategories.value.length,
        () => homeSearchViewState.value,
        () => searchKeyword.value,
    ],
    () => {
        normalizeHomeFocusState();
        if (!searchKeyword.value.trim() && homeSearchViewState.value === "home") {
            nextTick(() => {
                scrollHomeSelectionIntoView();
            });
        }
    },
    { immediate: true }
);

watch(
    [pinnedMergedItems, mergedRecentDisplayItems, searchKeyword],
    ([pinned, recent, keyword]) => {
        if (keyword.trim()) return;
        const targets = [
            ...pinned.map((item) => ({
                categoryId: item.primaryCategoryId,
                itemId: item.item.id,
            })),
            ...recent
                .filter((item): item is Extract<HomeRecentDisplayItem, RecentUsedMergedItem> => "recent" in item)
                .map((item) => ({
                    categoryId: item.recent.categoryId,
                    itemId: item.item.id,
                })),
        ];
        void store.hydrateMissingIconsForItems(targets);
    },
    { immediate: true }
);

function onKeydown(e: KeyboardEvent) {
    const hasBlockingDialog = !!document.querySelector(".confirm-overlay, .input-overlay");
    if (e.key === "Escape" && showSearchHistoryPanel.value) {
        closeSearchHistoryPanel();
        return;
    }

    if (e.key === "Escape" && searchKeyword.value.trim() && !hasBlockingDialog) {
        e.preventDefault();
        pendingHomeSearchSelection = null;
        store.clearSearch();
        scannedFallbackSection.value = null;
        isHomeSearchPending.value = false;
        selectedIndex.value = -1;
        resetHomeKeyboardNav();
        return;
    }

    if (e.key === "Control") {
        showShortcutHints.value = true;
        return;
    }

    if (e.ctrlKey && !e.altKey && !e.metaKey) {
        showShortcutHints.value = true;
        const shortcutIndex = getSearchShortcutIndex(e);
        if (shortcutIndex !== null) {
            if (!searchKeyword.value.trim()) {
                e.preventDefault();
                const target = getHomeShortcutTarget(
                    shortcutIndex,
                    pinnedMergedItems.value.length,
                    stableRecentDisplayItems.value.length
                );
                if (target) {
                    if (target.type === "pinned") {
                        launchPinnedWithCd(pinnedMergedItems.value[target.index]);
                    } else if (target.type === "recent") {
                        launchRecentWithCd(stableRecentDisplayItems.value[target.index]);
                    }
                }
                return;
            }

            e.preventDefault();
            if (shortcutIndex >= totalSearchItemCount.value) {
                return;
            }
            selectedIndex.value = shortcutIndex;
            triggerSearchSelectionAt(shortcutIndex);
            return;
        }
    }

    const isSearchMode = !!searchKeyword.value.trim();

    if (!isSearchMode && homeSearchViewState.value === "home") {
        if (e.key === "Tab") {
            e.preventDefault();
            rotateHomeTabCycle(e.shiftKey);
            return;
        }

        if (
            e.key === "ArrowDown"
            || e.key === "ArrowUp"
            || e.key === "ArrowLeft"
            || e.key === "ArrowRight"
        ) {
            if (!isHomeKeyboardNavActive.value) return;
            e.preventDefault();
            moveHomeSelectionByKey(e.key as "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight");
            return;
        }

        if (e.key === "Enter") {
            if (!isHomeKeyboardNavActive.value) return;
            e.preventDefault();
            triggerHomeSelection();
            return;
        }
    }

    if (!isSearchMode || totalSearchItemCount.value === 0) {
        return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab") {
        return;
    }
}

function onKeyup(e: KeyboardEvent) {
    if (e.key === "Control" || !e.ctrlKey) {
        showShortcutHints.value = false;
    }
}

function onSearchNav(direction: "up" | "down" | "enter" | "tab") {
    if (!searchKeyword.value.trim()) {
        if (homeSearchViewState.value !== "home") return;
        if (direction === "tab") {
            rotateHomeTabCycle();
            return;
        }
        if (!isHomeKeyboardNavActive.value) return;
        if (direction === "down") {
            moveHomeSelectionByKey("ArrowDown");
            return;
        }
        if (direction === "up") {
            moveHomeSelectionByKey("ArrowUp");
            return;
        }
        if (direction === "enter") {
            triggerHomeSelection();
        }
        return;
    }

    if (!searchKeyword.value.trim() || totalSearchItemCount.value === 0) {
        return;
    }

    if (direction === "down") {
        if (selectedIndex.value < totalSearchItemCount.value - 1) {
            selectedIndex.value++;
        } else {
            selectedIndex.value = 0;
        }
        return;
    }

    if (direction === "up") {
        if (selectedIndex.value > 0) {
            selectedIndex.value--;
        } else {
            selectedIndex.value = totalSearchItemCount.value - 1;
        }
        return;
    }

    if (direction === "tab") {
        if (
            totalSearchItemCount.value === 1
            && searchSectionCounts.value.launcher === 1
        ) {
            const result = currentSearchResults.value[0];
            selectedIndex.value = 0;
            pendingHomeSearchSelection = {
                ...createSearchSelectionTarget(result),
                keyword: result.item.name.trim(),
            };
            searchKeyword.value = result.item.name;
        }
        return;
    }

    triggerSearchSelectionAt(selectedIndex.value);
}
</script>

<style lang="scss" scoped>
.categorie-view {
    width: 100vw;
    height: 100vh;
    background: var(--bg-color);
    display: flex;
    flex-direction: column;
    user-select: none;
    border-radius: 12px;
}

.categorie-view.is-editing {
    pointer-events: none;
}

.search-header {
    padding: 12px 16px 0px 16px;
    flex-shrink: 0;
}

.search-shell {
    position: relative;
    width: min(100%, 760px);
    margin: 0 auto;
}

.history-toggle-btn {
    height: 18px;
    border: 0;
    border-radius: 999px;
    background: var(--hover-bg);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s ease, color 0.15s ease;
}

.history-toggle-btn:hover {
    background: var(--hover-bg-strong);
    color: var(--text-color);
}

.search-history-panel {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
    right: 0;
    z-index: 12;
    padding: 12px;
    border-radius: 16px;
    background: var(--search-history-bg);
    border: 1px solid var(--border-color);
    box-shadow: var(--card-shadow);
    backdrop-filter: var(--backdrop-blur);
}

.search-history-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
}

.search-history-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-hint);
}

.search-history-clear-btn {
    border: 0;
    background: transparent;
    color: var(--text-hint);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.15s ease;
}

.search-history-clear-btn:hover {
    color: var(--text-color);
}

.search-history-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.search-history-item {
    flex: 1;
    border: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
    transition: background 0.15s ease;
}

.search-history-item:hover {
    background: var(--hover-bg);
}

.search-history-remove-btn {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text-hint);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    transition: background 0.15s ease, color 0.15s ease;
}

.search-history-remove-btn:hover {
    background: var(--hover-bg);
    color: var(--text-color);
}

.history-keyword {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
}

.history-meta {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-hint);
}

.search-history-empty {
    padding: 12px 8px 4px;
    color: var(--text-hint);
    font-size: 13px;
}

.no-results {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-color-secondary);
    font-size: 14px;
}

.home-sections {
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
}

.external-convert-drag-overlay {
    position: fixed;
    inset: 0;
    z-index: 9000;
    pointer-events: none;
}

.external-convert-drag-ghost {
    position: fixed;
    transform: translate(-50%, -130%);
    max-width: 280px;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--card-bg-solid);
    color: var(--text-color);
    border: 1px solid var(--border-color);
    box-shadow: var(--menu-shadow);
    backdrop-filter: var(--backdrop-blur);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
