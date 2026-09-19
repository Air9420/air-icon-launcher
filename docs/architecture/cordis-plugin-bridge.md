# Cordis ↔ Rust Plugin Host 桥接

> `ctx.pluginHost` 将前端插件页接到 `plugin_host_*` 命令。**iframe JS 插件系统已下线（IR）。**

## 角色

| 层 | 职责 |
|----|------|
| Rust Host | `src-tauri/src/plugin_host/**`，加载 cdylib、capability 门、命令与事件 |
| Cordis Service | `src/kernel/services/plugin-host-service.ts`，暴露 `ctx.pluginHost` |
| UI | `src/views/plugins.vue` + `src/views/plugins/RustPluginPanel.vue` |

业务代码 **禁止** `from 'cordis'`，**禁止** 直连 `@tauri-apps/api/core` 的 `invoke`；一律走 `ctx.pluginHost` / `ctx.ipc`（内部即 `src/utils/invoke-wrapper.ts`）。

## Service API

`new PluginHostService(ctx)` 在 `createKernel()` 中 **同步** 构造（与 `IpcService` 相同，不走异步 `ctx.plugin`）。

| 成员 | 说明 |
|------|------|
| `plugins` | `ref<PluginHostRuntimeInfo[]>`，与 Host 列表同步 |
| `loading` / `lastError` | 忙碌与最近 `AppError`（含 `capability_denied`） |
| `hostEvents` | `plugin_host_event` / `plugin_host_bus` 环形缓冲（50） |
| `scan` / `list` / `refresh` | 扫描 manifest v2；`refresh` = scan + list |
| `load` / `unload` | 加载/卸载 dll；成功后自动 `list` |
| `invoke(id, method, args)` | `plugin_host_invoke` |
| `setEnabled(id, enabled)` | 启停；禁用即卸载；成功后自动 `list` |
| `install(path)` / `uninstall(id)` | 安装目录 / 删除插件目录 |
| `getLog(id)` / `emitEvent(id, event)` | 环形日志 / 投递事件 |
| `formatError(error)` | `[code] message` 展示 |

事件监听通过 `ctx.effect` 注册，dispose 时取消。

## UI

- **Rust 能力插件**（唯一区）：绑定 `ctx.pluginHost`；卡片展示 id/name/version/runtime/capabilities/enabled/loaded；操作：启停、加载、卸载、日志、调用示例 `hello`、删除；安装由 **view 层** 调 `@tauri-apps/plugin-dialog` 选目录后传给 service。
- 文案：「扩展插件（Rust）」；页面注明旧 iframe 插件已下线。

插件目录：`plugins/`；仅识别 `manifest_version=2` 且 `runtime=rust`。配置/启用状态：`app_data/plugin-host/`。

## 菜单扩展点（保留）

- 注册表后端：`src/menus/contextMenuRegistry.ts`（单列表 Map）
- Cordis facade：`ctx.menus`（`MenuContributionService`）
- 旧 iframe 插件 API / `src/plugins/*` 运行时 **已删除**；勿再引用

## DTO

共享类型：`src/types/plugin-host.ts`（`PluginHostManifest` / `PluginHostRuntimeInfo` / `PluginHostEventPayload`）。

## 预留

- **Worker JS 运行时**：仅文档预留，未实现。

## 集成注意

- 通过 `useCordis().pluginHost` 使用；类型在 `src/kernel/types.ts` / `src/kernel/index.ts`。
- 不要在 store 里 `from 'cordis'`。
- 启停/安装/卸载后依赖 service 内部 `list` 同步，或再调 `refresh()`；UI 绑定 `plugins` ref。
- capability 错误展示 `AppError.code` + `message`（`formatError`），勿吞掉 `details`。
- dialog 依赖只允许出现在 view 层，service 只接受路径字符串。
