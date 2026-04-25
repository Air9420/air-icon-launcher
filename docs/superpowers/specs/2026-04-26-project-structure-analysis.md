# air-icon-launcher 项目结构分析报告

> 日期：2026-04-26
> 状态：已确认分析方向，待制定实施计划

---

## 一、项目概况

| 维度 | 信息 |
|------|------|
| **项目名称** | air-icon-launcher |
| **类型** | Windows 桌面启动器 |
| **框架** | Tauri 2.x (Rust 后端 + Vue 3 前端) |
| **当前版本** | v0.1.9 |
| **技术栈** | Vue 3 + TypeScript + Pinia + Vue Router + SCSS + Rust |

### 核心模块

| 模块 | 文件位置 | 规模 | 职责 |
|------|----------|------|------|
| launcherStore | `src/stores/launcherStore.ts` | 1773行 | 启动项管理、搜索索引、置顶/最近、启动依赖 |
| 插件系统 | `src/plugins/` | 完整 | 沙箱隔离、权限控制、API工厂 |
| 剪贴板 | `src/stores/clipboardStore.ts` + `src-tauri/src/clipboard/` | 完整 | 监控、历史、加密 |
| 搜索 | `src-tauri/src/search.rs` | 836行 | 拼音索引、模糊匹配、排序 |
| AI Organizer | `src/views/AIOrganizer.vue` | 独立 | AI分类整理 |

---

## 二、分析结论（按优先级）

### P0: 数据结构

#### ✅ 合理的设计

| 设计 | 说明 |
|------|------|
| `launcherItemsByCategoryId` | 按分类存储，数据locality好 |
| `launchDependencies` | 支持DAG依赖链，含循环检测 |
| `versioned-persist` | 有版本迁移机制，数据演化有保障 |
| `pinnedItemIds` / `recentUsedItems` | 全局唯一ID，跨分类去重设计合理 |

#### ⚠️ 潜在问题

| 问题 | 风险等级 | 说明 |
|------|----------|------|
| **Store体积过大** | **高** | `launcherStore` 1773行，单一Store承担过多职责 |
| **图标缓存分散** | 中 | `launcher-icon-cache.ts` 独立于Store，删除分类时需手动清理 |
| **clipboardStore图片引用** | 低 | 图片存路径，文件删除后历史图片失效 |

---

### P0.5: 性能模型

#### 搜索链路

```
用户输入
  ↓
useThrottleFn(300ms)
  ↓
ensureSearchIndexReady
  ↓
Rust IPC: search_apps
  ↓
mergeRustSearchResults (前端合并)
```

**性能隐患**：
- `syncSearchIndex()` 全量同步时有 `isFullSearchIndexSyncInFlight` 保护
- 增量 flush 逻辑复杂：250ms debounce + 失败回退全量
- 300项模糊搜索 benchmark: `<10000 µs/op`（有性能门限）

#### 首页渲染链

```typescript
// categories.vue 中的 computed 链
timeBasedTailCandidates → statsStore.timeBasedRecommendations → store.getLauncherItemById × N
recentDisplayItems → splitRecentDisplayItems → merge + sort
```

**⚠️ 潜在O(n²)**：如果每个分类有大量启动项，`getLauncherItemById` 线性查找可能导致性能问题。

#### 内存问题

| 数据 | 问题 |
|------|------|
| `clipboardHistory` | 简单数组，无分页，100条上限但全量加载 |
| `recentUsedItems` | 限制50条，有裁剪 |
| 搜索索引 | 全量存内存，300项约几百KB |

---

### P1: 状态管理

#### ⚠️ Store职责边界模糊

`launcherStore` 承担了太多职责：
- 启动项CRUD
- 搜索索引同步 (Rust IPC)
- 图标缓存管理
- 置顶/最近使用
- 启动依赖管理
- 数据导入/导出
- 搜索结果状态

#### ⚠️ 跨Store依赖复杂

```
launcherStore
├── 依赖 statsStore (recordLaunchEvent)
├── 依赖 categoryStore (getCategoryById)
└── 被 settingsStore, uiStore, clipboardStore 交叉依赖

App.vue onMounted 初始化链：
useTheme → useWindowDrag → useWindowPosition → useGlobalEvents → useTauriEvents
```

#### ✅ 做得好的是

- `useMenuActions` / `useContextMenu` 封装了菜单状态
- `useLaunchCooldown` 防止重复启动
- 弹窗统一使用 `useConfirmDialog` / `useInputDialog`

---

### P2: 演化能力

#### 插件系统（超前设计）

| 特性 | 状态 | 评估 |
|------|------|------|
| 插件扫描/安装/卸载 | ✅ 完整 | — |
| 沙箱隔离 | ✅ iframe | — |
| 权限系统 | ✅ 5种权限 | ⚠️ **过度设计风险** |
| API工厂 | ✅ 版本化API | — |
| 右键菜单扩展 | ✅ contextMenuRegistry | — |

**⚠️ 风险**：v0.1.9版本，插件系统完整但缺少实际插件验证，可能是"先做架构"的思维。

#### 配置迁移

- `storage-migrations.ts` 处理 localStorage → 新格式转换
- `versioned-persist` 有版本号 + upgrade 逻辑
- ⚠️ **双写问题**：`settingsStore` 同时写 pinia persist 和 Rust 后端 `saveAppConfigPatch`

---

### P3: UX / 性能

#### ✅ 好的体验

- 搜索匹配类型丰富：精确、前缀、拼音首字母、拼音全拼、模糊
- Ctrl+数字快捷启动
- 置顶/最近使用跨分类去重
- 启动冷却防抖（2500ms）
- 图标按需加载（hydrateMissingIconsForItems）

#### ⚠️ 可优化

- 搜索索引首次加载有延迟（syncSearchIndex）
- 首页多个 computed 嵌套，可能在低配置机器上卡顿
- 图标提取是批量但仍有 IO 阻塞

---

### Launcher专项检查

#### 1. 过度设计预警 ⚠️

| 功能 | 评分 | 说明 |
|------|------|------|
| 插件系统 | 6/10 | 架构完整，但功能验证不足 |
| 权限系统 | 7/10 | 5种权限，当前阶段可能不需要这么细 |
| AI Organizer | 5/10 | 依赖外部服务，可用性待验证 |

#### 2. 核心壁垒判断

**短期壁垒**：搜索体验（拼音+模糊+路径匹配）、启动依赖链

**长期壁垒**：如果 AI 分类做得好，可能成为差异化；但目前功能弱

#### 3. 数据沉淀价值 ⚠️

- ✅ 使用频率有追踪（usageCount）
- ✅ 搜索历史有记录（statsStore.searchHistory）
- ⚠️ 分类行为没有深度挖掘
- ⚠️ 时间段推荐是简单尝试

#### 4. 性能陷阱 ⚠️

| 位置 | 问题 |
|------|------|
| `launcher-icon-cache.ts` | 独立于Store，跨Store共享可能有bug |
| `syncSearchIndex` | 全量同步 + 失败回退，逻辑复杂 |
| `clipboardHistory` | 全量加载无分页 |
| `categories.vue` computed | 多个嵌套computed链 |

#### 5. 失败风险

| 风险 | 概率 | 说明 |
|------|------|------|
| 沦为"又一个启动器" | 中 | 差异化不够明显 |
| AI分类不可靠 | 高 | 依赖外部服务，用户期望可能落差 |
| 架构复杂维护难 | 中 | launcherStore太大，迭代成本高 |

---

## 三、决策建议

### ✅ 推荐方案

| 优先级 | 方案 | 预期收益 |
|--------|------|----------|
| **高** | 拆分 launcherStore | 降低单文件复杂度，提高可维护性 |
| **中** | 统一图标缓存 | 解决跨Store共享的潜在bug |
| **中** | 简化持久化策略 | 避免双写导致的迁移复杂度 |
| **低** | 控制插件权限复杂度 | YAGNI，聚焦核心场景 |

### ⚠️ 风险方案

| 方案 | 风险 |
|------|------|
| 配置双写 | settingsStore + Rust backend 双写增加迁移复杂度 |
| 首页computed链 | 建议添加虚拟滚动或懒加载，防止大分类列表卡顿 |

### ❌ 不建议

1. **继续往 launcherStore 加功能** — 当前已1773行，再加只会更难维护
2. **扩展插件权限类型** — 当前阶段YAGNI

---

## 四、改进计划（待实施）

### 任务列表

| ID | 任务 | 优先级 | 状态 |
|----|------|--------|------|
| 1 | 拆分 launcherStore 为 itemsStore、searchStore、pinningStore | high | pending |
| 2 | 统一图标缓存到 Store 层（iconCacheStore） | medium | pending |
| 3 | 简化持久化策略：明确前端/后端数据边界 | medium | pending |
| 4 | 优化 categories.vue 首页 computed 链 | medium | pending |
| 5 | 控制插件权限系统复杂度（当前阶段YAGNI） | low | pending |

---

## 五、附录

### A. 项目结构概览

```
air-icon-launcher/
├── src/                          # Vue 前端
│   ├── stores/                   # Pinia stores
│   │   ├── launcherStore.ts      # 1773行 - 职责过重
│   │   ├── categoryStore.ts
│   │   ├── settingsStore.ts      # 双写问题
│   │   ├── clipboardStore.ts
│   │   ├── statsStore.ts
│   │   └── uiStore.ts
│   ├── composables/              # 组合式函数
│   │   ├── useSearch.ts
│   │   ├── useMenuActions.ts
│   │   ├── useContextMenu.ts
│   │   └── ...
│   ├── plugins/                  # 插件系统
│   │   ├── manager.ts
│   │   ├── api-factory.ts
│   │   ├── permissions.ts
│   │   └── sandbox/
│   ├── components/               # Vue 组件
│   ├── views/                    # 页面视图
│   ├── utils/                    # 工具函数
│   └── menus/                    # 右键菜单
├── src-tauri/                    # Rust 后端
│   └── src/
│       ├── search.rs             # 836行 - 搜索索引
│       ├── clipboard/            # 剪贴板模块
│       ├── commands/             # Tauri 命令
│       └── ...
└── docs/                         # 文档
```

### B. 相关文件路径

| 文件 | 说明 |
|------|------|
| `src/stores/launcherStore.ts` | 主要优化对象 |
| `src/utils/launcher-icon-cache.ts` | 图标缓存 |
| `src/stores/settingsStore.ts` | 配置双写问题 |
| `src/views/categories.vue` | 首页computed链 |
| `src/plugins/permissions.ts` | 权限系统 |

---

*本报告由 AI 辅助分析生成，仅供参考。*
