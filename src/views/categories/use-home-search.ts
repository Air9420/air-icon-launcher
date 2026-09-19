import { computed, nextTick, ref, watch, type Ref } from "vue";
import { useThrottleFn } from "@vueuse/core";
import { storeToRefs } from "pinia";
import {
    Store,
    useClipboardStore,
    getRecordContent,
    useSearchExtensionsStore,
    type GlobalSearchMergedResult,
    type PinnedMergedItem,
} from "../../stores";
import { useStatsStore, type SearchKeywordRecord } from "../../stores/statsStore";
import { useLaunchStatus } from "../../composables/useLaunchStatus";
import { useLaunchCooldown } from "../../composables/useLaunchCooldown";
import type { HomeRecentDisplayItem } from "../../composables/useHomePageState";
import { normalizeIconBase64 } from "../../composables/useItemsHelper";
import { showToast } from "../../composables/useGlobalToast";
import { invokeOrThrow } from "../../utils/invoke-wrapper";
import { launchStoredItem } from "../../utils/launcher-service";
import { useCordis } from "../../kernel";
import { SEARCH_THROTTLE_MS } from "../../utils/search-config";
import { openPathWithSystem } from "../../utils/system-commands";
import { buildSearchIconHydrationPlan } from "../../utils/search-icon-hydration";
import {
    getScannedIconLookupPath,
    getScannedLaunchCommandTarget,
} from "../../utils/scanned-app-launch";
import {
    reconcileVisibleHydrationState,
    shouldSkipVisibleHydration,
    type WindowVisibilityState,
} from "../../utils/window-visibility";
import {
    createSearchSelectionTarget,
    findSearchSelectionIndex,
    getSearchHistoryDisplayKeyword,
    getRecentSearchHistoryEntries,
    getSearchSectionIndex,
    type SearchSelectionTarget,
} from "../../utils/search-ui";
import { useScanCache } from "../../composables/useScanCache";
import { SCENARIO_KEYS } from "../../menus/contextMenu";
import type { ScannedAppEntry, ScannedFallbackSection } from "../../types/scan-cache";
import type { ClipboardSearchResult, CommandSearchResult, RecentFileSearchResult } from "../../types/search-extensions";
import type { ScenarioKey } from "../../stores/launcherStore";
import type { useSettingsStore } from "../../stores";
import {
    buildClipboardPreview,
    extensionMatchRank,
    normalizeKeywordTokens,
    resolveExtensionMatchType,
} from "./search-extension-match";
import {
    collectVisibleRecentFileHydrationPaths,
    mergeRecentFileIcons,
    normalizeRecentFileRows,
    readRecentFileCandidatesCache,
    writeRecentFileCandidatesCache,
    RECENT_FILE_CACHE_STALE_MS,
    RECENT_FILE_ICON_HYDRATION_LIMIT,
    type RecentFileRow,
} from "./recent-file-helpers";
import {
    collectVisibleRecentFileResultPaths,
    collectVisibleSearchResultTargets,
    getDocumentVisibilityHints,
    getSearchResultIconMaxEdge,
    isExternalRecentItem,
} from "./home-hydration-helpers";

const DEBUG_SEARCH = false;

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

function debugLog(...args: unknown[]) {
    if (DEBUG_SEARCH) {
        console.log("[Search]", ...args);
    }
}

const SEARCH_ICON_HYDRATION_LIMIT = 12;

export type HomeFocusRegion = "pinned" | "recent" | "category";

export type HomeSearchDeps = {
    settingsStore: ReturnType<typeof useSettingsStore>;
    searchBoxRef: Ref<{ focus: () => void } | null>;
    /** Home grid keyboard reset — wired by parent after use-home-grid-nav. */
    resetHomeKeyboardNav: { current: () => void };
    /** Home launch handlers — wired by parent (grid nav + shortcut targets). */
    homeLaunchers: {
        current: {
            launchPinnedWithCd: (item: PinnedMergedItem) => void;
            launchRecentWithCd: (item: HomeRecentDisplayItem) => void;
        };
    };
};

export function useHomeSearch(deps: HomeSearchDeps) {
    const { settingsStore, searchBoxRef, resetHomeKeyboardNav, homeLaunchers } = deps;

    const cordis = useCordis();
    const store = Store();
    const statsStore = useStatsStore();
    const clipboardStore = useClipboardStore();
    const searchExtensionsStore = useSearchExtensionsStore();
    const { getFallbackSection, loadCache, warmLauncherPathKeys, hydrateSectionIcons } = useScanCache();

    const { searchKeyword, rustSearchResults, rustSearchMergedResults, isRustSearchReady } = storeToRefs(store);
    const { autoHideAfterLaunch } = storeToRefs(settingsStore);

    const { setLaunchStatus, clearLaunchStatus, getLaunchStatus } = useLaunchStatus({
        autoHideAfterLaunch,
    });

    const scannedFallbackSection = ref<ScannedFallbackSection | null>(null);
    const selectedIndex = ref(-1);
    const isSearchHistoryOpen = ref(false);
    const isHomeSearchPending = ref(false);
    const isWindowFocused = ref(true);
    const showShortcutHints = ref(false);
    const windowVisibility = ref<WindowVisibilityState>("visible");
    const hasPrimedSearchResources = ref(false);

    const recentFileCandidates = ref<RecentFileSearchResult[]>(
        searchExtensionsStore.recentFileCandidates.length > 0
            ? [...searchExtensionsStore.recentFileCandidates]
            : readRecentFileCandidatesCache()
    );
    let recentFileIconHydrationRequestId = 0;

    let pendingHomeSearchSelection: (SearchSelectionTarget & { keyword: string }) | null = null;
    let homeSearchRequestId = 0;
    let ensureIndexPromise: Promise<void> | null = null;

    const showSearchHistoryPanel = computed(() => (
        isSearchHistoryOpen.value && !searchKeyword.value.trim()
    ));
    const searchHistoryEntries = computed<SearchKeywordRecord[]>(() =>
        getRecentSearchHistoryEntries<SearchKeywordRecord>(statsStore.searchHistory, 8)
    );

    const currentSearchResults = computed(() => {
        return rustSearchMergedResults.value ?? [];
    });

    const clipboardSearchResults = ref<ClipboardSearchResult[]>([]);
    const isSearchingClipboard = ref(false);
    let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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
            if (launcherCount === 0 && !hasFallbackResults && !hasExtensionResults) {
                return "fallback";
            }
            return "results";
        }
        return "home";
    });

    const homeSearchDisplayState = computed(() => {
        if (isHomeSearchPending.value) {
            const hasResults = (rustSearchMergedResults.value?.length ?? 0) > 0
                || (scannedFallbackSection.value?.items.length ?? 0) > 0
                || commandSearchResults.value.length > 0
                || clipboardSearchResults.value.length > 0
                || recentFileSearchResults.value.length > 0;
            if (!hasResults) {
                return homeSearchViewState.value;
            }
        }
        return homeSearchViewState.value;
    });

    function syncVisibleHydrationState(): void {
        const reconciled = reconcileVisibleHydrationState(
            windowVisibility.value,
            isWindowFocused.value,
            getDocumentVisibilityHints()
        );
        windowVisibility.value = reconciled.visibilityState;
        isWindowFocused.value = reconciled.isWindowFocused;
    }

    async function loadRecentFileCandidates(): Promise<void> {
        syncVisibleHydrationState();
        if (windowVisibility.value !== "visible") return;
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
                const key = row.path.trim().replace(/\//g, "\\").toLowerCase();
                iconByPath.set(key, icon);
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
        syncVisibleHydrationState();
        if (shouldSkipVisibleHydration(windowVisibility.value, isWindowFocused.value, getDocumentVisibilityHints())) return;
        const missingPaths = collectVisibleRecentFileHydrationPaths(rows);
        if (missingPaths.length === 0) return;

        const requestId = ++recentFileIconHydrationRequestId;
        try {
            const iconRows = await invokeOrThrow<Array<string | null>>("extract_icons_from_paths", {
                paths: missingPaths,
                maxEdge: 128,
            });
            if (requestId !== recentFileIconHydrationRequestId) return;

            const iconByPath = new Map<string, string>();
            for (let i = 0; i < missingPaths.length; i += 1) {
                const icon = normalizeIconBase64(iconRows[i]);
                if (!icon) continue;
                iconByPath.set(missingPaths[i].trim().replace(/\//g, "\\").toLowerCase(), icon);
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

    function hydrateVisibleSearchResultIcons(): void {
        syncVisibleHydrationState();
        const plan = buildSearchIconHydrationPlanLocal();
        if (plan.launcherTargets.length > 0) {
            void store.hydrateLauncherIconsForVisibleItems(plan.launcherTargets, {
                maxEdge: getSearchResultIconMaxEdge(),
            });
        }

        if (plan.recentFilePaths.length === 0) return;

        const rowByPath = new Map(
            recentFileCandidates.value.map((row) => [row.path.trim().replace(/\//g, "\\").toLowerCase(), row] as const)
        );
        const rows = plan.recentFilePaths
            .map((path) => rowByPath.get(path.trim().replace(/\//g, "\\").toLowerCase()))
            .filter((row): row is RecentFileSearchResult => !!row);
        if (rows.length > 0) {
            void hydrateRecentFileCandidateIcons(rows);
        }
    }

    function buildSearchIconHydrationPlanLocal() {
        return buildSearchIconHydrationPlan({
            keyword: searchKeyword.value,
            visibilityState: windowVisibility.value,
            isWindowFocused: isWindowFocused.value,
            launcherLimit: SEARCH_ICON_HYDRATION_LIMIT,
            recentFileLimit: RECENT_FILE_ICON_HYDRATION_LIMIT,
            launcherResults: currentSearchResults.value,
            recentFileResults: recentFileSearchResults.value,
            visibleLauncherTargets: collectVisibleSearchResultTargets(),
            visibleRecentFilePaths: collectVisibleRecentFileResultPaths(),
        });
    }

    function shouldRefreshRecentFileCandidates(): boolean {
        if (searchExtensionsStore.recentFileCandidates.length === 0) return true;
        const loadedAt = searchExtensionsStore.recentFileCandidatesLoadedAt;
        if (!Number.isFinite(loadedAt) || loadedAt <= 0) return true;
        return Date.now() - loadedAt > RECENT_FILE_CACHE_STALE_MS;
    }

    async function primeSearchResources(): Promise<void> {
        if (hasPrimedSearchResources.value) return;
        hasPrimedSearchResources.value = true;

        if (shouldRefreshRecentFileCandidates()) {
            void loadRecentFileCandidates();
        }
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
    }

    function onWindowBlur(): void {
        const hints = getDocumentVisibilityHints();
        const reconciled = reconcileVisibleHydrationState("hidden", false, hints);
        windowVisibility.value = reconciled.visibilityState;
        isWindowFocused.value = reconciled.isWindowFocused;
    }

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
        const launchTarget = getScannedLaunchCommandTarget(entry);
        try {
            await invokeOrThrow("launch_scanned_app", { path: launchTarget });
        } catch {
            showToast(`无法启动 ${entry.name}，可能已被卸载`, { type: "error" });
            return;
        }

        const itemId = await store.addScannedAppToLauncher({
            name: entry.name,
            path: entry.path,
            targetPath: entry.targetPath,
            launchType: entry.launchType,
            source: entry.source,
            publisher: entry.publisher,
            iconBase64: entry.iconBase64,
        });

        if (itemId) {
            invokeOrThrow("extract_icon_lazy", { path: getScannedIconLookupPath(entry) }).catch(() => {});
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
            const apps = cordis.apps;
            if (apps) {
                await apps.launch(
                    {
                        categoryId: result.primaryCategoryId,
                        itemId: item.id,
                    },
                    { notifyError: true },
                );
            } else {
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
            }
            setLaunchStatus(item.id, "success");
        } catch (e) {
            console.error(e);
            clearLaunchStatus(item.id);
        }
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
            const existing = clipboardStore.clipboardHistory.find(
                (r) => r.hash === entry.hash || r.id === entry.id
            );
            clipboardStore.promoteClipboardRecord(
                existing ?? {
                    id: entry.id,
                    hash: entry.hash,
                    content_type: entry.contentType,
                    content_subtype: null,
                    text_content: entry.contentType === "text" ? entry.textContent : null,
                    image_path: entry.imagePath ?? null,
                    timestamp: Date.now(),
                    is_favorite: false,
                }
            );
            clipboardStore.setCurrentClipboardHash(entry.hash);
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

    // Expose home launchers for grid nav / shortcut wiring.
    homeLaunchers.current.launchPinnedWithCd = (item) => { void launchPinnedWithCd(item); };
    homeLaunchers.current.launchRecentWithCd = (item) => { void launchRecentWithCd(item); };

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

            const fallbackSection = await fallbackPromise;
            if (requestId !== homeSearchRequestId) return;
            scannedFallbackSection.value = fallbackSection;
            if (fallbackSection) {
                void hydrateSectionIcons(fallbackSection).then((hydratedSection) => {
                    if (requestId !== homeSearchRequestId) return;
                    scannedFallbackSection.value = hydratedSection;
                });
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

    async function ensureRustSearchReady(): Promise<boolean> {
        await primeSearchResources();
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
            resetHomeKeyboardNav.current();
            return;
        }

        closeSearchHistoryPanel();
        scannedFallbackSection.value = null;
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

    async function performClipboardSearch(keyword: string) {
        if (!keyword.trim()) {
            clipboardSearchResults.value = [];
            return;
        }

        isSearchingClipboard.value = true;
        try {
            const records = await clipboardStore.search(keyword);
            const tokens = normalizeKeywordTokens(keyword);

            const matched: ClipboardSearchResult[] = [];
            for (const record of records) {
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

            clipboardSearchResults.value = matched.slice(0, 8);
        } catch (error) {
            console.error("Clipboard search failed:", error);
            clipboardSearchResults.value = [];
        } finally {
            isSearchingClipboard.value = false;
        }
    }

    watch(searchKeyword, (newKeyword) => {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = setTimeout(() => {
            performClipboardSearch(newKeyword);
        }, 300);
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
                const normalized = (item.path || "").trim().replace(/\//g, "\\").toLowerCase();
                if (normalized) launcherPathSet.add(normalized);
            }
        }

        const matched: RecentFileSearchResult[] = [];
        for (const entry of recentFileCandidates.value) {
            const normalizedPath = entry.path.trim().replace(/\//g, "\\").toLowerCase();
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

    const showBrowserSearchOption = computed(() => {
        return searchKeyword.value.trim().length > 0
            && (isHomeSearchPending.value || currentSearchResults.value.length <= 3);
    });

    const searchSectionCounts = computed(() => ({
        command: commandSearchResults.value.length,
        launcher: currentSearchResults.value.length,
        browser: showBrowserSearchOption.value ? 1 : 0,
        scanned: scannedFallbackSection.value?.items.length ?? 0,
        clipboard: clipboardSearchResults.value.length,
        "recent-file": recentFileSearchResults.value.length,
    }));

    const totalSearchItemCount = computed(() => {
        const counts = searchSectionCounts.value;
        return counts.command
            + counts.launcher
            + counts.browser
            + counts.scanned
            + counts.clipboard
            + counts["recent-file"];
    });

    function triggerSearchSelectionAt(index: number): void {
        const sectionTarget = getSearchSectionIndex(index, searchSectionCounts.value);
        if (!sectionTarget) return;

        if (sectionTarget.section === "command") {
            const commandEntry = commandSearchResults.value[sectionTarget.offset];
            if (commandEntry) void launchCommandWithCd(commandEntry);
            return;
        }

        if (sectionTarget.section === "launcher") {
            const launcherEntry = currentSearchResults.value[sectionTarget.offset];
            if (launcherEntry) void launchSearchWithCd(launcherEntry);
            return;
        }

        if (sectionTarget.section === "browser") {
            void onBrowserSearch();
            return;
        }

        if (sectionTarget.section === "scanned") {
            const item = scannedFallbackSection.value?.items[sectionTarget.offset];
            if (item) void onSelectScannedApp(item);
            return;
        }

        if (sectionTarget.section === "clipboard") {
            const clipboardEntry = clipboardSearchResults.value[sectionTarget.offset];
            if (clipboardEntry) void selectClipboardWithCd(clipboardEntry);
            return;
        }

        if (sectionTarget.section === "recent-file") {
            const recentFileEntry = recentFileSearchResults.value[sectionTarget.offset];
            if (recentFileEntry) void openRecentFileWithCd(recentFileEntry);
        }
    }

    function onSearchNav(direction: "up" | "down" | "enter" | "tab") {
        if (!searchKeyword.value.trim()) {
            if (homeSearchViewState.value !== "home") return;
            if (direction === "tab") {
                homeNavHooks.current.rotateHomeTabCycle();
                return;
            }
            if (!homeNavHooks.current.isHomeKeyboardNavActive()) return;
            if (direction === "down") {
                homeNavHooks.current.moveHomeSelectionByKey("ArrowDown");
                return;
            }
            if (direction === "up") {
                homeNavHooks.current.moveHomeSelectionByKey("ArrowUp");
                return;
            }
            if (direction === "enter") {
                homeNavHooks.current.triggerHomeSelection();
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

    function applyWindowShownReset(): void {
        windowVisibility.value = "visible";
        isWindowFocused.value = true;
        closeSearchHistoryPanel();
        isHomeSearchPending.value = false;
        pendingHomeSearchSelection = null;
        showShortcutHints.value = false;
        store.clearSearch();
        selectedIndex.value = -1;
        nextTick(() => {
            searchBoxRef.value?.focus();
            hydrateVisibleSearchResultIcons();
        });
    }

    function applyFocusGained(): void {
        windowVisibility.value = "visible";
        nextTick(() => {
            searchBoxRef.value?.focus();
            hydrateVisibleSearchResultIcons();
        });
    }

    function applyFocusLost(): void {
        isWindowFocused.value = false;
        showShortcutHints.value = false;
        closeSearchHistoryPanel();
        resetHomeKeyboardNav.current();
    }

    function setWindowFocused(focused: boolean): void {
        isWindowFocused.value = focused;
    }

    function setWindowVisibility(state: WindowVisibilityState): void {
        windowVisibility.value = state;
    }

    function getPendingHomeSearchSelection() {
        return pendingHomeSearchSelection;
    }

    function setPendingHomeSearchSelection(
        value: (SearchSelectionTarget & { keyword: string }) | null
    ) {
        pendingHomeSearchSelection = value;
    }

    function clearSearchForEscape(): void {
        pendingHomeSearchSelection = null;
        store.clearSearch();
        scannedFallbackSection.value = null;
        isHomeSearchPending.value = false;
        selectedIndex.value = -1;
        resetHomeKeyboardNav.current();
    }

    watch(
        [currentSearchResults, recentFileSearchResults],
        ([results]) => {
            const pending = pendingHomeSearchSelection;
            if (pending && !isHomeSearchPending.value) {
                selectedIndex.value = findSearchSelectionIndex(results, pending);
                pendingHomeSearchSelection = null;
            }

            if (!searchKeyword.value.trim()) return;
            hydrateVisibleSearchResultIcons();
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

    /** Home-nav hooks — filled by parent after use-home-grid-nav. */
    const homeNavHooks = {
        current: {
            rotateHomeTabCycle: (_reverse = false) => {},
            isHomeKeyboardNavActive: () => false,
            moveHomeSelectionByKey: (_key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight") => {},
            triggerHomeSelection: () => {},
        },
    };

    return {
        // stores / helpers needed by parent
        store,
        statsStore,
        getLaunchStatus,
        setLaunchStatus,
        clearLaunchStatus,
        // state
        searchKeyword,
        rustSearchResults,
        rustSearchMergedResults,
        scannedFallbackSection,
        selectedIndex,
        isSearchHistoryOpen,
        isHomeSearchPending,
        isWindowFocused,
        showShortcutHints,
        windowVisibility,
        showSearchHistoryPanel,
        searchHistoryEntries,
        homeSearchViewState,
        homeSearchDisplayState,
        currentSearchResults,
        clipboardSearchResults,
        recentFileSearchResults,
        commandSearchResults,
        showBrowserSearchOption,
        searchSectionCounts,
        totalSearchItemCount,
        recentFileCandidates,
        // search history
        closeSearchHistoryPanel,
        toggleSearchHistoryPanel,
        onSelectSearchHistory,
        getSearchHistoryLabel,
        onRemoveSearchHistory,
        onClearSearchHistory,
        // launch
        onBrowserSearch,
        onSelectScannedApp,
        onOpenSearchResult,
        onSelectClipboardResult,
        onOpenCommandResult,
        onOpenRecentFileResult,
        onOpenRecentItem,
        onOpenPinnedItem,
        onReorderPinnedItems,
        launchSearchWithCd,
        launchCommandWithCd,
        launchRecentWithCd,
        launchPinnedWithCd,
        selectClipboardWithCd,
        openRecentFileWithCd,
        // nav
        onSearchNav,
        triggerSearchSelectionAt,
        clearSearchForEscape,
        homeNavHooks,
        // window / hydration
        hydrateVisibleSearchResultIcons,
        syncVisibleHydrationState,
        applyWindowShownReset,
        applyFocusGained,
        applyFocusLost,
        setWindowFocused,
        setWindowVisibility,
        getPendingHomeSearchSelection,
        setPendingHomeSearchSelection,
        loadRecentFileCandidates,
        hydrateRecentFileCandidateIcons,
        onWindowBlur,
    };
}
