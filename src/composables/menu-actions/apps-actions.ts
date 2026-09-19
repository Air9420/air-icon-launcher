/**
 * Launch item domain actions: add / edit / delete / icon / pin / scenario.
 */
import { open } from "@tauri-apps/plugin-dialog";
import {
    menuAddFileItems,
    menuAddUrlItem,
    menuRemoveItem,
    menuResetItemIcon,
    menuSetItemIcon,
    menuTogglePin,
    menuUpdateItemIcon,
} from "../../menus/menuAppsGateway";
import type { ScenarioKey } from "../../stores/launcherStore";
import type { AppsActions, MenuActionDeps } from "./types";

export function createAppsActions(deps: MenuActionDeps): AppsActions {
    const {
        options: {
            currentCategoryId,
            currentLauncherItemId,
            closeContextMenu,
            confirm,
            inputDialog,
        },
        store,
        statsStore,
        lastAction,
        showToast,
        menuInvoke,
    } = deps;

    async function onAddItem() {
        if (!currentCategoryId.value) {
            lastAction.value = "添加项目：请先选择一个类目";
            closeContextMenu();
            return;
        }

        const addType = await confirm({
            title: "添加项目",
            message: "请选择添加类型",
            confirmText: "网址",
            cancelText: "文件",
        });

        if (addType === null) {
            closeContextMenu();
            return;
        }

        if (addType) {
            await onAddUrlItem();
            closeContextMenu();
            return;
        }

        const selected = await open({
            multiple: true,
            filters: [
                {
                    name: "可执行文件与快捷方式",
                    extensions: ["exe", "lnk", "url", "bat", "cmd"],
                },
                {
                    name: "所有文件",
                    extensions: ["*"],
                },
            ],
        });

        if (!selected) {
            closeContextMenu();
            return;
        }

        const paths = Array.isArray(selected) ? selected : [selected];

        try {
            const iconBase64s = await menuInvoke<Array<string | null>>(
                "extract_icons_from_paths",
                {
                    paths: paths,
                    maxEdge: 128,
                }
            );

            const directories = paths.map((path) => {
                const lastSlash = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
                return lastSlash >= 0 ? path.substring(0, lastSlash) : path;
            });

            menuAddFileItems(store, currentCategoryId.value, {
                paths: paths,
                directories: directories,
                icon_base64s: iconBase64s,
            });

            lastAction.value = `已添加 ${paths.length} 个项目到类目`;
        } catch (e) {
            console.error("添加项目失败:", e);
            lastAction.value = `添加项目失败: ${e}`;
        }

        closeContextMenu();
    }

    async function onAddUrlItem() {
        if (!currentCategoryId.value) {
            lastAction.value = "添加网址：请先选择一个类目";
            return;
        }

        const values = await inputDialog({
            title: "添加网址",
            message: "请输入网址和名称",
            confirmText: "添加",
            cancelText: "取消",
            defaultValue: "https://",
            placeholder: "https://example.com",
            inputType: "url",
            secondInputLabel: "名称",
            secondInputPlaceholder: "输入名称（可选）",
            secondInputType: "text",
            secondDefaultValue: "",
        });

        if (!values) {
            lastAction.value = "添加网址：已取消";
            return;
        }

        const [url, name] = values;
        let trimmedUrl = (url || "").trim();
        const trimmedName = (name || "").trim();

        if (!trimmedUrl) {
            lastAction.value = "添加网址失败：网址不能为空";
            return;
        }

        if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
            trimmedUrl = "https://" + trimmedUrl;
        }

        const finalName = trimmedName || (() => {
            try {
                return new URL(trimmedUrl).hostname;
            } catch {
                return trimmedUrl;
            }
        })();

        const pendingItemId = menuAddUrlItem(store, currentCategoryId.value, {
            name: finalName,
            url: trimmedUrl,
            icon_base64: null,
        });

        lastAction.value = `已添加网址：${finalName}`;

        void fetchFaviconAsync(trimmedUrl, pendingItemId, currentCategoryId.value);
    }

    async function fetchFaviconAsync(url: string, itemId: string, categoryId: string) {
        try {
            const iconBase64 = await menuInvoke<string | null>("fetch_favicon_from_url", {
                url,
            });
            if (iconBase64) {
                menuUpdateItemIcon(store, categoryId, itemId, iconBase64);
            } else {
                showToast("已添加（该网址无favicon.ico图标）");
            }
        } catch {
            showToast("已添加（图标获取失败）");
        }
    }

    function onEditItem() {
        if (!currentCategoryId.value || !currentLauncherItemId.value) return;
        deps.router.push({
            name: "launcher-item-edit",
            params: {
                categoryId: currentCategoryId.value,
                itemId: currentLauncherItemId.value,
            },
        });
        closeContextMenu();
    }

    async function onDeleteItem() {
        if (!currentCategoryId.value || !currentLauncherItemId.value) return;
        const confirmed = await confirm({
            title: "确认删除",
            message: "确定要删除此启动项吗？此操作不可撤销。",
            confirmText: "删除",
            cancelText: "取消",
        });
        if (!confirmed) return;
        menuRemoveItem(
            store,
            statsStore,
            currentCategoryId.value,
            currentLauncherItemId.value
        );
        closeContextMenu();
    }

    function onChangeIcon(base64: string) {
        if (!currentCategoryId.value || !currentLauncherItemId.value) return;
        menuSetItemIcon(
            store,
            currentCategoryId.value,
            currentLauncherItemId.value,
            base64
        );
    }

    function onResetIcon() {
        if (!currentCategoryId.value || !currentLauncherItemId.value) return;
        menuResetItemIcon(
            store,
            currentCategoryId.value,
            currentLauncherItemId.value
        );
    }

    function onTogglePinned() {
        if (!currentCategoryId.value || !currentLauncherItemId.value) return;
        menuTogglePin(store, currentCategoryId.value, currentLauncherItemId.value);
    }

    function onToggleScenarioMembership(scenario: ScenarioKey) {
        if (!currentLauncherItemId.value) return;
        store.toggleScenarioItem(scenario, currentLauncherItemId.value);
        closeContextMenu();
    }

    function onClearScenarioMembership() {
        if (!currentLauncherItemId.value) return;
        store.removeItemFromAllScenarios(currentLauncherItemId.value);
        closeContextMenu();
    }

    return {
        onAddItem,
        onAddUrlItem,
        onEditItem,
        onDeleteItem,
        onChangeIcon,
        onResetIcon,
        onTogglePinned,
        onToggleScenarioMembership,
        onClearScenarioMembership,
    };
}
