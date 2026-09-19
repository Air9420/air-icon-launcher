import { computed, nextTick, ref, watch, type ComponentPublicInstance, type Ref } from "vue";
import type { ClipboardRecord } from "../../stores/clipboardStore";
import type { ClipboardFilter, ClipboardTabRegion } from "./types";

export function useClipboardKeyboard(params: {
    flatVisibleRecords: Ref<ClipboardRecord[]>;
    filterOrder: Ref<ClipboardFilter[]>;
    searchInputRef: Ref<HTMLInputElement | null>;
    onBack: () => void;
    onCopyItem: (item: ClipboardRecord) => void;
}) {
    const { flatVisibleRecords, filterOrder, searchInputRef, onBack, onCopyItem } = params;

    const tabRegion = ref<ClipboardTabRegion>("search");
    const focusedFilterIndex = ref(0);
    const focusedRecordIndex = ref(0);
    const filterChipRefs = ref<Record<ClipboardFilter, HTMLButtonElement | null>>({
        all: null,
        favorites: null,
        text: null,
        code: null,
        image: null,
    });
    const itemRefs = ref<Record<string, HTMLElement | null>>({});

    const focusedFilterKey = computed<ClipboardFilter>(() => {
        const list = filterOrder.value;
        if (list.length === 0) return "all";
        const safeIndex = Math.max(0, Math.min(focusedFilterIndex.value, list.length - 1));
        return list[safeIndex];
    });

    const focusedRecordId = computed<string | null>(() => {
        const list = flatVisibleRecords.value;
        if (list.length === 0) return null;
        const safeIndex = Math.max(0, Math.min(focusedRecordIndex.value, list.length - 1));
        return list[safeIndex]?.id ?? null;
    });

    watch(filterOrder, (list) => {
        if (list.length === 0) {
            focusedFilterIndex.value = 0;
            return;
        }
        focusedFilterIndex.value = Math.max(0, Math.min(focusedFilterIndex.value, list.length - 1));
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
        focusedRecordIndex.value = Math.max(
            0,
            Math.min(focusedRecordIndex.value, records.length - 1)
        );
    });

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
        const nextIndex =
            key === "ArrowUp"
                ? Math.max(0, current - 1)
                : Math.min(list.length - 1, current + 1);
        focusedRecordIndex.value = nextIndex;
        nextTick(() => {
            scrollFocusedRecordIntoView();
        });
    }

    function triggerFocusedFilterSelection(selectedFilter: Ref<ClipboardFilter>) {
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

    function onClipboardKeydown(e: KeyboardEvent, selectedFilter: Ref<ClipboardFilter>) {
        const hasBlockingDialog = !!document.querySelector(".confirm-overlay, .input-overlay");
        if (hasBlockingDialog) return;

        if (e.key === "Tab") {
            e.preventDefault();
            rotateTabRegion(e.shiftKey);
            return;
        }

        if (e.key === "Escape") {
            const isSearchInputTarget =
                e.target instanceof HTMLInputElement && e.target.classList.contains("search-input");
            const targetInputValue = isSearchInputTarget ? e.target.value.trim() : "";

            if (isSearchInputTarget && targetInputValue.length > 0) {
                return;
            }

            e.preventDefault();
            onBack();
            return;
        }

        if (tabRegion.value === "filter") {
            if (
                e.key === "ArrowLeft" ||
                e.key === "ArrowRight" ||
                e.key === "ArrowUp" ||
                e.key === "ArrowDown"
            ) {
                e.preventDefault();
                moveFilterFocusByArrow(e.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown");
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                triggerFocusedFilterSelection(selectedFilter);
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

    function onClipboardMouseDown(event: MouseEvent, rootRef: Ref<HTMLElement | null>) {
        if (!(event.target instanceof Element)) return;

        const clickedBackButton = !!event.target.closest(".back-btn");
        if (clickedBackButton) {
            resetTabCycleState();
            blurSearchInput();
            return;
        }

        if (!rootRef.value?.contains(event.target)) {
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

    return {
        tabRegion,
        focusedFilterIndex,
        focusedRecordIndex,
        filterChipRefs,
        itemRefs,
        focusedFilterKey,
        focusedRecordId,
        resetTabCycleState,
        blurSearchInput,
        onSearchInputBlur,
        setFilterChipRef,
        setItemRef,
        onClipboardKeydown,
        onClipboardMouseDown,
    };
}
