---
feature: proxy-off-autostart
status: delivered
updated: 2026-09-22
branch: main
commits: (uncommitted working tree)
---

# 自启后关闭系统代理插件

## Report

**What was built** — 新增 Rust 能力插件 `com.air.proxy.disable`（源码 `plugins/proxy-disable-plugin/`，安装产物 `plugins/com.air.proxy.disable/`）：`run_on_autostart` / `disable` 将 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ProxyEnable` 写为 0，并调用 `InternetSetOptionW` 刷新 WinINet；不改 `ProxyServer`/PAC，不杀代理进程。宿主在 `lib.rs` setup 中仅当 `is_autostart_launch()`（`--autostart`）时，经 `plugin_host::autostart::schedule_autostart_hooks` 后台线程 scan → 加载 enabled 插件 → 各调用一次 `run_on_autostart`；`METHOD_NOT_FOUND` 跳过，单插件失败只记日志。

**Verification** — `cargo check --no-default-features`（src-tauri）PASS；`plugins/proxy-disable-plugin` `cargo test --release` PASS（2 tests）；`bun run typecheck` PASS；`bun run test:unit` PASS（339 tests）。`cargo test --no-default-features`（src-tauri）为 **PRE-EXISTING**：干净基线同样 `STATUS_ENTRYPOINT_NOT_FOUND`（0xc0000139），与本次改动无关。独立 reviewer：三项验收均满足，无 CRITICAL，仅 nits。

**Journey log**
- 环境拦截 `git worktree add`；用户选择直接在 main 工作区开发。
- GitNexus MCP/CLI 本轮不可用，影响面改为人工记录。
- 宿主 `AppError` 无 `Display`，日志改用 `[code] message`。
- 宿主测试加载失败确认为基线问题，不阻断交付。

## [S1] Problem

用户希望在 Air Icon Launcher **开机自启**后，自动执行一次「关闭 Windows 系统代理」（设置 → 代理 中的「使用代理服务器」），避免开机后仍带着上次会话的系统代理。当前 Rust 插件宿主不会在启动时自动加载/调用插件，也没有「关系统代理」能力。

## [S2] Design

### 行为契约

1. **插件** `com.air.proxy.disable`（Rust cdylib，ABI v1）
   - 位置：源码 `plugins/proxy-disable-plugin/`；安装产物 `plugins/com.air.proxy.disable/`（`manifest.json` + `air_proxy_disable.dll`）。
   - 能力：`["log"]`（关代理走插件进程内 Win32/注册表，不经 `host_invoke` 敏感方法）。
   - 方法：
     - `run_on_autostart`：宿主自启钩子约定方法；关闭系统代理并写环形日志。
     - `disable`：与上相同，供插件页手动验证。
   - 关闭定义（仅系统代理开关）：
     - 写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyEnable`（REG_DWORD）= `0`。
     - 调用 `InternetSetOptionW`：`INTERNET_OPTION_SETTINGS_CHANGED` + `INTERNET_OPTION_REFRESH`，使设置页与 WinINet 立即生效。
     - **不**修改 `ProxyServer` / `ProxyOverride` / `AutoConfigURL`，**不**结束代理软件进程，**不**改用户环境变量。
   - 成功信封：`{"ok":true,"data":{"disabled":true,"previous_proxy_enable":<0|1>}}`；注册表失败返回错误码 `PROXY_DISABLE_FAILED`。

2. **宿主自启钩子**
   - 常量方法名：`run_on_autostart`。
   - 触发条件：`autostart_service::is_autostart_launch()` 为真（进程参数含 `--autostart`）。手动启动 **不**执行。
   - 时机：`lib.rs` setup 中 `plugin_host::init_plugin_host` 之后，后台线程执行（不阻塞窗口/托盘初始化）。
   - 步骤：等价 scan → 读取 enabled 状态 → 仅对 **enabled** 插件 `load`（若未加载）→ `invoke("run_on_autostart", {})`。
   - 每个自启进程 **至多调用一次** 每个插件。
   - 错误策略：单个插件 load/invoke 失败只记日志，不中断其他插件、不影响应用启动。插件返回 `METHOD_NOT_FOUND` / 未实现钩子视为跳过（非错误）。
   - 能力门不变：宿主不新增系统代理专用 capability；关代理逻辑在插件 DLL 内完成。

3. **可观察性**
   - 宿主侧：`log` crate 记录扫描数、加载成功/失败、invoke 结果摘要。
   - 插件侧：`host_invoke("log", …)` 写入插件环形日志，可在插件页查看。

### 数据流

```
--autostart
  → setup: init_plugin_host
  → spawn: scan plugins
  → for enabled plugins: load → invoke run_on_autostart
       → plugin writes ProxyEnable=0 + InternetSetOption refresh
```

### 测试边界

- 宿主：单元测试 —「哪些 id 应参与自启钩子」（enabled 过滤；`METHOD_NOT_FOUND` 忽略策略）。
- 插件：Windows 上保存/恢复 `ProxyEnable` 的集成测试（写 0 后读回 0，再恢复原值）。
- 不测：真实开机、真实 Clash 进程、设置 UI 渲染。

## [S3] Out of Scope

- 关闭/卸载 Clash、v2rayN 等代理客户端进程。
- 修改 `ProxyServer`、PAC（`AutoConfigURL`）、系统环境变量。
- 每次应用启动（非 `--autostart`）都执行。
- 前端插件页新 UI（沿用现有 Rust 插件面板）。
- Worker JS / WASM 运行时。
- GitNexus 索引修复（本轮 CLI/MCP 均不可用，影响面改为人工记录）。

## Tasks

- [x] T1: 新增插件 crate `plugins/proxy-disable-plugin`（manifest + 关代理实现 + 单元测试） — acceptance: 插件目录 `cargo test` 通过；`ProxyEnable` 写 0 后可读回并恢复 (covers: S2)
- [x] T2: 宿主增加自启钩子调度（scan → enabled load → invoke `run_on_autostart`）并挂到 `lib.rs` setup 的 `--autostart` 分支 — acceptance: `src-tauri` `cargo check` 通过；仅在 `is_autostart_launch` 时调度；单插件失败不 panic（宿主 `cargo test` 为 PRE-EXISTING 环境失败） (covers: S2; depends: T1)
- [x] T3: 构建并安装插件产物到 `plugins/com.air.proxy.disable/` — acceptance: 目录含 manifest + dll；宿主 scan 能识别 id (covers: S2; depends: T1)
- [x] T4: 仓库级验证 `bun run typecheck` / `bun run test:unit` — acceptance: 命令完成且无新增失败 (covers: S2; depends: T2)
