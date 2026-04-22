import { ref } from "vue";
import { listen } from "@tauri-apps/api/event";
import { safeInvoke } from "../utils/invoke-wrapper";
import { Store } from "../stores";
import { useCategoryStore } from "../stores/categoryStore";
import { enumContextMenuType } from "../menus/contextMenuTypes";
import type { DropRecord, DropIconsEvent, DropTargetInfo } from "./types";

const __DEV_LOG__ = false;
const PROCESSED_DROP_TTL_MS = 5 * 60 * 1000;
const MAX_PROCESSED_DROP_IDS = 200;

export interface UseDragDropOptions {
    getDropTargetInfoAtPoint: (x: number, y: number) => DropTargetInfo | null;
}

export function useDragDrop(options: UseDragDropOptions) {
    const { getDropTargetInfoAtPoint } = options;
    const store = Store();
    const categoryStore = useCategoryStore();

    const lastDrop = ref<DropRecord | null>(null);
    const processedDropIds = new Set<string>();
    const processedDropTimestamps = new Map<string, number>();
    const pendingDropPaths = new Map<string, { categoryId: string; paths: string[] }>();

    let unlistenDragDrop: (() => void) | null = null;
    let unlistenDragDropIcons: (() => void) | null = null;

    function pruneProcessedDropIds(now: number = Date.now()) {
        for (const [dropId, timestamp] of processedDropTimestamps.entries()) {
            if (now - timestamp > PROCESSED_DROP_TTL_MS) {
                processedDropTimestamps.delete(dropId);
                processedDropIds.delete(dropId);
            }
        }

        while (processedDropIds.size > MAX_PROCESSED_DROP_IDS) {
            const oldest = processedDropTimestamps.entries().next().value as
                | [string, number]
                | undefined;
            if (!oldest) break;
            processedDropTimestamps.delete(oldest[0]);
            processedDropIds.delete(oldest[0]);
        }
    }

    async function initializeDragDrop() {
        unlistenDragDrop = await listen<DropRecord>("drag-drop", async (event) => {
            lastDrop.value = event.payload;
            const { drop_id, position, paths, directories } = event.payload;
            pruneProcessedDropIds();
            const target = getDropTargetInfoAtPoint(position.x, position.y);
            await safeInvoke("report_drop_target", { dropId: drop_id, target });

            const menuType = target?.dataset?.menuType as
                | enumContextMenuType
                | undefined;
            const categoryId = target?.dataset?.categoryId;

            if (
                (menuType === enumContextMenuType.IconView ||
                    menuType === enumContextMenuType.IconItem ||
                    menuType === enumContextMenuType.HomeGroupItem) &&
                categoryId &&
                paths?.length &&
                !processedDropIds.has(drop_id)
            ) {
                if (__DEV_LOG__) {
                    console.log(`[拖拽添加] 开始添加 ${paths.length} 个启动项到分类 ${categoryId}`);
                }

                const ids = await store.addLauncherItemsToCategoryBatched(categoryId, {
                    paths,
                    directories,
                    icon_base64s: paths.map(() => null),
                });

                pendingDropPaths.set(drop_id, { categoryId, paths });
                processedDropIds.add(drop_id);
                processedDropTimestamps.set(drop_id, Date.now());
                categoryStore.setCurrentCategory(categoryId);

                if (__DEV_LOG__) {
                    const allItems = store.getLauncherItemsByCategoryId(categoryId);
                    const idSet = new Set(allItems.map(i => i.id));
                    const hasCollision = idSet.size !== allItems.length;
                    console.log(
                        `[拖拽添加] 完成添加 ${ids.length} 个启动项，分类下共 ${allItems.length} 个` +
                        (hasCollision ? " ⚠️ 检测到ID碰撞！" : "")
                    );
                }
            }
        });

        unlistenDragDropIcons = await listen<DropIconsEvent>("drag-drop-icons", (event) => {
            const { drop_id, icon_base64s } = event.payload;
            pruneProcessedDropIds();
            const pending = pendingDropPaths.get(drop_id);
            if (!pending) return;

            const { categoryId, paths } = pending;
            store.applyDropIcons(categoryId, paths, icon_base64s);
            pendingDropPaths.delete(drop_id);

            if (__DEV_LOG__) {
                const iconCount = icon_base64s.filter(i => i !== null).length;
                console.log(`[拖拽添加] 图标加载完成: ${iconCount}/${icon_base64s.length}`);
            }
        });
    }

    function cleanupDragDrop() {
        if (unlistenDragDrop) {
            unlistenDragDrop();
            unlistenDragDrop = null;
        }
        if (unlistenDragDropIcons) {
            unlistenDragDropIcons();
            unlistenDragDropIcons = null;
        }
    }

    return {
        lastDrop,
        processedDropIds,
        initializeDragDrop,
        cleanupDragDrop,
    };
}

export type DragDropComposable = ReturnType<typeof useDragDrop>;
