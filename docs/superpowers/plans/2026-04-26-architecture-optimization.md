# air-icon-launcher 架构优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拆分过大的launcherStore，统一图标缓存，简化持久化策略，优化前端computed链，控制插件系统复杂度

**Architecture:**
- 将1773行的launcherStore拆分为itemsStore(CRUD)、searchStore(搜索索引)、pinningStore(置顶/最近/依赖)
- 图标缓存独立为iconCacheStore，与itemsStore协同
- 持久化策略明确区分前端独有数据vs前后端共享数据
- categories.vue的computed链优化，减少不必要的重复计算

**Tech Stack:** Vue 3 + TypeScript + Pinia + Tauri + Vitest

---

## 文件影响地图

### 任务1：拆分 launcherStore

**Files:**
- Create: `src/stores/itemsStore.ts` - 启动项CRUD、分类关联、图标基础操作
- Create: `src/stores/searchStore.ts` - 搜索索引同步、拼音搜索
- Create: `src/stores/pinningStore.ts` - 置顶、最近使用、启动依赖
- Modify: `src/stores/index.ts` - 导出新stores
- Modify: `src/stores/launcherStore.ts` - 删除已迁移逻辑，保留启动执行相关
- Modify: `src/views/categories.vue` - 更新store引用
- Modify: `src/composables/useSearch.ts` - 更新store引用
- Modify: `src/components/home/*.vue` - 更新store引用
- Modify: `src/views/settings/*.vue` - 更新store引用
- Test: `src/stores/__tests__/launcherStore.test.ts` - 拆分后测试

### 任务2：统一图标缓存

**Files:**
- Create: `src/stores/iconCacheStore.ts` - 统一的图标缓存管理
- Modify: `src/stores/itemsStore.ts` - 移除独立的图标缓存逻辑
- Modify: `src/utils/launcher-icon-cache.ts` - 保留为底层实现，iconCacheStore调用
- Modify: `src/stores/launcherStore.ts` - 删除图标缓存相关
- Test: `src/stores/__tests__/iconCacheStore.test.ts`

### 任务3：简化持久化策略

**Files:**
- Modify: `src/stores/settingsStore.ts` - 移除双写，改为纯前端persist
- Modify: `src/composables/useDataManagement.ts` - 明确数据边界
- Modify: `src-tauri/src/config/mod.rs` - 明确哪些配置只走后端
- Create: `docs/ARCHITECTURE.md` - 记录持久化策略决策

### 任务4：优化 categories.vue computed链

**Files:**
- Modify: `src/views/categories.vue` - 优化computed依赖
- Create: `src/composables/useHomePageState.ts` - 提取首页状态逻辑
- Modify: `src/stores/statsStore.ts` - 优化timeBasedRecommendations计算

### 任务5：控制插件权限复杂度

**Files:**
- Modify: `src/plugins/permissions.ts` - 收缩权限类型
- Modify: `src/plugins/types.ts` - 更新权限类型定义
- Modify: `src/plugins/manager.ts` - 简化权限检查逻辑

---

## 实施任务

### Task 1: 拆分 launcherStore

**目标:** 将1773行的launcherStore拆分为itemsStore、searchStore、pinningStore

#### Phase 1.1: 创建 itemsStore

- [ ] **Step 1: 创建 itemsStore.ts 骨架**

```typescript
// src/stores/itemsStore.ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useCategoryStore, type Category } from "./categoryStore";
import { useStatsStore } from "./statsStore";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

export type LauncherItem = {
    id: string;
    name: string;
    path: string;
    url?: string;
    itemType: 'file' | 'url';
    isDirectory: boolean;
    iconBase64: string | null;
    hasCustomIcon?: boolean;
    launchDependencies: LaunchDependency[];
    launchDelaySeconds: number;
};

export type LaunchDependency = {
    categoryId: string;
    itemId: string;
    delayAfterSeconds: number;
};

export const useItemsStore = defineStore(
    "items",
    () => {
        const launcherItemsByCategoryId = ref<Record<string, LauncherItem[]>>({});

        function createLauncherItemId() {
            return `item-${crypto.randomUUID()}`;
        }

        function getLauncherItemsByCategoryId(categoryId: string) {
            return launcherItemsByCategoryId.value[categoryId] || [];
        }

        function setLauncherItemsByCategoryId(categoryId: string, items: LauncherItem[]) {
            launcherItemsByCategoryId.value = {
                ...launcherItemsByCategoryId.value,
                [categoryId]: items,
            };
        }

        function getLauncherItemById(categoryId: string, itemId: string) {
            return getLauncherItemsByCategoryId(categoryId).find((x) => x.id === itemId) || null;
        }

        // ... 更多CRUD方法

        return {
            launcherItemsByCategoryId,
            createLauncherItemId,
            getLauncherItemsByCategoryId,
            setLauncherItemsByCategoryId,
            getLauncherItemById,
            // ... 导出所有方法
        };
    },
    { persist: createVersionedPersistConfig("items", ["launcherItemsByCategoryId"]) }
);
```

- [ ] **Step 2: 创建 searchStore.ts 骨架**

```typescript
// src/stores/searchStore.ts
import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "../utils/invoke-wrapper";
import { SEARCH_REQUEST_TIMEOUT_MS } from "../utils/search-config";

export type RustSearchResult = {
    id: string;
    name: string;
    path: string;
    category_id: string;
    match_type: RustSearchMatchType;
    fuzzy_score: number;
    matched_pinyin_initial: boolean;
    matched_pinyin_full: boolean;
    rank_score: number;
};

export const useSearchStore = defineStore(
    "search",
    () => {
        const rustSearchResults = ref<RustSearchResult[]>([]);
        const isRustSearchReady = ref(false);
        const pendingSearchAdded = new Map<string, SearchIndexItemPayload>();
        const pendingSearchUpdated = new Map<string, SearchIndexItemPayload>();
        const pendingSearchDeleted = new Map<string, SearchIndexDeletedPayload>();

        async function syncSearchIndex(items: SearchIndexItemPayload[]) {
            // 迁移自 launcherStore 的搜索索引同步逻辑
        }

        async function search(keyword: string, limit: number = 20) {
            // 迁移自 launcherStore 的搜索逻辑
        }

        return {
            rustSearchResults,
            isRustSearchReady,
            syncSearchIndex,
            search,
        };
    }
);
```

- [ ] **Step 3: 创建 pinningStore.ts 骨架**

```typescript
// src/stores/pinningStore.ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

export type RecentUsedItem = {
    categoryId: string;
    itemId: string;
    usedAt: number;
    usageCount: number;
};

export const usePinningStore = defineStore(
    "pinning",
    () => {
        const pinnedItemIds = ref<string[]>([]);
        const recentUsedItems = ref<RecentUsedItem[]>([]);

        function togglePinned(itemId: string) {
            // 迁移自 launcherStore
        }

        function recordItemUsage(categoryId: string, itemId: string) {
            // 迁移自 launcherStore
        }

        return {
            pinnedItemIds,
            recentUsedItems,
            togglePinned,
            recordItemUsage,
        };
    },
    { persist: createVersionedPersistConfig("pinning", ["pinnedItemIds", "recentUsedItems"]) }
);
```

- [ ] **Step 4: 更新 stores/index.ts**

```typescript
// src/stores/index.ts
export { useItemsStore, type LauncherItem, type LaunchDependency } from "./itemsStore";
export { useSearchStore, type RustSearchResult } from "./searchStore";
export { usePinningStore, type RecentUsedItem } from "./pinningStore";
export { useLauncherStore } from "./launcherStore";
// ... 其他exports
```

- [ ] **Step 5: 迁移 launcherStore 中的方法到新stores**

将以下方法迁移到对应store：
- itemsStore: `getLauncherItemsByCategoryId`, `setLauncherItemsByCategoryId`, `getLauncherItemById`, `addLauncherItemsToCategory`, `createLauncherItemInCategory`, `deleteLauncherItem`, `moveLauncherItems`, `updateLauncherItem` 等
- searchStore: `syncSearchIndex`, `searchLauncherItems`, `rustSearch`, `rustSearchResults`, `isRustSearchReady` 等
- pinningStore: `togglePinned`, `isItemPinned`, `recordItemUsage`, `clearRecentUsed`, `getRecentUsedItems`, `getPinnedMergedItems`, `getRecentUsedMergedItems` 等

- [ ] **Step 6: 更新所有引用处**

需要更新的文件：
- `src/views/categories.vue`
- `src/views/category.vue`
- `src/views/launcher-item-edit.vue`
- `src/components/home/*.vue`
- `src/composables/useSearch.ts`
- `src/composables/useMenuActions.ts`
- `src/composables/useContextMenu.ts`
- `src/utils/launcher-executor.ts`
- `src/utils/launcher-service.ts`

- [ ] **Step 7: 运行测试验证**

```bash
npm run test:unit -- src/stores/__tests__/launcherStore.test.ts
npm run typecheck
```

- [ ] **Step 8: 提交代码**

```bash
git add src/stores/itemsStore.ts src/stores/searchStore.ts src/stores/pinningStore.ts
git commit -m "refactor: split launcherStore into itemsStore, searchStore, pinningStore"
```

---

### Task 2: 统一图标缓存

**目标:** 将分散的图标缓存逻辑统一到iconCacheStore

- [ ] **Step 1: 创建 iconCacheStore.ts**

```typescript
// src/stores/iconCacheStore.ts
import { defineStore } from "pinia";
import { ref } from "vue";
import {
    getCachedLauncherIcon,
    setCachedLauncherIcon,
    type CachedIconEntry
} from "../utils/launcher-icon-cache";

export const useIconCacheStore = defineStore(
    "iconCache",
    () => {
        const cachedIcons = ref<Map<string, CachedIconEntry>>(new Map());

        function getCachedIcon(path: string): string | null {
            return getCachedLauncherIcon(path);
        }

        function setCachedIcon(path: string, icon: string) {
            setCachedLauncherIcon(path, icon);
        }

        function removeCachedIcons(paths: string[]) {
            // 清理图标缓存
        }

        return {
            getCachedIcon,
            setCachedIcon,
            removeCachedIcons,
        };
    }
);
```

- [ ] **Step 2: 更新 itemsStore 使用 iconCacheStore**

```typescript
// 在 itemsStore 中
import { useIconCacheStore } from "./iconCacheStore";

function cacheOriginalIconForFileItem(...) {
    const iconCacheStore = useIconCacheStore();
    iconCacheStore.setCachedIcon(path, icon);
}
```

- [ ] **Step 3: 删除 launcher-icon-cache.ts 中的跨Store共享逻辑**

```typescript
// src/utils/launcher-icon-cache.ts
// 简化为纯底层实现，由 iconCacheStore 调用
```

- [ ] **Step 4: 在分类删除时自动清理缓存**

```typescript
// 在 categoryStore 的 deleteCategory 中调用
function deleteCategory(categoryId: string) {
    const items = itemsStore.getLauncherItemsByCategoryId(categoryId);
    const paths = items.map(item => item.path).filter(Boolean);
    iconCacheStore.removeCachedIcons(paths);
    // ... 其他清理逻辑
}
```

- [ ] **Step 5: 运行测试验证**

```bash
npm run test:unit -- src/stores/__tests__/iconCacheStore.test.ts
npm run typecheck
```

- [ ] **Step 6: 提交代码**

```bash
git add src/stores/iconCacheStore.ts src/stores/itemsStore.ts src/utils/launcher-icon-cache.ts
git commit -m "refactor: unify icon cache into iconCacheStore"
```

---

### Task 3: 简化持久化策略

**目标:** 明确前端/后端数据边界，消除双写

- [ ] **Step 1: 分析当前双写问题**

当前情况：
- settingsStore 同时使用 pinia persist (前端) 和 saveAppConfigPatch (后端)
- 需要明确：哪些设置只需要前端，哪些需要后端同步

建议决策：
| 数据 | 持久化位置 | 原因 |
|------|------------|------|
| theme, windowEffectType | 前端 + 后端 | 窗口特效需要Rust控制 |
| toggleShortcut | 前端 + 后端 | 快捷键需要Rust注册 |
| clipboard相关 | 前端 + 后端 | 剪贴板监控需要Rust |
| categoryCols, launcherCols | 仅前端 | UI状态不需要后端 |
| windowPosition | 仅前端 | 窗口位置本地存储 |

- [ ] **Step 2: 更新 settingsStore persist配置**

```typescript
// src/stores/settingsStore.ts
{
    persist: createVersionedPersistConfig("settings", [
        // 只需要前端的配置
        "categoryCols",
        "launcherCols", 
        "homeSectionLayouts",
        "windowPosition",
        // 需要前后端同步的标记
    ]),
}
```

- [ ] **Step 3: 创建 persist-config.ts 明确边界**

```typescript
// src/stores/persist-config.ts

// 前端独有的配置（只走 pinia persist）
export const FRONTEND_ONLY_SETTINGS = [
    "categoryCols",
    "launcherCols",
    "homeSectionLayouts",
    "windowPosition",
    "showGuideOnStartup",
] as const;

// 需要前后端同步的配置（双写）
export const SYNCED_SETTINGS = [
    "theme",
    "windowEffectType",
    "toggleShortcut",
    "clipboardShortcut",
    "followMouseOnShow",
    "followMouseYAnchor",
    "ctrlDragEnabled",
    "autoHideAfterLaunch",
    "cornerHotspotEnabled",
    "cornerHotspotPosition",
    "cornerHotspotSensitivity",
    "performanceMode",
    "strongShortcutMode",
    "clipboardHistoryEnabled",
    "clipboardMaxRecords",
    "hideOnCtrlRightClick",
] as const;
```

- [ ] **Step 4: 更新 useDataManagement.ts 明确导入导出逻辑**

```typescript
// src/composables/useDataManagement.ts
// 明确哪些设置导入时需要调用 Rust 后端
```

- [ ] **Step 5: 编写文档**

```markdown
<!-- docs/ARCHITECTURE.md -->
# 持久化策略

## 数据分类

### 1. 前端独有数据
- 存储：Pinia persist (localStorage)
- 特点：纯UI状态，不需要Rust后端支持

### 2. 前后端同步数据
- 存储：Pinia persist + Rust backend
- 同步机制：双写
- 场景：需要Rust注册的系统功能（快捷键、窗口特效、剪贴板监控）

### 3. 纯后端数据
- 存储：Rust backend only
- 特点：跨设备同步或安全敏感（API keys等）
```

- [ ] **Step 6: 运行测试验证**

```bash
npm run test:unit
npm run typecheck
```

- [ ] **Step 7: 提交代码**

```bash
git add src/stores/settingsStore.ts src/stores/persist-config.ts docs/ARCHITECTURE.md
git commit -m "docs: clarify persistence strategy and data boundaries"
```

---

### Task 4: 优化 categories.vue computed链

**目标:** 减少不必要的重复计算，优化首页渲染性能

- [ ] **Step 1: 分析当前 computed 依赖链**

```typescript
// categories.vue 中当前的问题链
timeBasedTailCandidates
  └── statsStore.timeBasedRecommendations
        └── store.getLauncherItemById (线性查找) × N

recentDisplayItems
  └── splitRecentDisplayItems
        ├── recentMergedItems
        │     └── store.getRecentUsedMergedItems
        └── timeBasedTailCandidates (重复计算)
```

- [ ] **Step 2: 创建 useHomePageState.ts**

```typescript
// src/composables/useHomePageState.ts
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useItemsStore, usePinningStore, useSearchStore } from "../stores";
import { useStatsStore } from "../stores/statsStore";
import { useCategoryStore } from "../stores/categoryStore";

export function useHomePageState() {
    const itemsStore = useItemsStore();
    const pinningStore = usePinningStore();
    const searchStore = useSearchStore();
    const statsStore = useStatsStore();
    const categoryStore = useCategoryStore();

    // 使用 Map 缓存 getLauncherItemById 结果，避免 O(n) 查找
    const itemCache = computed(() => {
        const cache = new Map<string, LauncherItem>();
        for (const [categoryId, items] of Object.entries(itemsStore.launcherItemsByCategoryId)) {
            for (const item of items) {
                cache.set(`${categoryId}:${item.id}`, item);
            }
        }
        return cache;
    });

    function getItemCached(categoryId: string, itemId: string) {
        return itemCache.value.get(`${categoryId}:${itemId}`) || null;
    }

    const timeBasedTailCandidates = computed(() => {
        // 使用缓存的 getItemCached
        const candidates = [];
        for (const rec of statsStore.timeBasedRecommendations) {
            const item = getItemCached(rec.categoryId, rec.itemId);
            if (item) {
                candidates.push({ ... });
            }
        }
        return candidates;
    });

    return {
        timeBasedTailCandidates,
        // ... 其他计算属性
    };
}
```

- [ ] **Step 3: 更新 categories.vue 使用新 composable**

```typescript
// src/views/categories.vue
import { useHomePageState } from "../composables/useHomePageState";

const {
    timeBasedTailCandidates,
    recentDisplayItems,
    pinnedMergedItems,
} = useHomePageState();
```

- [ ] **Step 4: 优化 splitRecentDisplayItems**

```typescript
// src/utils/home-recommendations.ts
// 使用缓存的 item 查找结果，避免重复构建 Map
```

- [ ] **Step 5: 考虑添加虚拟滚动（如果分类数量 > 50）**

```typescript
// src/components/home/CategoryGrid.vue
// 如果分类数量大，使用虚拟滚动
```

- [ ] **Step 6: 运行测试验证**

```bash
npm run test:unit
npm run typecheck
```

- [ ] **Step 7: 提交代码**

```bash
git add src/composables/useHomePageState.ts src/views/categories.vue
git commit -m "perf: optimize categories.vue computed chain with caching"
```

---

### Task 5: 控制插件权限复杂度

**目标:** 收缩权限类型，聚焦核心场景

- [ ] **Step 1: 分析当前权限类型**

```typescript
// src/plugins/permissions.ts
export const PERMISSION_TYPES = [
    "fs",           // 文件系统
    "window",       // 窗口控制
    "clipboard",    // 剪贴板
    "network",      // 网络请求
    "process",      // 进程管理
] as const;
```

当前问题：
- 5种权限对于v0.1.9版本可能过多
- network 和 process 权限目前没有实际使用场景

- [ ] **Step 2: 收缩权限类型**

```typescript
// src/plugins/permissions.ts
// 建议：暂时只保留实际在用的权限

export const PERMISSION_TYPES = [
    "fs",           // 文件系统 - 必需
    "window",       // 窗口控制 - 必需
    "clipboard",    // 剪贴板 - 必需
] as const;

export const DEFAULT_PERMISSIONS: Permission[] = ["fs", "window", "clipboard"];

// 移除未使用的 network, process 权限
```

- [ ] **Step 3: 更新权限检查逻辑**

```typescript
// src/plugins/manager.ts
// 简化权限验证，移除未使用的权限检查分支
```

- [ ] **Step 4: 更新 types.ts**

```typescript
// src/plugins/types.ts
// 更新 PluginPermission 类型定义
```

- [ ] **Step 5: 运行测试验证**

```bash
npm run test:unit -- src/plugins/__tests__/
npm run typecheck
```

- [ ] **Step 6: 提交代码**

```bash
git add src/plugins/permissions.ts src/plugins/types.ts src/plugins/manager.ts
git commit -m "refactor: simplify plugin permission types for v0.1.9"
```

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-architecture-optimization.md`**

### 1. Subagent-Driven (推荐)
- 为每个任务启动独立的 subagent
- 任务间有检查点
- 适合长期复杂重构

### 2. Inline Execution
- 在当前会话中按任务顺序执行
- 批量执行带检查点
- 适合快速迭代

**选择哪种方式？**
