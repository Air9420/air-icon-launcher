# 迈从板载配置切换插件

按一下键，在鼠标板载配置之间轮换，状态显示在另一台机器的屏幕上。

- **鼠标**：MCHOSE A7 V2 Ultra+（VID `0x3837` / PID `0x100B`）
- **显示**：远端 Linux 主机（默认 `192.168.31.66:8766`）

## 组成

```
plugins/mchose-profile-plugin/     插件源码（Rust cdylib）
plugins/com.air.mchose.profile/    构建产物（DLL + manifest），供宿主加载
artifacts/mchose_osd.py            Linux 端 OSD 窗口
artifacts/mchose_osd_server.py     Linux 端 HTTP 服务
artifacts/install-linux.sh         Linux 端一键部署
```

## 安装

### 1. Linux 端

```bash
./artifacts/install-linux.sh 192.168.31.66
```

脚本会：探测会话用户与 Xauthority → 上传脚本 → 装 systemd 服务 → 弹测试窗。

### 2. Windows 端

```bash
cd plugins/mchose-profile-plugin
cargo build --release
cp target/release/air_mchose_profile.dll ../com.air.mchose.profile/
```

然后在启动器的插件页启用 `com.air.mchose.profile`。

## 使用

默认热键 **Ctrl+Shift+M**，按一次切到下一个配置。

## 配置项

**推荐用界面配置**：插件卡片上有「设置」按钮，表单由 `manifest.json` 的
`contributes.settings` 声明式渲染，改完立即生效并持久化。

也可通过插件方法 `get_config` / `set_config` 读写。

| 字段 | 默认 | 说明 |
|---|---|---|
| `hotkey` | `ctrl+shift+m` | 全局热键，支持 `ctrl`/`shift`/`alt`/`win` 组合与 F1–F24 |
| `hotkey_enabled` | `true` | 是否注册热键 |
| `mode` | `cycle` | `cycle` 全部轮换 / `pair` 两选一切换 |
| `active_slots` | `[0,1,2]` | cycle 模式参与的槽位（0 起） |
| `pair` | `[1,2]` | pair 模式的两个槽位 |
| `osd_url` | `http://192.168.31.66:8766` | OSD 服务地址 |
| `duration` | `2.5` | 显示秒数 |
| `show_battery` | `true` | 是否显示电量 |

配置保存在 `%APPDATA%/air-icon-launcher/plugin-data/com.air.mchose.profile/config.json`，
插件加载时自动读取，重启不丢。

### 常见配置

只在你常用的两个配置间切换（跳过不想用的槽）：

- 模式选「两选一」，配置对勾选两个

三个全轮换，但排除某个：

- 模式选「轮换」，在「参与轮换的配置」里只勾要用的

## 插件方法

| 方法 | 说明 |
|---|---|
| `next` | 轮换到下一个 |
| `switch` | 指定切换，参数 `{"index":1}` |
| `status` | 读当前配置、名称、DPI、电量 |
| `settings.get` / `settings.set` | 设置界面读写（前端用） |
| `get_config` / `set_config` | 配置读写（脚本/调试用） |
| `slot_names` | 读三个槽位名称 |
| `hotkey_status` | 热键运行状态 |
| `test_osd` | 测试远端连通性 |

## 排错

**读不到鼠标**：A7 V2 是无线鼠标，闲置后 HID 返回全零。
动一下鼠标唤醒即可。插件内置 8 次重试。

**OSD 不显示**：

```bash
ssh 192.168.31.66 systemctl status mchose-osd
ssh 192.168.31.66 tail -20 /var/log/mchose-osd.log
curl -X POST http://192.168.31.66:8766/ping
```

**Xauthority 失效**：重新登录后文件名会变。服务每次显示都重新探测，
但 systemd 单元里写的是启动时的值。重启服务即可：

```bash
ssh 192.168.31.66 systemctl restart mchose-osd
```

## 技术要点

协议细节见 [docs/architecture/mchose-mouse-protocol.md](../../docs/architecture/mchose-mouse-protocol.md)，
设计说明见 [docs/architecture/mchose-profile-plugin-design.md](../../docs/architecture/mchose-profile-plugin-design.md)。

最容易踩的坑：**HID 帧所有字节要 XOR 0xFF**，不取反只能读到回显。
