# 示例 Rust 能力插件

演示 **cdylib ABI v1** 的最小插件，与 Air Icon Launcher 的 Rust Plugin Host（`src-tauri/src/plugin_host`）对接。

## 构建

```powershell
cd Z:\VScodeProject\air-icon-launcher\plugins\example-rust-plugin
cargo build --release
```

产物：`target/release/air_example_rust.dll`（crate-type = cdylib）。

## 安装到插件目录

宿主搜索 `plugins/<manifest.id>/`：

```powershell
$id = "com.air.example.rust"
$dest = "Z:\VScodeProject\air-icon-launcher\plugins\$id"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item ".\manifest.json" $dest -Force
Copy-Item ".\target\release\air_example_rust.dll" $dest -Force
```

开发模式下也可直接把 dll 拷到本目录（`plugins/example-rust-plugin/`），扫描时以 `manifest.json` 的 `id` 为准。

## 能力（capabilities）

| capability        | 示例 invoke 方法      | 说明 |
|-------------------|----------------------|------|
| `log`             | （始终允许）          | host_invoke `log` |
| `launcher.read`   | `launcher_summary`   | 读取启动器数据 |
| `events.emit`     | `emit_ping`          | 事件总线 → 前端 `plugin_host_event` |

**未声明** `launcher.launch`：调用 `try_launch` 会被宿主拒绝，错误码 `capability_denied`。

## 前端调用示例

```ts
await invoke("plugin_host_scan");
await invoke("plugin_host_load", { id: "com.air.example.rust" });
const data = await invoke("plugin_host_invoke", {
  id: "com.air.example.rust",
  method: "hello",
  args: { name: "Air" },
});
const logs = await invoke("plugin_host_get_log", { id: "com.air.example.rust" });
```
