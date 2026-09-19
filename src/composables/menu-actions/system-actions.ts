/**
 * System / external-item domain actions: hide, explorer, block, convert, nav.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideWindowAndStartMemoryRelease } from "../../utils/window-memory";
import {
    menuAddFileItems,
    menuGetItems,
    menuRecordUsage,
} from "../../menus/menuAppsGateway";
import type { MenuActionDeps, SystemActions } from "./types";

export function createSystemActions(deps: MenuActionDeps): SystemActions {
    const {
        options: { currentItemPath, closeContextMenu, inputDialog },
        store,
        categoryStore,
        statsStore,
        router,
        showToast,
        menuInvoke,
    } = deps;

    async function onHideWindow() {
        try {
            await hideWindowAndStartMemoryRelease(getCurrentWindow(), async () => {
                await menuInvoke("start_memory_release");
            });
        } catch (e) {
            console.error(e);
        } finally {
            closeContextMenu();
        }
    }

    async function onOpenInExplorer() {
        const rawPath = currentItemPath.value?.trim();
        if (!rawPath) {
            closeContextMenu();
            return;
        }
        try {
            await menuInvoke("reveal_in_explorer", { path: rawPath });
        } catch (error) {
            console.error(error);
            showToast("无法在资源管理器中打开", { type: "error" });
        } finally {
            closeContextMenu();
        }
    }

    function onBlockExternalItem() {
        const rawPath = currentItemPath.value?.trim();
        if (!rawPath) {
            closeContextMenu();
            return;
        }

        statsStore.blockExternalLaunchPath({
            path: rawPath,
            name: rawPath.split(/[\\/]/).pop() || rawPath,
            source: "系统启动",
        });
        showToast("已屏蔽该外部项");
        closeContextMenu();
    }

    async function onConvertExternalItem() {
        const rawPath = currentItemPath.value?.trim();
        if (!rawPath) {
            closeContextMenu();
            return;
        }

        const preferredCategory =
            categoryStore.categories.find((category) => category.name === "工具") ??
            categoryStore.categories[0];
        if (!preferredCategory) {
            showToast("未找到可用分类", { type: "error" });
            closeContextMenu();
            return;
        }

        const values = await inputDialog({
            title: "转为应用内启动项",
            message: "请选择目标分类（长按菜单项可拖拽到分类图标直接导入）",
            confirmText: "添加",
            cancelText: "取消",
            defaultValue: preferredCategory.name,
            placeholder: "选择分类",
            inputType: "text",
            selectOptions: categoryStore.categories.map((category) => category.name),
        });

        if (!values) {
            closeContextMenu();
            return;
        }

        const [targetRaw] = values;
        const targetValue = (targetRaw || "").trim();
        if (!targetValue) {
            showToast("分类不能为空", { type: "error" });
            closeContextMenu();
            return;
        }

        const targetCategory = categoryStore.categories.find(
            (category) =>
                category.id === targetValue ||
                category.name.localeCompare(targetValue, "zh-CN", { sensitivity: "accent" }) === 0
        );
        if (!targetCategory) {
            showToast(`未找到分类：${targetValue}`, { type: "error" });
            closeContextMenu();
            return;
        }

        const normalizedPath = rawPath.replace(/\//g, "\\").trim().toLowerCase();
        const duplicateExists = menuGetItems(store, targetCategory.id).some(
            (item) =>
                item.itemType === "file" &&
                item.path.replace(/\//g, "\\").trim().toLowerCase() === normalizedPath
        );
        if (duplicateExists) {
            showToast(`「${targetCategory.name}」中已存在该启动项`);
            closeContextMenu();
            return;
        }

        const externalRecord = statsStore.externalRecentLaunches.find(
            (entry: { path: string }) =>
                entry.path.replace(/\//g, "\\").trim().toLowerCase() === normalizedPath
        );

        const createdItemIds = menuAddFileItems(store, targetCategory.id, {
            paths: [rawPath],
            directories: [],
            icon_base64s: [externalRecord?.iconBase64 ?? null],
            itemTypes: ["file"],
        });
        const createdItemId = createdItemIds[0];
        if (createdItemId) {
            menuRecordUsage(
                store,
                statsStore,
                targetCategory.id,
                createdItemId,
                externalRecord?.usedAt ?? Date.now()
            );
        }

        showToast(`已添加到「${targetCategory.name}」`);
        closeContextMenu();
    }

    function onOpenSettings() {
        router.push("/settings");
    }

    function onOpenAbout() {
        router.push("/settings/about");
    }

    return {
        onHideWindow,
        onOpenInExplorer,
        onBlockExternalItem,
        onConvertExternalItem,
        onOpenSettings,
        onOpenAbout,
    };
}
