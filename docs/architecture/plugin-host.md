# Rust Plugin Host 架构说明

> Packet P2 · **iframe JS 插件系统已下线（IR）**；Rust Host 是唯一用户插件运行时。

## 目标

原有 `plugins.rs` + iframe JS 插件沙箱限制过多，已删除。当前系统采用：

- **Rust 能力插件**（Windows `cdylib` / `.dll`）
- **capability 门强制**（未声明能力无法调用宿主敏感 API）
- **稳定 C ABI v1** + `libloading` 动态加载
- 命令前缀 **`plugin_host_`**，供前端 Cordis 调用
- 配置残留 `plugin_sandbox_enabled` **已删除**；旧 JSON/备份中的该 key 由 serde 忽略，`get_config` 不再写出

## 目录

| 项目 | 说明 |
|------|------|
| 宿主 | `src-tauri/src/plugin_host/**` |
| 插件目录 | `plugins/`（开发：仓库根；生产：`%APPDATA%/air-icon-launcher/plugins`） |
| 状态 | Tauri `State<PluginHostState>`；enabled 持久化于 `app_data_dir/plugin-host/enabled.json` |

旧 iframe 命令（`scan_plugins` / `install_plugin` / `launch_item` 等）与 `src-tauri/src/plugins.rs` **已删除**；`src/plugins/` 前端运行时已删除。菜单贡献注册表迁至 `src/menus/contextMenuRegistry.ts`（`ctx.menus` facade 仍在）。

## 模块划分

```
plugin_host/
  mod.rs        导出、plugin_base_directory、install 校验
  manifest.rs   manifest v2 + entry 路径逃逸校验
  capability.rs capability 解析与 enforce
  abi.rs        AirHostVTable / 符号号 / InvokeEnvelope
  loader.rs     libloading 加载、host_invoke 分发
  registry.rs   HashMap 注册表、环形日志、PluginHostState
  commands.rs   plugin_host_* Tauri 命令
```

## ABI v1（跨 DLL）

插件导出：

| 符号 | 签名 | 说明 |
|------|------|------|
| `air_plugin_abi_version` | `() -> u32` | 必须返回 `1` |
| `air_plugin_manifest` | `() -> *mut c_char` | JSON，宿主用 `air_plugin_free_string` 释放 |
| `air_plugin_init` | `(host, user_data) -> i32` | `0=ok` |
| `air_plugin_invoke` | `(method, args_json) -> *mut c_char` | `{"ok":true,"data":...}` 或 `{"ok":false,"error":...}` |
| `air_plugin_on_event` | `(event_json)` | 可选 |
| `air_plugin_free_string` | `(*mut c_char)` | 释放插件分配的字符串 |
| `air_plugin_shutdown` | `()` | 卸载前调用 |

宿主 `AirHostVTable`：

```rust
#[repr(C)]
pub struct AirHostVTable {
    pub abi_version: u32,
    pub user_data: *mut c_void,
    pub log: extern "C" fn(*mut c_void, level: i32, msg: *const c_char),
    pub host_invoke: extern "C" fn(*mut c_void, method: *const c_char, args: *const c_char) -> *mut c_char,
}
```

`host_invoke` 返回串由**宿主**持有（内部 CString 表，卸载时释放）；插件应**立即拷贝**，不要跨调用持有指针。

## Capability 拦截点

**唯一强制点：`loader::dispatch_host_invoke`（插件 → 宿主）**

| host method | 所需 capability | 宿主实现 |
|-------------|-----------------|----------|
| `log` / `log.*` | （始终允许） | 写入环形日志 |
| `launcher.read` | `launcher.read` | 读 `ConfigManager::load_launcher_data` |
| `launcher.launch` | `launcher.launch` | 复用 `system::open_url` / `open_path` |
| `events.emit` | `events.emit` | `app.emit("plugin_host_event")` |
| `fs.*` / `net.*` | `fs` / `net` | 检查真实；实现为 `NOT_IMPLEMENTED` 扩展点 |
| 未知 method | 同名 capability | 通过检查后 `NOT_IMPLEMENTED` |

未声明 → 错误码 **`capability_denied`**（含 `details.required_capability`）。

## 示例插件

`plugins/example-rust-plugin/`（源码）+ `plugins/com.air.example.rust/`（构建产物）。

`hello` / `launcher_summary` / `emit_ping` / `try_launch` 分别演示 log、launcher.read、events.emit 与 capability 拒绝。

## 验证

```powershell
cd Z:\VScodeProject\air-icon-launcher\src-tauri
cargo check --no-default-features
cargo test --no-default-features
```

## 已下线 / 扩展点

- **iframe JS 插件系统已下线**（IR）：前端运行时、旧 Tauri 命令、旧示例均已删除。
- **Worker JS** 仍为预留运行时（见 `cordis-refactor-overview.md`）。
- WASM 运行时未实现（`runtime` 字段预留）
- 签名校验 / UI 未做（out of scope）
- `launcher.launch` 在无 AppHandle 时 open_path/open_url 仍走 system 层；capability 检查始终真实
- host_invoke 返回字符串在插件卸载前累计保留（防 UAF），高频调用需后续引入共享分配器
- 新代码统一 AppError
