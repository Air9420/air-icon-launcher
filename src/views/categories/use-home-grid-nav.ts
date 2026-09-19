import { computed, nextTick, ref, watch, type Ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { useUIStore, useCategoryStore, type Category as CategoryType } from "../../stores";
import type { HomeRecentDisplayItem } from "../../composables/useHomePageState";
import type { PinnedMergedItem } from "../../stores";
import { showToast } from "../../composables/useGlobalToast";
import type { HomeFocusRegion } from "./use-home-search";

export type HomeGridNavDeps = {
    searchKeyword: Ref<string>;
    homeSearchViewState: Ref<string>;
    pinnedMergedItems: Ref<PinnedMergedItem[]>;
    stableRecentDisplayItems: Ref<HomeRecentDisplayItem[]>;
    searchBoxRef: Ref<{ focus: () => void } | null>;
    searchShellRef: Ref<HTMLElement | null>;
    launchPinned: (item: PinnedMergedItem) => void;
    launchRecent: (item: HomeRecentDisplayItem) => void;
};

export function useHomeGridNav(deps: HomeGridNavDeps) {
    const {
        searchKeyword,
        homeSearchViewState,
        pinnedMergedItems,
        stableRecentDisplayItems,
        searchBoxRef,
        searchShellRef,
        launchPinned,
        launchRecent,
    } = deps;

    const router = useRouter();
    const uiStore = useUIStore();
    const categoryStore = useCategoryStore();
    const { categoryCols } = storeToRefs(uiStore);
    const {
        displayCategories,
        editingCategoryId,
        editingCategoryName,
        isEditingCategory,
        isNewCategory,
    } = storeToRefs(categoryStore);

    const isHomeKeyboardNavActive = ref(false);
    const homeFocusRegion = ref<HomeFocusRegion>("pinned");
    const homePinnedSelectedIndex = ref(0);
    const homeRecentSelectedIndex = ref(0);
    const homeCategorySelectedIndex = ref(0);

    const pinnedLayout = computed(() => uiStore.getHomeSectionLayout("pinned"));
    const recentLayout = computed(() => uiStore.getHomeSectionLayout("recent"));

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

    function onClickCategory(element: CategoryType) {
        if (isEditingCategory.value) return;
        categoryStore.setCurrentCategory(element.id);
        void router.push({ name: "category", params: { categoryId: element.id } });
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
                launchPinned(item);
            }
            return;
        }

        if (homeFocusRegion.value === "recent") {
            const item = stableRecentDisplayItems.value[homeRecentSelectedIndex.value];
            if (item) {
                launchRecent(item);
            }
            return;
        }

        const category = displayCategories.value[homeCategorySelectedIndex.value];
        if (category) {
            onClickCategory(category);
        }
    }

    watch(
        [
            () => pinnedMergedItems.value.length,
            () => stableRecentDisplayItems.value.length,
            () => displayCategories.value.length,
            homeSearchViewState,
            searchKeyword,
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

    return {
        displayCategories,
        editingCategoryId,
        editingCategoryName,
        isEditingCategory,
        isNewCategory,
        categoryCols,
        pinnedLayout,
        recentLayout,
        isHomeKeyboardNavActive,
        homeFocusRegion,
        homePinnedSelectedIndex,
        homeRecentSelectedIndex,
        homeCategorySelectedIndex,
        homeSelectedCategoryId,
        onClickCategory,
        onUpdateCategories,
        onConfirmCategoryEdit,
        onCancelCategoryEdit,
        resetHomeKeyboardNav,
        rotateHomeTabCycle,
        moveHomeSelectionByKey,
        triggerHomeSelection,
        isHomeKeyboardNavActiveFn: () => isHomeKeyboardNavActive.value,
        onDocumentMouseDown,
        normalizeHomeFocusState,
        scrollHomeSelectionIntoView,
    };
}
