# Cordis App Boot（P7）

> Packet P7 · App.vue 瘦身：onMounted 副作用迁入 kernel 插件。

## 启动顺序

```
main.ts
  createKernel()
    applyBootTheme()                 // FOUC：localStorage → data-theme / data-effects-disabled
    new IpcService(ctx)              // ctx.ipc
    new SettingsService(ctx)         // ctx.settings
    new ThemeService(ctx)            // ctx.theme
    new AppsService(ctx)             // ctx.apps
    new SearchService(ctx)           // ctx.search
    new MenuContributionService(ctx) // ctx.menus
    new PluginHostService(ctx)       // ctx.pluginHost
    ctx.plugin(bootThemePlugin)      // seed ThemeService from local + applyDom
    ctx.plugin(hydrateSettingsPlugin)
    ctx.plugin(clipboardRuntimePlugin)
    // IR: legacy-plugin-sync removed (iframe plugins offline)
    ctx.plugin(tauriBridgePlugin)
    ctx.plugin(updaterPlugin)
    ctx.plugin(searchRuntimePlugin)
    ctx.plugin(windowEffectsBootPlugin)
    ctx.plugin(themeRuntimePlugin)
    ctx.plugin(uiShellRuntimePlugin)
    window.__AIR_CTX__ = ctx
  createPinia() / app.use(Router) / app.use(pinia) / app.mount()
  // — sync 结束 —
  // cordis plugin apply 在 microtask 中执行（Fiber._reload await Promise.resolve()）
  // 此时 pinia + router 已就绪，插件内可安全 useXxxStore() / import router
```

## 副作用 → 插件对照表

| 原 App.vue onMounted 副作用 | 目标插件 | IPC / 实现 |
|---|---|---|
| `setPageUnloading(false/true)` | `ui-shell-runtime` | invoke-wrapper |
| `initOverrideLookupFromStore()` | `hydrate-settings` | classification pipeline |
| `statsStore.sanitizeExternalRecentLaunchHistory()` | `hydrate-settings` | pinia |
| `settingsStore.hydratePersistedConfig()` | `hydrate-settings` | `ctx.settings.hydrate`（store 适配） |
| `settingsStore.refreshAutostartStatus()` | `hydrate-settings` | invoke-wrapper via store |
| clipboard `preloadHistory` | `clipboard-runtime` | store → IPC |
| ClipboardHistory.vue 预加载 | `clipboard-runtime` | dynamic import |
| 全局剪贴板监听 | `clipboard-runtime` | **`ctx.ipc.on`**（不再 `@tauri-apps/api/event`） |
| window effects boot mark + apply | `window-effects-boot` | settings store + toast |
| theme apply / effects / system watch | `theme-runtime` + ThemeService | DOM + `matchMedia` |
| Tauri 全局事件（tray/hotkey/icc/process…） | `tauri-bridge` | **`ctx.ipc.on`** + router + stores |
| `setupUpdateCheck` / progress/log/complete | `updater` | **`ctx.ipc.invoke/on`**（消除 App 双注册 progress） |
| `searchStore.startListening` / `syncSearchIndex` | `search-runtime` | `ctx.search.startEventSync` + `syncIndex` |
| 全局 DOM 事件（防刷新/右键/Esc/blur/Ctrl+右键隐藏） | `ui-shell-runtime` | window listeners + uiStore.closeContextMenu |
| 拖放 drag-drop / drag-drop-icons | `ui-shell-runtime` | **`ctx.ipc.on`** + 共享 dragDrop state |
| `initializeWindowDrag` | `ui-shell-runtime` | mousedown + settings.ctrlDragEnabled |
| `initializePositionTracking` / save on unmount | `ui-shell-runtime` | useWindowPosition |
| auto-hide focus listener + `window-shown` | `ui-shell-runtime` | `win.onFocusChanged` + `ctx.ipc.on` |
| guide onboarding 路由 | `ui-shell-runtime` | router + guideStore + settings |
| `check_is_autostart_launch` + `show_launcher` | `ui-shell-runtime` | **`ctx.ipc.invoke`** + restoreWindowPosition |
| `window.__appIsTransitioning` | `ui-shell-runtime` / `ui-shell-state` | 共享 ref，App.vue 绑定 opacity |

## 协调：`ensureSettingsBoot()`

`src/kernel/plugins/boot-coordination.ts` 模块级单例 Promise：

1. override lookup
2. stats sanitize
3. `hydratePersistedConfig`
4. `refreshAutostartStatus`

`window-effects-boot` / `theme-runtime` / `ui-shell-runtime`（guide + show_launcher）均 `await ensureSettingsBoot()`，避免并行重复 hydrate。

## App.vue 保留内容

- 模板：router-view、ContextMenu、Confirm/Input Dialog、GlobalToast、CountdownRing、OnboardingGuide、FocusIndicator、UpdateDialog
- 组合式（组件/UI 绑定）：`useContextMenu`、`useMenuActions`、`useConfirmDialog`、`useInputDialog`
- 状态适配：`useDragDrop`（仅返回共享 lastDrop/processedIds，初始化在插件）
- 状态适配：`useAutoHideCountdown`（共享 isCountingDown + handleCountdownComplete；focus 监听在插件）
- 计算属性：isCurrentItemPinned / hasCustomIcon 等菜单绑定
- **不再** import `@tauri-apps/api/core` / `@tauri-apps/api/event`
- **不再** 在 onMounted/onBeforeUnmount 做初始化/清理副作用

## 共享运行时状态

`src/kernel/runtime/ui-shell-state.ts`：

| 导出 | 用途 |
|---|---|
| `appIsTransitioning` | App.vue `opacity`；插件写入；并镜像 `window.__appIsTransitioning` |
| `autoHideIsCountingDown` | CountdownRing 显示 |
| `dragDropLastDrop` / `dragDropProcessedIds` | useMenuActions 上下文 |

## 为迁移做的 composables 最小改动

| 文件 | 改动 |
|---|---|
| `src/composables/useDragDrop.ts` | 状态改为 kernel `ui-shell-state` 共享；init/cleanup 变 no-op（插件负责） |
| `src/composables/useAutoHideCountdown.ts` | `isCountingDown` 共享；setup/cleanupFocusListener 变 no-op |
| `src/kernel/plugins/drop-target.ts` | 抽出 `getDropTargetInfoAtPoint`（DOM 纯函数） |
| `src/kernel/plugins/event-types.ts` | `KernelEventRegistrar` 适配 `ctx.ipc.on` |
| `src/kernel/plugins/tauri-bridge.ts` | 导出 `registerTauriBridgeEvents(on)` 供插件/测试 |
| `src/utils/updater.ts` | 仍保留 API；App.vue 不再调用（kernel updater 插件用 ctx.ipc 实现） |
| `src/composables/useClipboardEvents.ts` | 仍保留；App.vue 不再调用（clipboard-runtime 用 ctx.ipc） |
| `src/composables/useTauriEvents.ts` / `useGlobalEvents.ts` / `useWindowDrag.ts` / `useTheme.ts` | 仍保留供兼容；App.vue 不再调用 |

## 不变量

- FOUC：`applyBootTheme()` 仍在 `createKernel()` 最前
- 业务代码禁止 `from 'cordis'`；禁止直连 `@tauri-apps/api/core` invoke（App.vue 已清零）
- 插件 `apply` 返回 disposer，fiber dispose 时清理监听
- 行为等价：主题、设置、剪贴板、搜索、更新、插件列表、拖放/快捷键/自动隐藏/首窗 show

## P8 / IR 后

- 破窗收敛残留（views 内仍直连 invoke 的文件）
- 文档/示例完善
- ~~可选：旧 iframe 插件系统标记废弃~~ **已完成（IR）**：iframe 运行时、旧 Rust 命令、旧 UI 已删除；保留 `ctx.menus` 注册表（`src/menus/contextMenuRegistry.ts`）与 Rust Plugin Host
