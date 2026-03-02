import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

type ContextMenuState =
    | {
        visible: false;
        x: 0;
        y: 0;
    }
    | {
        visible: true;
        x: number;
        y: number;
    };

export type Category = {
    id: string;
    name: string;
};

export type LauncherItem = {
    id: string;
    name: string;
    path: string;
    isDirectory: boolean;
    iconBase64: string | null;
};

type AppSettings = {
    toggle_shortcut: string;
    follow_mouse_on_show: boolean;
    follow_mouse_y_anchor: "top" | "center" | "bottom";
};

export enum enumContextMenuType {
    Categorie = "categorie",
    CategorieView = "categorie-view",
    IconView = "icon-view",
    IconItem = "icon-item",
}



export const Store = defineStore(
    "All",
    () => {
        const ContextMenu = ref<ContextMenuState>({
            visible: false,
            x: 0,
            y: 0,
        });
        const ContextMenuType = ref<enumContextMenuType>(enumContextMenuType.CategorieView);
        const categoryCols = ref<number>(5);
        const launcherCols = ref<number>(5);
        const toggleShortcut = ref<string>("alt+space");
        const followMouseOnShow = ref<boolean>(false);
        const followMouseYAnchor = ref<"top" | "center" | "bottom">("center");
        const editingCategoryId = ref<string | null>(null);
        const editingCategoryName = ref<string>("");
        const isEditingCategory = computed(() => editingCategoryId.value !== null);
        const currentCategoryId = ref<string | null>(null);

        const categories = ref<Category[]>([
            { id: "cat-1", name: "游戏" },
            { id: "cat-2", name: "工具" },
            { id: "cat-3", name: "系统" },
            { id: "cat-4", name: "其他" },
        ]);

        const launcherItemsByCategoryId = ref<Record<string, LauncherItem[]>>({});

        /**
         * 打开自定义右键菜单并设置显示位置。
         */
        function openContextMenu(x: number, y: number) {
            ContextMenu.value = { visible: true, x, y };
        }

        /**
         * 关闭自定义右键菜单。
         */
        function closeContextMenu() {
            ContextMenu.value = { visible: false, x: 0, y: 0 };
        }

        /**
         * 设置类目图标每行数量并持久化到本地。
         */
        function setCategoryCols(cols: number) {
            const next = Math.min(8, Math.max(4, Math.floor(cols)));
            categoryCols.value = next;
        }

        /**
         * 设置启动项图标每行数量并持久化到本地。
         */
        function setLauncherCols(cols: number) {
            const next = Math.min(8, Math.max(4, Math.floor(cols)));
            launcherCols.value = next;
        }

        async function hydrateAppSettings() {
            try {
                const settings = await invoke<AppSettings>("get_app_settings");
                const backendShortcut = settings?.toggle_shortcut || "alt+space";
                const backendFollow = !!settings?.follow_mouse_on_show;
                const backendAnchor = settings?.follow_mouse_y_anchor || "center";

                const desiredShortcut = toggleShortcut.value?.trim() || backendShortcut;
                const desiredFollow = !!followMouseOnShow.value;
                const desiredAnchor = followMouseYAnchor.value || backendAnchor;

                if (desiredShortcut !== backendShortcut) {
                    await invoke("set_toggle_shortcut", { shortcut: desiredShortcut });
                    toggleShortcut.value = desiredShortcut;
                } else {
                    toggleShortcut.value = backendShortcut;
                }

                if (desiredFollow !== backendFollow) {
                    await invoke("set_follow_mouse_on_show", { enabled: desiredFollow });
                } else {
                    followMouseOnShow.value = backendFollow;
                }

                if (desiredAnchor !== backendAnchor) {
                    await invoke("set_follow_mouse_y_anchor", { anchor: desiredAnchor });
                    followMouseYAnchor.value = desiredAnchor;
                } else {
                    followMouseYAnchor.value = backendAnchor;
                }
            } catch (e) {
                console.error(e);
            }
        }

        async function setToggleShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            try {
                await invoke("set_toggle_shortcut", { shortcut: next });
                toggleShortcut.value = next;
            } catch (e) {
                console.error(e);
            }
        }

        async function setFollowMouseOnShow(enabled: boolean) {
            try {
                await invoke("set_follow_mouse_on_show", { enabled });
                followMouseOnShow.value = enabled;
            } catch (e) {
                console.error(e);
            }
        }

        async function setFollowMouseYAnchor(anchor: "top" | "center" | "bottom") {
            try {
                await invoke("set_follow_mouse_y_anchor", { anchor });
                followMouseYAnchor.value = anchor;
            } catch (e) {
                console.error(e);
            }
        }

        /**
         * 生成新的类目 ID。
         */
        function createCategoryId() {
            return `cat-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        }

        /**
         * 生成新的启动项 ID。
         */
        function createLauncherItemId() {
            return `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        }

        /**
         * 从路径中提取文件名。
         */
        function getNameFromPath(path: string) {
            const normalized = path.replace(/\\/g, "/");
            const segments = normalized.split("/").filter(Boolean);
            const base = segments[segments.length - 1] || path;
            const lower = base.toLowerCase();
            if (lower.endsWith(".lnk")) return base.slice(0, -4);
            if (lower.endsWith(".exe")) return base.slice(0, -4);
            return base;
        }

        /**
         * 设置当前进入的类目。
         */
        function setCurrentCategory(categoryId: string | null) {
            currentCategoryId.value = categoryId;
        }

        /**
         * 根据 ID 获取类目信息。
         */
        function getCategoryById(categoryId: string) {
            return categories.value.find((item) => item.id === categoryId) || null;
        }

        /**
         * 获取指定类目的启动项列表。
         */
        function getLauncherItemsByCategoryId(categoryId: string) {
            return launcherItemsByCategoryId.value[categoryId] || [];
        }

        /**
         * 覆盖写入指定类目的启动项列表（用于拖拽排序）。
         */
        function setLauncherItemsByCategoryId(categoryId: string, items: LauncherItem[]) {
            launcherItemsByCategoryId.value = {
                ...launcherItemsByCategoryId.value,
                [categoryId]: items,
            };
        }

        /**
         * 获取指定类目下的某个启动项。
         */
        function getLauncherItemById(categoryId: string, itemId: string) {
            return getLauncherItemsByCategoryId(categoryId).find((x) => x.id === itemId) || null;
        }

        /**
         * 更新指定类目下的启动项信息。
         */
        function updateLauncherItem(
            categoryId: string,
            itemId: string,
            patch: Partial<Pick<LauncherItem, "name">>
        ) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = { ...next[index], ...patch };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        /**
         * 删除指定类目下的启动项。
         */
        function deleteLauncherItem(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next.splice(index, 1);
            setLauncherItemsByCategoryId(categoryId, next);
        }

        /**
         * 将外部拖拽的数据添加为类目下的启动项。
         */
        function addLauncherItemsToCategory(
            categoryId: string,
            payload: {
                paths: string[];
                directories: string[];
                icon_base64s: Array<string | null>;
            }
        ) {
            const existing = getLauncherItemsByCategoryId(categoryId);
            const directorySet = new Set(payload.directories);

            const nextItems: LauncherItem[] = payload.paths.map((path, index) => {
                const iconBase64 =
                    payload.icon_base64s[index] !== undefined
                        ? payload.icon_base64s[index]
                        : null;
                return {
                    id: createLauncherItemId(),
                    name: getNameFromPath(path),
                    path,
                    isDirectory: directorySet.has(path),
                    iconBase64,
                };
            });

            setLauncherItemsByCategoryId(categoryId, [...existing, ...nextItems]);
        }

        /**
         * 开始添加类目并进入编辑状态。
         */
        function beginAddCategory() {
            const newCategory = { id: createCategoryId(), name: "" };
            categories.value.push(newCategory);
            editingCategoryId.value = newCategory.id;
            editingCategoryName.value = "";
        }

        /**
         * 开始重命名指定类目并进入编辑状态。
         */
        function beginRenameCategory(categoryId: string) {
            const target = categories.value.find((item) => item.id === categoryId);
            if (!target) return;
            editingCategoryId.value = categoryId;
            editingCategoryName.value = target.name;
        }

        /**
         * 提交当前类目的编辑结果。
         */
        function confirmCategoryEdit(name: string) {
            if (!editingCategoryId.value) return;
            const target = categories.value.find((item) => item.id === editingCategoryId.value);
            if (target) {
                target.name = name.trim();
            }
            editingCategoryId.value = null;
            editingCategoryName.value = "";
        }

        /**
         * 删除指定类目并清理编辑状态。
         */
        function deleteCategory(categoryId: string) {
            const index = categories.value.findIndex((item) => item.id === categoryId);
            if (index === -1) return;
            categories.value.splice(index, 1);
            if (editingCategoryId.value === categoryId) {
                editingCategoryId.value = null;
                editingCategoryName.value = "";
            }
            if (currentCategoryId.value === categoryId) {
                currentCategoryId.value = null;
            }
            const next = { ...launcherItemsByCategoryId.value };
            delete next[categoryId];
            launcherItemsByCategoryId.value = next;
        }

        return {
            ContextMenu,
            ContextMenuType,
            categoryCols,
            launcherCols,
            toggleShortcut,
            followMouseOnShow,
            followMouseYAnchor,
            openContextMenu,
            closeContextMenu,
            setCategoryCols,
            setLauncherCols,
            hydrateAppSettings,
            setToggleShortcut,
            setFollowMouseOnShow,
            setFollowMouseYAnchor,
            categories,
            currentCategoryId,
            launcherItemsByCategoryId,
            setCurrentCategory,
            getCategoryById,
            getLauncherItemsByCategoryId,
            setLauncherItemsByCategoryId,
            getLauncherItemById,
            updateLauncherItem,
            deleteLauncherItem,
            addLauncherItemsToCategory,
            editingCategoryId,
            editingCategoryName,
            isEditingCategory,
            beginAddCategory,
            beginRenameCategory,
            confirmCategoryEdit,
            deleteCategory,
        };
    },
    {
        persist: {
            pick: [
                "categoryCols",
                "launcherCols",
                "categories",
                "currentCategoryId",
                "launcherItemsByCategoryId",
                "toggleShortcut",
                "followMouseOnShow",
                "followMouseYAnchor",
            ],
        },
    }
);
