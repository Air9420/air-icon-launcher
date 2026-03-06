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
    customIconBase64: string | null;
};

export type LauncherItem = {
    id: string;
    name: string;
    path: string;
    isDirectory: boolean;
    iconBase64: string | null;
    originalIconBase64?: string | null;
    isFavorite?: boolean;
    lastUsedAt?: number;
};

export type GlobalSearchResult = {
    item: LauncherItem;
    categoryId: string;
    categoryName: string;
};

type AppSettings = {
    toggle_shortcut: string;
    follow_mouse_on_show: boolean;
    follow_mouse_y_anchor: "top" | "center" | "bottom";
};

type AutostartServiceStatus = {
    installed: boolean;
};

export enum enumContextMenuType {
    Categorie = "categorie",
    CategorieView = "categorie-view",
    IconView = "icon-view",
    IconItem = "icon-item",
}

export type ThemeMode = "light" | "dark" | "system" | "transparent";

export type ClipboardRecord = {
    id: string;
    content: string;
    type: "text" | "image";
    timestamp: number;
};

export type RecentUsedItem = {
    categoryId: string;
    itemId: string;
    usedAt: number;
};

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
        const clipboardShortcut = ref<string>("alt+v");
        const followMouseOnShow = ref<boolean>(false);
        const followMouseYAnchor = ref<"top" | "center" | "bottom">("center");
        const autostartServiceEnabled = ref<boolean>(false);
        const autostartServiceLoading = ref<boolean>(false);
        const autostartServiceError = ref<string>("");
        const editingCategoryId = ref<string | null>(null);
        const editingCategoryName = ref<string>("");
        const isEditingCategory = computed(() => editingCategoryId.value !== null);
        const currentCategoryId = ref<string | null>(null);
        const theme = ref<ThemeMode>("system");
        const searchKeyword = ref<string>("");
        const clipboardHistory = ref<ClipboardRecord[]>([]);
        const clipboardHistoryEnabled = ref<boolean>(true);
        const favoriteItemIds = ref<string[]>([]);
        const recentUsedItems = ref<RecentUsedItem[]>([]);

        const categories = ref<Category[]>([
            { id: "cat-1", name: "游戏", customIconBase64: null },
            { id: "cat-2", name: "工具", customIconBase64: null },
            { id: "cat-3", name: "系统", customIconBase64: null },
            { id: "cat-4", name: "其他", customIconBase64: null },
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

        async function setClipboardShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            try {
                await invoke("set_clipboard_shortcut", { shortcut: next });
                clipboardShortcut.value = next;
            } catch (e) {
                console.error(e);
                throw e;
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
         * 刷新“开机自启服务”的真实安装状态并同步到本地状态。
         */
        async function refreshAutostartServiceStatus() {
            autostartServiceError.value = "";
            try {
                const status = await invoke<AutostartServiceStatus>(
                    "get_autostart_service_status"
                );
                autostartServiceEnabled.value = !!status?.installed;
            } catch (e) {
                autostartServiceError.value = "无法获取开机自启状态";
                console.error(e);
            }
        }

        /**
         * 启用/关闭“开机自启（服务方式）”。
         */
        async function setAutostartServiceEnabled(enabled: boolean) {
            const desired = !!enabled;
            autostartServiceLoading.value = true;
            autostartServiceError.value = "";
            try {
                await invoke("set_autostart_service_enabled", { enabled: desired });
                await refreshAutostartServiceStatus();
            } catch (e: any) {
                const message =
                    typeof e === "string"
                        ? e
                        : e?.message
                          ? String(e.message)
                          : "开机自启设置失败";
                autostartServiceError.value = message;
                console.error(e);
                await refreshAutostartServiceStatus();
            } finally {
                autostartServiceLoading.value = false;
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
                    originalIconBase64: iconBase64,
                };
            });

            setLauncherItemsByCategoryId(categoryId, [...existing, ...nextItems]);
        }

        /**
         * 开始添加类目并进入编辑状态。
         */
        function beginAddCategory() {
            const newCategory = { id: createCategoryId(), name: "", customIconBase64: null };
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

        function setCategoryIcon(categoryId: string, iconBase64: string) {
            const target = categories.value.find((item) => item.id === categoryId);
            if (target) {
                target.customIconBase64 = iconBase64;
            }
        }

        function setLauncherItemIcon(categoryId: string, itemId: string, iconBase64: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = { ...next[index], iconBase64 };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function resetCategoryIcon(categoryId: string) {
            const target = categories.value.find((item) => item.id === categoryId);
            if (target) {
                target.customIconBase64 = null;
            }
        }

        function resetLauncherItemIcon(categoryId: string, itemId: string) {
            const list = getLauncherItemsByCategoryId(categoryId);
            const index = list.findIndex((x) => x.id === itemId);
            if (index === -1) return;
            const next = [...list];
            next[index] = { 
                ...next[index], 
                iconBase64: next[index].originalIconBase64 ?? null 
            };
            setLauncherItemsByCategoryId(categoryId, next);
        }

        function hasCustomIcon(categoryId: string, itemId: string): boolean {
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return false;
            return item.iconBase64 !== item.originalIconBase64;
        }

        function setTheme(newTheme: ThemeMode) {
            theme.value = newTheme;
        }

        function addClipboardRecord(record: ClipboardRecord) {
            const exists = clipboardHistory.value.some(r => r.content === record.content);
            if (!exists) {
                clipboardHistory.value.unshift(record);
                if (clipboardHistory.value.length > 50) {
                    clipboardHistory.value = clipboardHistory.value.slice(0, 50);
                }
            }
        }

        function removeClipboardRecord(id: string) {
            const index = clipboardHistory.value.findIndex(r => r.id === id);
            if (index !== -1) {
                clipboardHistory.value.splice(index, 1);
            }
        }

        function clearClipboardHistory() {
            clipboardHistory.value = [];
        }

        function setClipboardHistoryEnabled(enabled: boolean) {
            clipboardHistoryEnabled.value = enabled;
        }

        function fuzzyMatch(text: string, keyword: string): boolean {
            const lowerText = text.toLowerCase();
            const lowerKeyword = keyword.toLowerCase();
            if (lowerText.includes(lowerKeyword)) return true;
            let keywordIndex = 0;
            for (let i = 0; i < lowerText.length && keywordIndex < lowerKeyword.length; i++) {
                if (lowerText[i] === lowerKeyword[keywordIndex]) {
                    keywordIndex++;
                }
            }
            return keywordIndex === lowerKeyword.length;
        }

        const filteredCategories = computed<Category[]>(() => {
            const keyword = searchKeyword.value.trim();
            if (!keyword) return categories.value;
            return categories.value.filter((cat) => fuzzyMatch(cat.name, keyword));
        });

        const filteredLauncherItems = computed<LauncherItem[]>(() => {
            const keyword = searchKeyword.value.trim();
            if (!currentCategoryId.value) return [];
            if (!keyword) return getLauncherItemsByCategoryId(currentCategoryId.value);
            const items = getLauncherItemsByCategoryId(currentCategoryId.value);
            return items.filter((item) => fuzzyMatch(item.name, keyword));
        });

        const globalSearchResults = computed<GlobalSearchResult[]>(() => {
            const keyword = searchKeyword.value.trim();
            if (!keyword) return [];
            const results: GlobalSearchResult[] = [];
            for (const cat of categories.value) {
                const items = getLauncherItemsByCategoryId(cat.id);
                for (const item of items) {
                    if (fuzzyMatch(item.name, keyword)) {
                        results.push({
                            item,
                            categoryId: cat.id,
                            categoryName: cat.name,
                        });
                    }
                }
            }
            return results;
        });

        function clearSearch() {
            searchKeyword.value = "";
        }

        function toggleFavorite(categoryId: string, itemId: string) {
            const item = getLauncherItemById(categoryId, itemId);
            if (!item) return;
            const isFavorite = favoriteItemIds.value.includes(itemId);
            if (isFavorite) {
                favoriteItemIds.value = favoriteItemIds.value.filter(id => id !== itemId);
            } else {
                favoriteItemIds.value = [...favoriteItemIds.value, itemId];
            }
        }

        function isItemFavorite(itemId: string): boolean {
            return favoriteItemIds.value.includes(itemId);
        }

        function recordItemUsage(categoryId: string, itemId: string) {
            const now = Date.now();
            const existingIndex = recentUsedItems.value.findIndex(
                r => r.categoryId === categoryId && r.itemId === itemId
            );
            if (existingIndex !== -1) {
                recentUsedItems.value.splice(existingIndex, 1);
            }
            recentUsedItems.value.unshift({ categoryId, itemId, usedAt: now });
            if (recentUsedItems.value.length > 50) {
                recentUsedItems.value = recentUsedItems.value.slice(0, 50);
            }
        }

        function clearRecentUsed() {
            recentUsedItems.value = [];
        }

        function importCategories(newCategories: Category[]) {
            categories.value = newCategories;
        }

        function importLauncherItems(items: Record<string, LauncherItem[]>) {
            launcherItemsByCategoryId.value = items;
        }

        function importFavoriteItemIds(newIds: string[]) {
            favoriteItemIds.value = newIds;
        }

        function importRecentUsedItems(newItems: RecentUsedItem[]) {
            recentUsedItems.value = newItems;
        }

        function getRecentUsedItems(limit: number = 5): RecentUsedItem[] {
            return recentUsedItems.value.slice(0, limit);
        }

        function getRecentUsedItemInfo(recentItem: RecentUsedItem): { item: LauncherItem | null; category: Category | null } {
            const category = getCategoryById(recentItem.categoryId);
            const item = getLauncherItemById(recentItem.categoryId, recentItem.itemId);
            return { item, category };
        }

        return {
            ContextMenu,
            ContextMenuType,
            categoryCols,
            launcherCols,
            toggleShortcut,
            followMouseOnShow,
            followMouseYAnchor,
            autostartServiceEnabled,
            autostartServiceLoading,
            autostartServiceError,
            openContextMenu,
            closeContextMenu,
            setCategoryCols,
            setLauncherCols,
            hydrateAppSettings,
            setToggleShortcut,
            clipboardShortcut,
            setClipboardShortcut,
            setFollowMouseOnShow,
            setFollowMouseYAnchor,
            refreshAutostartServiceStatus,
            setAutostartServiceEnabled,
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
            setCategoryIcon,
            setLauncherItemIcon,
            resetCategoryIcon,
            resetLauncherItemIcon,
            hasCustomIcon,
            theme,
            setTheme,
            clipboardHistory,
            clipboardHistoryEnabled,
            addClipboardRecord,
            removeClipboardRecord,
            clearClipboardHistory,
            setClipboardHistoryEnabled,
            searchKeyword,
            filteredCategories,
            filteredLauncherItems,
            globalSearchResults,
            clearSearch,
            favoriteItemIds,
            recentUsedItems,
            toggleFavorite,
            isItemFavorite,
            recordItemUsage,
            clearRecentUsed,
            importCategories,
            importLauncherItems,
            importFavoriteItemIds,
            importRecentUsedItems,
            getRecentUsedItems,
            getRecentUsedItemInfo,
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
                "clipboardShortcut",
                "followMouseOnShow",
                "followMouseYAnchor",
                "autostartServiceEnabled",
                "theme",
                "clipboardHistoryEnabled",
                "favoriteItemIds",
                "recentUsedItems",
            ],
        },
    }
);
