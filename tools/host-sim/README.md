# host-sim — 插件宿主时序模拟器

复现「插件线程还在运行时宿主卸载插件」的时序，用于验证 `plugin_host` 的崩溃隔离
不会回退。对应事故：2026-11-07 21:49 迈从插件热键切换时宿主闪退
（`0xC0000005`，`air-icon-launcher.exe+0xf2dcc`，崩在 `registry::push_log` 的 Mutex 上）。

它不链接 `air-icon-launcher` 的任何代码，只按 ABI v1 自己实现一份最小宿主
（`AirHostVTable` + `HostUserData` + `log` 回调），因此可以在几分钟内跑完，
不需要启动整个 Tauri 应用。

## 三种模式

| 模式 | 含义 | 期望结果 |
|---|---|---|
| `new` | 当前宿主实现：`HostUserData` 走 `Arc` + 注册表查活，卸载时 DLL 退休不 unmap | `exit 0`，进程存活 |
| `old` | 2026-11-07 的实现：回调直接对 `user_data` 裸指针取引用，卸载时 `drop(Library)` + 立即释放 `HostUserData` | `exit -1073741819`（`0xC0000005`） |
| `reload` | load → invoke → unload → load → invoke，连做三轮 | `3/3 轮 invoke 成功`，`exit 0` |

## 用法

```powershell
cd tools/host-sim
cargo build

# 参数：<插件 dll> <卸载延迟毫秒> <new|old|reload>
$dll = '..\..\plugins\mchose-profile-plugin\target\release\air_mchose_profile.dll'

.\target\debug\host-sim.exe $dll 200 old     # 复现崩溃
.\target\debug\host-sim.exe $dll 150 new     # 验证修复
.\target\debug\host-sim.exe $dll 0 reload    # 验证重复加载
```

`new` / `old` 模式里，`invoke("next")` 会在后台线程跑一次真实的 HID 切换
（需要插着 MCHOSE A7 V2；没有设备时插件会返回错误信封，时序照样有效）。
卸载延迟设成 150~250ms 正好落在一次切换的中途，这是最容易崩的窗口。

## 读结果

- `old` 崩在 `[sim] 观察 8 秒...` 之后 → 说明宿主侧的 UAF 防护失效了。
- `new` 打出 `卸载后丢弃 N 条` 是正常现象：那是插件线程在卸载后继续
  `host_log`，被注册表拦掉。
- `reload` 每轮都会打 `退休（1 个）`，退休区只增不减是设计如此
  （DLL 代码段不能被 unmap，见 `docs/architecture/plugin-host.md`）。
