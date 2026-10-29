import { nextTick, ref, watch, type Ref } from "vue";
import type { ClipboardRecord } from "../../stores/clipboardStore";
import { readLocalImageAsDataUrl } from "../../utils/system-commands";
import { ANCHOR_FLASH_MS, SCROLL_ANIMATION_MS, SCROLL_EDGE_PADDING } from "./types";

export function useClipboardViewport(params: {
    history: Ref<ClipboardRecord[]>;
    contentRef: Ref<HTMLElement | null>;
    itemRefs: Ref<Record<string, HTMLElement | null>>;
    hasMore: Ref<boolean>;
    isLoadingMore: Ref<boolean>;
    loadMore: () => void;
    clearSearchKeyword: () => void;
    /** 当前搜索关键词（用于判断清空后是否需要等重新加载）。 */
    currentKeyword?: () => string;
    /** 等待列表数据就绪（清空搜索后重新加载完成）。 */
    waitForHistoryReady?: () => Promise<void>;
    /** 定位失败时的提示回调（记录已被删除/清理）。 */
    onLocateMiss?: (recordId: string) => void;
}) {
    const {
        history,
        contentRef,
        itemRefs,
        hasMore,
        isLoadingMore,
        loadMore,
        clearSearchKeyword,
        currentKeyword = () => "",
        waitForHistoryReady = async () => {},
        onLocateMiss,
    } = params;

    const imagePreviewMap = ref<Record<string, string>>({});
    const imageLoadingSet = ref<Set<string>>(new Set());
    const anchorFlashItemId = ref<string | null>(null);
    let scrollAnimationFrame: number | null = null;
    let anchorFlashTimer: number | null = null;
    let imageObserver: IntersectionObserver | null = createImageObserver();

    watch(
        history,
        (records) => {
            const watchStart = performance.now();
            console.log(
                "[clipboard-history] ▶ history watcher triggered, records:",
                records.length
            );

            void hydrateImagePreviews(records);
            const validIds = new Set(records.map((record) => record.id));

            for (const id of imageLoadingSet.value) {
                if (!validIds.has(id)) {
                    imageLoadingSet.value.delete(id);
                }
            }

            if (anchorFlashItemId.value && !validIds.has(anchorFlashItemId.value)) {
                anchorFlashItemId.value = null;
                if (anchorFlashTimer !== null) {
                    clearTimeout(anchorFlashTimer);
                    anchorFlashTimer = null;
                }
            }
            console.log(
                `[clipboard-history] ✓ history watcher done (${(performance.now() - watchStart).toFixed(1)}ms)`
            );
        },
        { immediate: true }
    );

    function onContentScroll(e: Event) {
        const el = e.target as HTMLElement;
        if (!el) return;
        const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (scrollBottom < 200 && hasMore.value && !isLoadingMore.value) {
            loadMore();
        }
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

    /**
     * 定位到指定记录。
     *
     * 虚拟列表下未渲染的项没有 DOM，不能靠 `itemRefs` 查找，
     * 必须委托给列表组件的 `scrollToRecordId`（内部走 `scrollToIndex`），
     * 等目标行渲染出来后再做高亮。
     *
     * 数据已是全量加载（`get_clipboard_history_lite`），所以不需要分页加载；
     * 若仍找不到，说明该记录已被删除/清理。
     *
     * 注意：调用方必须保证「搜索关键词已清空且列表数据已就绪」，
     * 否则虚拟列表里根本没有这一行。
     */
    async function locateRecord(
        recordId: string,
        scrollToRecordId?: ((id: string) => Promise<boolean> | boolean) | null
    ): Promise<boolean> {
        const found = scrollToRecordId ? await scrollToRecordId(recordId) : false;
        if (!found) return false;

        // 等虚拟列表把目标行渲染出来
        await nextTick();
        await nextTick();

        void triggerAnchorFlash(recordId);
        return true;
    }

    async function onLocateClipboardItem(event: Event) {
        const customEvent = event as CustomEvent;
        const { recordId } = customEvent.detail;

        // 先清空搜索词。清空会触发列表按筛选重新加载（异步），
        // 必须等它完成后才能定位，否则虚拟列表里还是过滤后的旧数据。
        const hadKeyword = !!currentKeyword();
        clearSearchKeyword();

        if (hadKeyword) {
            await waitForHistoryReady();
        }

        const found = await locateRecord(recordId, getScrollToRecordId());
        if (!found) {
            onLocateMiss?.(recordId);
        }
    }

    /** 由父组件注入：虚拟列表暴露的滚动方法。 */
    let scrollToRecordIdRef: ((id: string) => Promise<boolean> | boolean) | null = null;

    function setScrollToRecordId(fn: ((id: string) => Promise<boolean> | boolean) | null) {
        scrollToRecordIdRef = fn;
    }

    function getScrollToRecordId() {
        return scrollToRecordIdRef;
    }

    /** 兼容旧调用点：直接滚动到已渲染的记录。 */
    async function scrollToRecord(recordId: string) {
        await locateRecord(recordId, getScrollToRecordId());
    }

    async function afterToggleExpand(recordId: string, wasExpanded: boolean) {
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

    async function hydrateImagePreviews(records: ClipboardRecord[]) {
        const imageRecords = records.filter(
            (record) => record.content_type === "image" && !!record.image_path
        );

        const validIds = new Set(imageRecords.map((record) => record.id));
        for (const id of Object.keys(imagePreviewMap.value)) {
            if (!validIds.has(id)) {
                delete imagePreviewMap.value[id];
            }
        }
    }

    function loadImagePreview(recordId: string, imagePath: string) {
        if (imagePreviewMap.value[recordId] || imageLoadingSet.value.has(recordId)) {
            return;
        }
        imageLoadingSet.value.add(recordId);

        readLocalImageAsDataUrl(imagePath)
            .then((dataUrl) => {
                imagePreviewMap.value[recordId] = dataUrl;
            })
            .catch((error) => {
                console.warn("Failed to load clipboard image preview:", error);
            })
            .finally(() => {
                imageLoadingSet.value.delete(recordId);
            });
    }

    function observeImageElement(el: HTMLElement | null, recordId: string, imagePath: string) {
        if (!el) return;
        (el as HTMLElement & { _lazyRecordId?: string })._lazyRecordId = recordId;
        (el as HTMLElement & { _lazyImagePath?: string })._lazyImagePath = imagePath;

        if (imageObserver) {
            imageObserver.observe(el);
        }
    }

    function createImageObserver() {
        return new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const el = entry.target as HTMLElement & {
                            _lazyRecordId?: string;
                            _lazyImagePath?: string;
                        };
                        const recordId = el._lazyRecordId;
                        const imagePath = el._lazyImagePath;
                        if (recordId && imagePath) {
                            loadImagePreview(recordId, imagePath);
                        }
                        imageObserver?.unobserve(el);
                    }
                }
            },
            {
                rootMargin: "200px",
                threshold: 0,
            }
        );
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
        const easeInOutCubic = (progress: number) =>
            progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

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

    function dispose() {
        if (imageObserver) {
            imageObserver.disconnect();
            imageObserver = null;
        }

        if (scrollAnimationFrame !== null) {
            cancelAnimationFrame(scrollAnimationFrame);
            scrollAnimationFrame = null;
        }

        if (anchorFlashTimer !== null) {
            clearTimeout(anchorFlashTimer);
            anchorFlashTimer = null;
        }
    }

    // Prune expand/item refs when history changes is done in parent (expandedRecordIds)

    return {
        imagePreviewMap,
        imageLoadingSet,
        anchorFlashItemId,
        onContentScroll,
        onLocateClipboardItem,
        triggerAnchorFlash,
        scrollToRecord,
        locateRecord,
        setScrollToRecordId,
        getScrollToRecordId,
        afterToggleExpand,
        observeImageElement,
        dispose,
    };
}
