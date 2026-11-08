# 迈从插件 · 三角洲热键失效排查交接

> 状态：**根因已定位并验证，P0~P3 全部完成**（2026-11-08 19:20 于 Win10 收尾）
> 最后更新：2026-11-08 19:20（Win10 10.0.19045，含 Rust 工具链）
> 前序环境：Win11 机器（仅定位，无工具链）

---

## 0. 收尾结论（Win10 已完成）

| 项 | 状态 | 结果 |
|---|---|---|
| P0 编译验证 | ✅ | `cargo build --release` 通过；`cargo test --release` 16 单测 + doctest 全绿 |
| P0 附带修复 | ✅ | `hid.rs` doctest 结构图用 ```` ```text ```` 标注，不再被当 Rust 解析 |
| P1 部署 | ✅ | 新 dll 已同步到 `plugins/com.air.mchose.profile/` 与 `%APPDATA%\air-icon-launcher\plugins\com.air.mchose.profile/`，三处 MD5 一致 `897a2485…` |
| P2 提权 | ✅ | 新增 `src-tauri/src/elevation.rs`，两种方式：即时提权重启 + RUNASADMIN 兼容层标记 |
| P3 文档 | ✅ | 协议文档补「输入侧第二道门槛：UIPI」，README 补排错章节 |
| 第 7 节待定项 | ✅ | 宿主 `push_log` 时间戳由 `Utc::now()` 改为 `Local::now()` |

**P2 没有采用原文档的方案 2（manifest `requireAdministrator`）**，原因见第 5 节。

---

## 1. 一句话结论

三角洲内热键失效**不是反作弊屏蔽输入通道，而是进程权限级别不对等**。
启动器以管理员权限运行后四条热键通道全部正常，问题已解决。

**不要再往「加通道」「换组合键」方向查。**

---

## 2. 根因

ACE 反作弊把 `DeltaForceClient-Win64-Shipping.exe` 托管为**高完整性级别**（受保护进程）。
Windows 的 UIPI（用户界面特权隔离）规定：低完整性进程**收不到**高完整性进程的输入。

启动器以普通权限运行时，`hotkey.rs` 的四条通道全被拦：

| 通道 | 普通权限 | 管理员权限 |
|---|---|---|
| `WH_KEYBOARD_LL` 低级钩子 | ❌ UIPI 拦截 | ✅ |
| `RegisterHotKey` 系统热键 | ❌ UIPI 拦截 | ✅ |
| Raw Input `RIDEV_INPUTSINK` | ❌ UIPI 拦截 | ✅ |
| `GetAsyncKeyState` 轮询 | ❌ UIPI 拦截 | ✅ |

**「切出游戏再按就正常」的机制**：切出后焦点回到普通窗口，权限对等，通道恢复。

### 现场证据（2026-11-08）

- 游戏窗口：`1920x1080 @ (0,0)`，`WS_POPUP=yes`/`WS_CAPTION=no`，`ExStyle=0x40000`
  → 无边框全屏（不是独占全屏）
- 游戏进程路径**读不出来**（`Get-Process.Path` 为 null）→ 受保护进程的确凿标志
- ACE 驱动全部 Running：`ACE-CORE202706`、`ACE-CORE302706`、`ace-game-0`、`ACE-SSC-DRV64`
- 启动器与游戏**同为未提权**时热键全灭；启动器提权后游戏内正常

### 已排除的错误假设（重要，别再走一遍）

| 假设 | 结论 |
|---|---|
| 帧长度不对导致 HID 写失败 | 已于 2026-11-08 修复（65 字节），且本次症状是**完全无反应 + OSD 不弹**，说明没走到 HID 层 |
| 裸键 `pgdn` 禁用了系统热键通道 | 换成 `ctrl+shift+m` 同样失效，证明通道不是瓶颈 |
| `RegisterHotKey` 能穿透 ACE | 错误。UIPI 在更底层拦截，任何通道都穿不过 |

---

## 3. 验证方法

```powershell
# 1. 确认游戏是否受保护（路径读不出 = 受保护）
Get-Process DeltaForceClient-Win64-Shipping | Select-Object Path

# 2. 确认启动器是否提权
(Get-CimInstance Win32_Process -Filter "ProcessId=<启动器PID>").GetOwner()
# 或直接看任务管理器「详细信息」的「已提升」列

# 3. 确认 ACE 驱动在跑
Get-CimInstance Win32_SystemDriver | Where-Object { $_.Name -match 'ACE' } |
  Select-Object Name, State
```

**判定标准**：启动器提权后进游戏按热键，日志应出现 `[hotkey] 触发切换（来源: XXX）`。

---

## 4. 仓库当前状态

### 4.1 已保留的改动（已编译验证）

**日志时区修复** —— [plugins/mchose-profile-plugin/src/lib.rs](plugins/mchose-profile-plugin/src/lib.rs)

原实现写 Unix 秒（UTC），比北京时间慢 8 小时，导致排查时「日志时间和当前时间对不上」，容易误判成插件没工作。

```rust
// 改前
fn chrono_like_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}.{:03}", d.as_secs(), d.subsec_millis())   // 1794133960.703
}

// 改后（Windows 分支）
fn chrono_like_now() -> String {
    use windows::Win32::Foundation::SYSTEMTIME;
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let st: SYSTEMTIME = unsafe { GetLocalTime() };
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds)
}
```

配套改动：
- [Cargo.toml](plugins/mchose-profile-plugin/Cargo.toml)：`windows` features 增加 `Win32_System_SystemInformation`
- [README.md](plugins/mchose-profile-plugin/README.md)：排错章节补充「游戏内失效 = 权限问题」完整说明

> ✅ **已在 Win10 完成编译验证**（2026-11-08 19:08）：
> `cargo build --release` 通过，`windows 0.54` 里 `GetLocalTime` 返回 `SYSTEMTIME`
> 值类型（不是 `Result`），原代码写法正确，无需退到 UNIX 秒 + 时区偏移的备选方案，
> 也不必引入 `chrono`。
>
> 顺带修掉一个既有坑：[hid.rs](plugins/mchose-profile-plugin/src/hid.rs) 里
> `read_battery` 的响应结构图用 ``` ``` ``` 包着非 Rust 内容，导致
> `cargo test` 的 doctest 编译失败（`unknown start of token: ←`）。
> 已改成 ```` ```text ```` 并去掉箭头符号，现在 `cargo test --release` 全绿。

### 4.2 已回退的改动（不要再捡回来）

排查中期我基于错误假设加过一套「裸键按需注册」机制，已**全部手工还原**：

- `hotkey.rs`：`BARE_FOREGROUND_PID`、`BARE_MON_*`、`BARE_REGISTERED`、
  `start_bare_foreground_monitor`、`stop_bare_monitor`、`bare_hotkey_engaged`、`set_bare_hotkey_when_foreground`
- `lib.rs`：`PROTECTED_GAME_PROCESSES`、`find_game_pid`、`hotkey_status` 里的 `bare_engaged` 字段
- `Cargo.toml`：`Win32_System_Diagnostics_ToolHelp` feature

已用脚本确认无残留：全仓库搜索上述符号均无匹配。

### 4.3 已删除的临时文件

`tools/hotkey-probe/`（`probe-hotkey.ps1`、`probe-channel.ps1`）——基于错误假设编写的诊断脚本，已删除。
若以后需要实测通道，可参考本文第 3 节用系统工具替代。

### 4.4 用户侧配置

插件配置在 `%APPDATA%\air-icon-launcher\plugin-data\com.air.mchose.profile\config.json`：

```json
{
  "mode": "pair",
  "active_slots": [1, 2],
  "pair": [1, 2],
  "osd_url": "http://192.168.31.66:8766",
  "duration": 2.5,
  "show_battery": true,
  "hotkey": "pgdn",
  "hotkey_enabled": true
}
```

排查过程中曾临时改成 `ctrl+shift+m`，用户已改回 `pgdn`。**提权后裸键 `pgdn` 是可用的**，无需改配置。

---

## 5. Win10 环境待办（已全部完成）

### P0 · 编译验证 ✅

```bash
cd plugins/mchose-profile-plugin
cargo build --release   # Finished in 10.58s
cargo test --release    # 16 passed; doctest 0 failed
```

`GetLocalTime` 在 `windows 0.54` 里返回 `SYSTEMTIME` 值类型（不是 `Result`），
原写法正确，备选方案（UNIX 秒 + 偏移 / 引入 `chrono`）**不需要**。

附带修复：`hid.rs` 的 `read_battery` doctest 用了普通 ``` ``` ``` 包裹结构图，
被 rustdoc 当 Rust 编译而报错。已改为 ```` ```text ````。

### P1 · 部署并验证日志 ✅

```bash
# 先停掉正在运行的实例（dll 被加载会锁文件）
Stop-Process -Name air-icon-launcher -Force
cp target/release/air_mchose_profile.dll ../com.air.mchose.profile/
cp target/release/air_mchose_profile.dll "$APPDATA/air-icon-launcher/plugins/com.air.mchose.profile/"
```

三处 MD5 一致：`897a24856e6789f903ac9cb403b1fa8c`。

启动后 `%TEMP%\mchose-profile-plugin.log` 新行应形如：

```
[2026-11-08 19:00:12.345] L2 [hotkey] 已注册: pgdn（通道: ...）
```

### P2 · 治本：让启动器默认提权 ✅（换了实现方式）

新增 [src-tauri/src/elevation.rs](src-tauri/src/elevation.rs)，对外三个命令：

| 命令 | 作用 |
|---|---|
| `get_elevation_status` | 返回 `{ elevated, run_as_admin_flagged, exe_path }` |
| `relaunch_as_admin` | `ShellExecuteW(verb="runas")` 重启自身，带 `--replace` 参数 |
| `set_run_as_admin` | 写/删 HKCU 兼容层 `RUNASADMIN` 标记 |

设置界面「权限」区已接上（[Window.vue](src/views/settings/Window.vue)）：
一行状态说明 + 「立即以管理员重启」按钮 + 「每次启动自动请求管理员权限」开关。

**没有采用原方案 2（manifest `requireAdministrator`）**，三个理由：

1. `tauri dev` 和调试也要走 UAC，开发体验直接崩；
2. 用户失去「不提权启动」的选择权；
3. 提权后无法从普通进程直接拉起（更新器、自启动链路都会受影响）。

**单实例配合**：`relaunch_as_admin` 会传 `--replace`，`main.rs` 的
`ensure_single_instance_or_wake(wait_for_previous)` 收到后会先等旧实例
释放互斥量（最多 5 秒），避免新实例把自己当成「第二个实例」自杀，
也避免两个实例同时抢 HID 设备。

### P3 · 文档补充 ✅

`docs/architecture/mchose-mouse-protocol.md` 在「帧长度」条目后新增
**「输入侧的第二道门槛：UIPI 权限对等」** 小节，含四通道对照表和判定方法，
并在第 2 条坑位处加了交叉引用，避免后来者把「游戏内失效」一律归因到 HID。

---

## 6. 关键代码位置速查

| 内容 | 位置 |
|---|---|
| 四通道热键实现 | `plugins/mchose-profile-plugin/src/hotkey.rs` 顶部注释 + `start()` |
| 热键注册入口 | `plugins/mchose-profile-plugin/src/lib.rs` → `setup_hotkey()` |
| 裸键不注册系统热键的判断 | `hotkey.rs` → `let bare = need == 0; ... (!bare || allow_bare)` |
| HID 帧长（65 字节） | `plugins/mchose-profile-plugin/src/hid.rs` → `FEATURE_REPORT_LEN` |
| 游戏内盲切逻辑 | `lib.rs` → `do_switch()` 的 `before.is_none()` 分支 |
| 插件日志文件 | `%TEMP%\mchose-profile-plugin.log` |
| 宿主日志时间戳 | `src-tauri/src/plugin_host/registry.rs:305` → `push_log`，已改 `Local::now()` |
| 提权实现 | `src-tauri/src/elevation.rs` |
| 单实例 + `--replace` | `src-tauri/src/main.rs` → `ensure_single_instance_or_wake` |

---

## 7. 待定项（已决）

宿主侧日志 [registry.rs](src-tauri/src/plugin_host/registry.rs#L305) 的 `push_log`
原本用 `chrono::Utc::now()`，与插件侧同样是 UTC。

**已改为 `chrono::Local::now()`**，与 `updater.rs` 的 `UpdateLogger::log` 对齐。
宿主 UI 里的插件日志现在显示本地时间。

---

## 8. 经验教训

1. **先确认症状边界再动手**。「完全无反应 + OSD 不弹」= 输入层问题；
   「OSD 弹了但鼠标没切」= HID 层问题。两者修法完全不同。
2. **权限是隐藏维度**。看到「切出游戏就正常」这种描述，第一反应就该查完整性级别和 UIPI。
3. **日志时间戳要对齐本地时区**，否则排查时会系统性低估「这段时间有没有日志」。
4. **没有工具链时不要改需要编译的代码**。这次回退花的时间比改还多。
