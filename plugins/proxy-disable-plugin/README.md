# 关闭系统代理插件（com.air.proxy.disable）

开机自启后关闭 Windows「设置 → 代理」中的系统代理开关（`ProxyEnable=0`），并刷新 WinINet。

## 构建与安装

```powershell
cd plugins/proxy-disable-plugin
cargo build --release
$dest = "..\com.air.proxy.disable"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item .\manifest.json $dest -Force
Copy-Item .\target\release\air_proxy_disable.dll $dest -Force
```

## 方法

| method | 说明 |
|--------|------|
| `run_on_autostart` | 宿主 `--autostart` 钩子；关闭系统代理 |
| `disable` | 同上，手动调用 |
| `status` | 读取当前 `ProxyEnable` |

## 宿主行为

仅当进程带 `--autostart` 启动时，宿主会 scan → 加载 enabled 插件 → 各调用一次 `run_on_autostart`。
