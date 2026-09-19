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
}) {
    const { history, contentRef, itemRefs, hasMore, isLoadingMore, loadMore, clearSearchKeyword } =
        params;

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

    function onLocateClipboardItem(event: Event) {
        const customEvent = event as CustomEvent;
        const { recordId } = customEvent.detail;

        clearSearchKeyword();

        nextTick(() => {
            const target = itemRefs.value[recordId];
            const container = contentRef.value;
            if (!target || !container) return;

            void triggerAnchorFlash(recordId);

            const nextScrollTop = getAnchorScrollTop(container, target);
            animateScrollTo(container, nextScrollTop);
        });
    }

    async function scrollToRecord(recordId: string) {
        await nextTick();
        const target = itemRefs.value[recordId];
        const container = contentRef.value;
        if (!target || !container) return;
        await triggerAnchorFlash(recordId);
        const nextScrollTop = getAnchorScrollTop(container, target);
        animateScrollTo(container, nextScrollTop);
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
        afterToggleExpand,
        observeImageElement,
        dispose,
    };
}
