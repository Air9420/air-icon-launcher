# Cordis 领域服务：settings / theme / apps / search / menus（P4–P6）

> Packet P4 · settings / theme Cordis Service，store 单向迁移为适配层。
> Packet P5 · launcher / search 领域服务化 + **条目状态单源**。
> Packet P6 · 右键菜单动作 DI + **菜单贡献扩展点** `ctx.menus` + IPC 破窗收敛。

## 角色

| 层 | 职责 |
|----|------|
| `SettingsService` | `src/kernel/services/settings-service.ts`，`ctx.settings`：经 `ctx.ipc` 读写 `get_config` / `patch_config` / `save_config` |
| `ThemeService` | `src/kernel/services/theme-service.ts`，`ctx.theme`：主题模式 + performanceMode/effects 运行时状态 + DOM 应用 |
| `AppsService` | `src/kernel/services/apps-service.ts`，`ctx.apps`：启动器条目/分类/固定/最近使用/启动动作领域真相 + `get_launcher_data`/`save_launcher_data` 统一写入口 |
| `SearchService` | `src/kernel/services/search-service.ts`，`ctx.search`：搜索查询与 Rust 索引同步（依赖 `ctx.apps`）；`search_apps` / `update_search_items*` |
| `MenuContributionService` | `src/kernel/services/menu-service.ts`，`ctx.menus`：菜单贡献扩展点；typed facade over `contextMenuRegistry`（**单列表**） |
| `settingsStore` | Pinia **适配层**：外部 API 不变；内部委托 Service 或回退 `config-sync` |
| `launcherStore` | Pinia **读适配 + 兼容 API**：与 `AppsService`/`SearchService` **共享 ref**；`syncSearchIndex`/`rustSearch` 委托 SearchService |
| `itemsStore` | Pinia **委托适配**：不共享 ref（避免 persist 冲突）；核心 CRUD/读优先委托 `AppsService`；IPC 走 invoke-wrapper / `ctx.ipc`（P6） |
| `categoryStore` | 与 `AppsService.categories` **共享 ref** |
| `searchStore` | 事件监听适配：`startListening`/`syncFullIndex` 委托 `SearchService` |
| `menuAppsGateway` | `src/menus/menuAppsGateway.ts`：菜单领域写网关 → `ctx.apps`（kernel 缺席回退 store） |
| boot-theme | 首屏同步 DOM（无 FOUC）；插件 `apply` 消费 `ctx.theme.seedFromLocal` |
| Appearance.vue | 主题写入走 `ctx.theme.setMode`（内部 `ctx.settings.patch`） |
| categories.vue | 搜索结果启动走 `useCordis().apps.launch`（P5） |
| useMenuActions | 菜单动作分发（P6）：launch/pin/delete/icon/usage 经 `menuAppsGateway` |

业务代码 **禁止** `from 'cordis'`，**禁止** 直连 `@tauri-apps/api/core` invoke；一律 `ctx.ipc` / `ctx.settings` / `ctx.theme` / `ctx.apps` / `ctx.search` / `ctx.menus` / invoke-wrapper。

## Bootstrap

`createKernel()` **同步**构造（不走异步 `ctx.plugin` 做启动关键服务）：

```
applyBootTheme()                 // 必须最先：localStorage → data-theme / data-effects-disabled
new IpcService(ctx)
new SettingsService(ctx)         // ctx.settings
new ThemeService(ctx)            // ctx.theme
new AppsService(ctx)             // ctx.apps   — 条目领域真相
new SearchService(ctx)           // ctx.search — inject/依赖 apps
new MenuContributionService(ctx) // ctx.menus  — 菜单贡献 facade（P6）
new PluginHostService(ctx)
ctx.plugin(bootThemePlugin)
window.__AIR_CTX__ = ctx
```

## Service API

### SettingsService（`ctx.settings`）

| 成员 | 说明 |
|------|------|
| `config` | `Ref<AppConfigSnapshot \| null>` |
| `loading` / `lastError` / `hydrated` | 忙碌 / 最近错误 / 是否已 hydrate |
| `hydrate()` | `get_config` → 更新 `config` |
| `patch(partial)` | `patch_config` → 成功时合并返回快照 |
| `save(config)` | `save_config` 全量写 |
| `applyLocal(config)` | 无 IPC 合并（store hydrate 后对齐） |
| `formatError(error)` | `[code] message` |

### ThemeService（`ctx.theme`）

| 成员 | 说明 |
|------|------|
| `mode` | `Ref<ThemeMode>`（light/dark/system/transparent） |
| `performanceMode` / `windowEffectsEnabled` / `windowEffectType` | 特效相关运行时状态（与 store 共享 ref） |
| `knowsEffects` | 是否应写入 `data-effects-disabled` |
| `applyDom()` | 同步 `data-theme` / `data-effects-disabled` |
| `seedFromLocal(mode, perf?)` | boot 插件：localStorage 种子 + DOM |
| `syncFromConfig(config)` | backend hydrate 对齐 + DOM |
| `setMode(mode)` | 乐观更新 + DOM + `ctx.settings.patch({ theme })` |
| `setPerformanceModeLocal(enabled)` | 轻量性能模式（完整兼容矩阵仍在 store） |

### AppsService（`ctx.apps`）— P5 / A-Ops

| 成员 | 说明 |
|------|------|
| `itemsByCategoryId` / `items` | 条目真相 `Ref` / computed 别名 |
| `categories` | 分类真相 `Ref`（与 categoryStore 共享） |
| `pinnedItemIds` / `recentUsedItems` | 固定 / 最近使用 |
| `getItems` / `getItemById` / `findItemAnywhere` | 读 |
| `upsertItem` / `updateItem` / `updateItems` / `removeItem(s)` / `moveItems` | 写入口 → **domain ops\*** + `itemEventBus` |
| `addFileItems` / `addFileItemsBatched` / `addUrlItem` / `createItemInCategory` | 添加条目（含 lnk queue / icon cache） |
| `setItemIcon` / `updateItemIcon` / `resetItemIcon` / `setItemResolvedPath` / `applyDropIcons` | 图标与 resolvedPath |
| `queueResolveLnkTargets` / `hydrateIconsForVisibleItems` | lnk 解析队列 / 可见图标水合 |
| `importItems` / `importSnapshot` / `addScannedApp` | 导入 / 扫描安装 |
| `deleteCategoryCleanup` | 删除分类清理（deps/pinned/recent + events） |
| `togglePin` / `recordUsage` / `isPinned` | 固定与使用记录 |
| `load()` | `get_launcher_data` → `applyPersisted` |
| `readBackend()` | `get_launcher_data` 只读（导出快照，不改 ref） |
| `save()` / `savePersisted(data)` | `save_launcher_data` 统一写入口 |
| `launch(ref)` / `launchById(id)` | 启动（executor + system opener），内部 `recordUsage` |
| `searchLocal(q)` | 可选本地 name/path 匹配（非 Rust 索引） |

#### A-Ops：共享领域实现（消除双路径）

| 文件 | 职责 |
|------|------|
| `src/kernel/domain/apps-item-ops.ts` | **唯一** CRUD/图标/lnk/import 领域函数（`ops*`）；状态袋 API，**无 pinia / 无 Service** |
| `AppsService` | 构造 `AppsItemOpsState`（自身 refs + `itemEventBus.emit`）→ 调 `ops*`；**不 import pinia store** |
| `src/stores/launcher/items-ops.ts` | **薄适配**：store refs/helpers → 同一 `ops*`；无 kernel 单测路径 |
| `launcherStore` | kernel 在场：ops 袋转发 `ctx.apps.*`；无 kernel：`bindItemsOps` → `ops*` |

**stats/scenario 策略**：

- kernel 在场：AppsService **只 emit** `item:*`；`stats-event-sync` 观察总线清理 stats/scenario。
- 无 kernel（单测）：`ops*` 经 state 的 `stats` / `removeItemFromAllScenarios` sink 直接清理。

**约束**：Service 禁止 import pinia store；业务禁止 `from 'cordis'`；IPC 只走 invoke-wrapper / `ctx.ipc`；pinia persist 字段与 launcherStore 对外 API 不变。

领域事件：AppsService 通过 **`itemEventBus`** 发出（`item:created/updated/deleted/moved/iconUpdated/pinningToggled/usageRecorded`）。stats / search 只消费事件，**禁止**直接写 apps。

### SearchService（`ctx.search`）— P5

| 成员 | 说明 |
|------|------|
| `query` / `results` | 查询词 / Rust 结果（与 launcherStore 共享 results ref） |
| `isReady` / `isSearching` / `lastError` | 索引就绪 / 忙碌 / 错误 |
| `syncIndex()` / `syncFullIndex()` | 从 `ctx.apps` 收集全量 → `update_search_items` |
| `search(keyword, limit?)` | `search_apps`（超时保护）→ 更新 `results` |
| `clear()` | 清空 query/results |
| `startEventSync()` / `stopEventSync()` | `itemEventBus` → 增量 `update_search_items_incremental` |
| `enqueueChanges(...)` | 适配层手动入队 |

### MenuContributionService（`ctx.menus`）— P6

| 成员 | 说明 |
|------|------|
| `register(sourceId, menuType, items): Disposer` | 注册贡献项；返回仅撤销该 (source, menuType) 的 disposer |
| `registerWithEffect(sourceId, menuType, items): Disposer` | 同上 + `ctx.effect` 绑定 fiber 清理（宿主/kernel 插件首选） |
| `unregister(sourceId, menuType?)` | 撤销单类型或该 source 全部 |
| `clearBySource(sourceId)` | 卸载/报错回收 |
| `getContributions(menuType)` | 读取单列表贡献（与渲染同一 backend） |

**Backend 单一**：`ctx.menus.*` 内部调用 `src/menus/contextMenuRegistry.ts` 的 register/unregister/get。**iframe 插件系统已下线（IR）**——旧 `src/plugins/*` 运行时已删除；扩展贡献只经 `ctx.menus` / host。`buildContextMenuModel` 只读 `getContextMenuContributions`，**无第二列表、无渲染层去重冲突**。

#### 贡献合并 / 排序规则（文档化）

1. 内置项 order 带 `0–999`（见 `src/menus/contextMenu.ts`）。
2. 贡献项（registry / `ctx.menus`）转换渲染模型时 **order += 1000**（`contributionToMenuItem`）。
3. 同层排序：`order` 升序 → `id` 字典序稳定排序。
4. 之后应用 `before` / `after` 锚点（循环保护）。
5. `cleanupSeparators`：去掉开头/结尾/连续 separator；空 group 不渲染。
6. 同一 `sourceId + menuType` 再次 register **整体替换**该 source 在该类型的列表（非 append）。
7. 不同 source 的 id 冲突：渲染 id 形如 `plugin:{pluginId}:{id}`，各自独立；业务 action 仍按贡献声明分发。

#### 推荐用法（宿主 / P7 kernel 插件）

```ts
// kernel plugin（勿 import cordis 于业务层；插件文件允许）
ctx.effect(() =>
  ctx.menus.register("host:boot", enumContextMenuType.IconView, [
    { type: "item", id: "host-do-x", label: "宿主动作", commandId: "host:do-x", order: 10 },
  ]),
);
// 或
ctx.menus.registerWithEffect("host:boot", menuType, items);
```

扩展贡献路径（唯一）：

```ts
ctx.menus.register(sourceId, menuType, items);
// 或直接（不推荐业务层）：
registerContextMenuItems(sourceId, menuType, items); // src/menus/contextMenuRegistry.ts
```

#### 动作分发（DI）

- 默认：`contextMenu.vue` emit → `useMenuActions.onMenuAction` → **`menuAppsGateway`** → `ctx.apps.*`（kernel 在场）或 launcherStore 回退。
- `MenuContext` 契约保持向后兼容（`src/menus/contextMenuTypes.ts`）。
- `src/menus/actionRegistry.ts` 预留 `registerActionHandler(kind, handler)`，供 P7 kernel 插件注入自定义动作；handler 禁止直写 store 内部 map。

## 菜单调用点改动表（P6）

| 菜单动作 | P6 路径 | 说明 |
|----------|---------|------|
| toggle-pinned / toggle-favorite | `menuTogglePin` → `ctx.apps.togglePin` | kernel 缺席回退 `store.togglePinned` |
| delete-item | `menuRemoveItem` → `ctx.apps.removeItem` + **residual** stats/scenario | 见事件桥 |
| delete-category | `categoryStore.deleteCategory` + `menuDeleteCategoryItems` → `ctx.apps.deleteCategoryCleanup` + residual | 分类列表仍在 categoryStore（共享 categories ref） |
| add-item（文件） | `menuAddFileItems` → `store.addLauncherItemsToCategory` | lnk resolve / icon cache 未下沉 AppsService；写入共享 ref = apps 真相 |
| add-url | `menuAddUrlItem` → `ctx.apps.upsertItem` | favicon 经 `menuUpdateItemIcon` |
| change-icon | `menuSetItemIcon` → `ctx.apps.updateItem(hasCustomIcon:true)` | |
| update favicon icon | `menuUpdateItemIcon` → `ctx.apps.updateItem(hasCustomIcon:false)` | |
| reset-icon | `menuResetItemIcon` → `store.resetLauncherItemIcon` | 图标缓存 + hydrate 仍在 store 组合路径 |
| convert-external | `menuGetItems` + `menuAddFileItems` + `menuRecordUsage` | usage：`ctx.apps.recordUsage` + stats residual |
| clipboard / explorer / hide-window IPC | `menuInvoke` → `ctx.ipc` / invoke-wrapper | 禁止 `@tauri-apps/api/core` |
| scenario membership | 仍 `store.toggleScenarioItem` 等 | 场景状态不在 AppsService（P5 未开槽） |

**不变量**：菜单不直接改 `itemsByCategoryId` 等内部 map；可见项与点击行为（内置 + `ctx.menus` 贡献）不回归。

## 单源策略（P5，稳健）

### 决策

| 领域真相 | 写入口 | 过渡期读适配 |
|----------|--------|--------------|
| 条目 CRUD / 启动 / save / load | **`AppsService`（`ctx.apps`）** | `launcherStore`（共享 ref + 兼容 API）、`itemsStore`（委托）、views 仍可调 store 方法；**菜单经 menuAppsGateway** |
| 分类列表 | **`AppsService.categories`**（与 categoryStore 共享 ref） | categoryStore 编辑态仍本地 |
| 搜索查询 / 索引 | **`SearchService`（`ctx.search`）** | `launcherStore.rustSearch/syncSearchIndex`、`searchStore`、`useSearch` 委托 |
| 菜单贡献项 | **`contextMap` 单列表**（`src/menus/contextMenuRegistry.ts`；Cordis 经 `ctx.menus` facade） | iframe 插件 API 已删除（IR） |

**不删除** pinia store，**不删** pinia-plugin-persistedstate。launcher persist key 仍是 localStorage 上条目的规范路径；共享 ref 后 persist 写入即 AppsService 真相。

### 为什么 itemsStore 不共享 ref

`launcherStore` 与 `itemsStore` 各自有 persist 配置。若二者共享同一 `itemsByCategoryId` ref，pinia 恢复顺序不确定会互相覆盖。因此：

- **launcherStore + categoryStore**：与 AppsService **共享 ref**（主 persist 路径）。
- **itemsStore**：保留本地 ref 作 fallback；**读**优先 AppsService；**写**（create/update/delete/move/import/favorite/usage）在 kernel 在场时 **委托** `ctx.apps`。

### 消除双写路径

save / load / launch 统一经 AppsService：

- `useDataManagement` 的 `get_launcher_data` / `save_launcher_data` → `apps.readBackend()` / `apps.savePersisted()`（invoke-wrapper fallback）。
- 搜索结果启动（categories.vue）→ `cordis.apps.launch`。
- `launchStoredItem` 支持 `getItem` / `onRecordUsage` 回调，AppsService 不 import pinia。
- **菜单 pin/delete/usage（P6）** → `menuAppsGateway` → `ctx.apps`。

新增业务路径应走 service；旧 store API 在 kernel 在场时转发到 service，行为保持。

### 事件桥（stats）— **唯一桥接策略（P6 文档化）**

| 总线 | 角色 |
|------|------|
| **`itemEventBus`** | **条目领域事件的唯一总线**。AppsService 写后 emit；search / iconCache 等只 **on**。 |
| Cordis `ctx.emit` / `ctx.on` | **P6 仍不用于条目领域事件**（避免与 itemEventBus 双订阅双记）。 |

**桥接规则（若未来引入 `ctx.emit`）**：

1. **唯一桥接点**必须落在 `AppsService`（或单一 `itemEventBridge` kernel 插件）内：在 `itemEventBus.emit(...)` 同处旁路 `ctx.emit('apps:item-changed', event)`。
2. 消费者 **只订阅一套**（优先 itemEventBus）；禁止 stats 同时 on 两边。
3. **P6 residual hooks**（尚未事件化，菜单 gateway 显式调用一次，不算第二总线）：
   - `stats.removeLaunchEventsForItems/Category`（delete）
   - `stats.ensureLaunchTrackingStarted` + `stats.recordLaunchEvent`（usage）
   - `store.removeItemFromAllScenarios`（delete）
4. 后续包应把 residual 改为 statsStore **on** `item:deleted` / `item:usageRecorded`，然后删除 gateway 内 residual，**不要**再复制 launcher 业务。

## FOUC 不变量

1. `applyBootTheme()` 在任何 Service 构造 **之前** 同步执行，只读 localStorage（`__versioned_settings__` / legacy `settings`）。
2. ThemeService 构造函数只 **seed refs**，不阻塞首屏。
3. boot-theme 插件在 Service 注册后 `seedFromLocal` 并再 `applyDom`（幂等）。
4. backend `get_config` 水合发生在 App `onMounted`，可能覆盖 localStorage 主题——与现网一致。

## Store 适配策略（避免循环 import）

- **Service 不 import store**。
- **store / menus gateway 通过 `window.__AIR_CTX__`**（`getKernelContext()`）取 service（仅 `import type` kernel 类型）。
- **共享 ref**：launcherStore setup 时 `appsService?.itemsByCategoryId ?? ref(...)` 等；`storeToRefs(launcherStore).pinnedItemIds` 与 `ctx.apps.pinnedItemIds` 是同一 ref。
- **写路径**：主题 → `ThemeService.setMode`；条目/启动/后端 launcher_data → `AppsService`；搜索 → `SearchService`；菜单贡献 → `contextMenuRegistry`（`ctx.menus` facade）。
- **pinia-plugin-persistedstate 保留**：boot 仍可读 versioned localStorage；不删除。
- **kernel → utils**：AppsService 可调 `launcher-service` / `launcher-executor`（它们不 import kernel）。

## 已改视图 / composables

- `src/views/settings/Appearance.vue`：`useCordis()`；主题按钮 → `ctx.theme.setMode`。
- `src/views/categories.vue`（P5）：`useCordis()`；搜索结果打开 → `ctx.apps.launch`（fallback `launchStoredItem` + store）。
- `src/composables/useSearch.ts`（P5）：经 launcherStore 委托 SearchService；暴露 `getSearchService()`。
- `src/composables/useDataManagement.ts`（P5）：launcher_data 读/写优先 AppsService。
- `src/services/iconCache.ts`（P5）：初始化遍历 `itemsStore.getAllItems()`（AppsService-aware）。
- `src/composables/useMenuActions.ts`（P6）：动作经 `menuAppsGateway` + `menuInvoke`（ctx.ipc）。
- `src/menus/menuAppsGateway.ts`（P6）：菜单领域写网关。
- `src/stores/itemsStore.ts`（P6）：icon hydrate IPC → `itemsInvoke`（ctx.ipc / invoke-wrapper）。

## P7 注意（App.vue 瘦身 / 菜单初始化）

1. **菜单初始化勿再 App.vue 硬编码**：用 kernel 插件 `ctx.menus.registerWithEffect(...)` 注册宿主菜单；`buildContextMenuModel` 已读统一 registry。
2. **动作注入**：kernel 插件可 `registerActionHandler`；或让 `useMenuActions` dispatch 前查询 actionRegistry（改动需保持 MenuContext 兼容）。
3. **勿双列表**：新贡献只走 `ctx.menus` 或旧 registry，不要第三份 Map。
4. **residual → 事件化**：stats / scenario 清理迁到 itemEventBus 订阅后，删除 menuAppsGateway residual 调用。
5. **add 路径下沉**：把 lnk resolve / icon cache 并入 AppsService（或 launcher-service）后，`menuAddFileItems` 可改为纯 `ctx.apps.upsertItem` 循环。
6. **CategoryService**：分类编辑态仍在 categoryStore；`categories` ref 已在 AppsService。
7. **Worker JS 运行时** 仍 out of scope；**iframe 插件系统已下线（IR）**。
8. kernel-type-assertions：`menus` slot 已声明；新 service 类从 service 文件导出，`types.ts` 只 `import type` + `declare module`，**不要**在 `index.ts` 同时 re-export type 与 class（TS2300）。
9. **IPC 纪律**：store / menus 一律 invoke-wrapper / `ctx.ipc`；itemsStore 历史 `@tauri-apps/api/core` 已在 P6 收敛。
10. App.vue `useTheme` 在共享 ref 下仍正确；**全量瘦身不在 P6 必做项**。

## 类型导出约定

```ts
// service 文件
export class AppsService extends Service { ... }
export class SearchService extends Service { ... }
export class SettingsService extends Service { ... }
export class ThemeService extends Service { ... }
export class MenuContributionService extends Service { ... }

// index.ts — 只从 service 文件导出类
export { AppsService } from "./services/apps-service";
export { SearchService } from "./services/search-service";
export { MenuContributionService } from "./services/menu-service";

// types.ts — import type + declare module，不 export class
import type { AppsService } from "./services/apps-service";
import type { SearchService } from "./services/search-service";
import type { MenuContributionService } from "./services/menu-service";
declare module "cordis" {
  interface Context {
    apps?: AppsService;
    search?: SearchService;
    menus?: MenuContributionService;
    stats?: StatsService;
    // ...
  }
}
```

## Store 大瘦身（S-Slim）

> 目标：Pinia store 变薄适配层；领域写路径与重复业务逻辑下沉 Cordis Service。
> 约束：对外 API 名不变；`Store = useLauncherStore` 别名保留；launcher persist 共享 apps ref；items 不共享 persist。

### 行数对照（before = 本包开工时文件行数）

| Store | before | after | Service 承接 |
|-------|--------|-------|--------------|
| launcherStore | 1377 | ~1293 | CRUD 委托 `ctx.apps`；场景/UI/搜索/import 留 store；无 kernel 测试路径保留 fallback（含依赖清理） |
| itemsStore | 1027 | ~406 | 全部 CRUD/图标写路径委托 `ctx.apps`；本地 fallback 移除 |
| settingsStore | 710 | ~510 | setXxx → `SettingsService.applyTo`；窗口特效矩阵 → `ThemeService` |
| statsStore | 1164 | ~522 | 纯函数 → `stats-helpers.ts`；真相 → `StatsService`（`ctx.stats`）；store 共享 refs 或 fallback |
| searchStore | 220 | ~28 | 全部委托 `SearchService`；fallback no-op |
| categoryStore | 160 | ~141 | 已共享 `ctx.apps.categories` |

### 新增 / 扩展

| 文件 | 说明 |
|------|------|
| `src/kernel/services/stats-service.ts` | `ctx.stats`：refs + record/sanitize/remap/smart-sort；lookup 经 `ctx.apps`，不 import store |
| `src/stores/stats-helpers.ts` | 纯函数（normalize/prune/score/computeAppUsageStats…），store 与 StatsService 共用 |
| `SettingsService.applyTo` | 统一写路径：runtime IPC → patch_config → 赋本地 ref |
| `ThemeService` 窗口特效矩阵 | `setPerformanceMode` / `setWindowEffectType` / `applyCurrentWindowEffectState` 从 settingsStore 迁入 |
| `stats-event-sync` | 新增 `item:moved` → `stats.remapLaunchEventCategoryRefs`（委托 apps 后单点观察，避免双记） |

### 双记防护

- **kernel 在场**：launcherStore CRUD 委托 `ctx.apps`；stats/scenario 清理由 `stats-event-sync` 经 `itemEventBus` 单点观察。
- **无 kernel（单测）**：store fallback 自行清理 pinned/recent/deps/stats/scenario，launcherStore 测试语义不变。

### 对外 API 保留

- `useLauncherStore` / `Store`：全部原字段与方法名保留。
- `useSettingsStore`：全部 setXxx / applyPersistedConfig / 窗口特效 API 保留。
- `useStatsStore`：refs + recordSearch / recordLaunchEvent / totalLaunches* / getSmartSortOrder 等保留。
- `useSearchStore`：`syncFullIndex` / `startListening` / `stopListening` 保留。
- `useItemsStore`：API 名保留；无 kernel 时写操作 no-op。
- 类型导出：`LauncherItem` / `SearchKeywordRecord` 等仍可从 `stores` 引入。
