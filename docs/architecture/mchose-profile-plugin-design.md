# MCHOSE 板载配置切换插件 —— 设计

> 目标：**按键切换鼠标板载配置，状态显示在另一台 Linux 主机的屏幕上**
> 状态：协议已打通，跨机显示方案已实测验证

## 1. 需求拆解

| 子需求 | 方案 | 状态 |
|---|---|---|
| 全局键盘热键 | 复用项目已有 `keyboard_hook.rs`（`WH_KEYBOARD_LL`） | 现成 |
| 读取/切换板载配置 | HID feature report，协议已逆向完成 | 已实测 |
| 读取电量 / DPI | 同 HID 通道 | 已实测 |
| 跨机显示 | Windows 推送 → Linux 小窗口 | 已实测 |

**关键点**：因为显示在**另一台物理显示器**上，
「不被全屏游戏遮挡」这个问题**根本不存在**——两台机器独立，
游戏在 Windows 独占全屏也影响不到 Linux 那台屏幕。

## 2. 目标环境（已探测）

| 项 | 值 |
|---|---|
| 主机 | `192.168.31.66`（SSH 别名 `air-ubuntu`，root 免密） |
| 系统 | Ubuntu 26.04 LTS |
| 桌面 | GNOME + GDM，**Wayland** 会话 |
| 显示 | Xwayland `:0`，socket `/tmp/.X11-unix/X0` |
| Xauthority | `/run/user/1000/.mutter-Xwaylandauth.HY9IV3` |
| 会话用户 | `iforair`（uid 1000） |
| 已占端口 | 8080（Sub2API，**勿占用**） |
| 可用 | python3 3.14 / gcc 15 / node 22 / PyGObject / GTK3 3.24 |

## 3. 跨机显示：实测结论

### 可行的启动方式（已验证）

```bash
ssh air-ubuntu 'sudo -u iforair env \
  DISPLAY=:0 \
  XAUTHORITY=/run/user/1000/.mutter-Xwaylandauth.HY9IV3 \
  GDK_BACKEND=x11 \
  python3 /tmp/osd.py'
```

实测输出 `MAPPED: ... geometry=(420,170)`，窗口真实映射到 GNOME 桌面。

**三个必须的坑**（缺一不可）：

1. `XAUTHORITY` —— 不指定会报 `Authorization required, but no authorization protocol specified`
2. `GDK_BACKEND=x11` —— Wayland 原生下 GTK3 从 SSH 起不来，走 Xwayland 才行
3. `sudo -u iforair` —— 必须以会话属主身份跑，root 直接跑拿不到用户会话

注意 Xauthority 文件名带随机后缀，**会随登录变化**，需动态探测：

```bash
ls -t /run/user/1000/.mutter-Xwaylandauth.* | head -1
```

### 备选：notify-send（已验证可用）

```bash
ssh air-ubuntu 'sudo -u iforair env \
  DISPLAY=:0 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  notify-send "三角洲-MK4" "配置 2/3 · 1600 DPI · 电量 85%"'
```

轻量、稳定，但样式不可控（走 GNOME 通知中心）。

### 置顶能力说明

Wayland 下 `set_keep_above()` 的实际效果取决于 Mutter，
Xwayland 窗口的置顶不如 X11 会话可靠。
如果发现被其他窗口盖住，有两个升级路径：

1. 装 `gtk-layer-shell`（`apt install gir1.2-gtkshell-0.1`），用 layer-shell 协议
   以 `OVERLAY` 层显示 —— 这是 Wayland 下唯一可靠的置顶方式
2. 退回 `notify-send`

## 4. 整体架构

```
┌─────────────────── Windows（游戏机） ───────────────────┐
│  Air Icon Launcher                                       │
│    └─ Rust cdylib 插件  com.air.mchose.profile            │
│         ├─ hidapi  →  feature report 0x12/0x11           │
│         │            读配置 / 切槽位 / 读电量             │
│         ├─ 全局热键（keyboard_hook）                      │
│         └─ HTTP POST ─────────────┐                      │
└───────────────────────────────────┼──────────────────────┘
                                    │ 192.168.31.66:PORT
┌───────────────────────────────────▼──────────────────────┐
│  Linux（192.168.31.66）                                   │
│    └─ 常驻小服务（systemd user service）                  │
│         ├─ HTTP 接收 /state                               │
│         └─ 弹 GTK OSD 窗口，2.5s 后自动关闭               │
└───────────────────────────────────────────────────────────┘
```

推送方向：**Windows → Linux**（Linux 开服务，Windows 主动 POST）。
这样不受 Windows 防火墙影响，且 Linux 端可常驻。

## 5. 功能设计

### 热键行为（两种模式可切换）

| 模式 | 行为 |
|---|---|
| 轮换 | 在启用的槽位间循环：1→2→3→1 |
| 两选一 | 只在选定的两个槽位间来回切（A↔B） |

可配置「参与轮换的槽位」，比如屏蔽掉空的「默认」槽。

### OSD 显示内容

```
┌──────────────────────────────┐
│      三角洲-MK4              │   ← 配置名（大字）
│   ●●○  配置 2/3              │   ← 圆点指示 + 序号
│   1600 DPI · 电量 85%        │   ← 详情
└──────────────────────────────┘
```

2.5 秒后淡出。

### 数据来源

| 字段 | 来源 |
|---|---|
| 配置名 | `0x12 0x68 0x00/01/02`（UTF-8） |
| 当前槽位 | `0x12 0x67` → `body[0]` |
| DPI（X） | `0x12 0x67` → `body[4..15]` 小端 16 位 |
| DPI（Y） | `0x12 0x67` → `body[51..]`，仅当 `body[50]` bit0=1 |
| 电量 | `0x11 0x06` → `body[9]` 百分比、`body[10]` 充电中 |

> **切换后必须重读配置**：`body[50]`（Y 是否独立）和 Y 组数值逐槽不同，
> 复用切换前的数据会导致 DPI 显示错位（详见协议文档「X/Y 独立」一节）。

## 6. HID 协议速查

详见 [mchose-mouse-protocol.md](./mchose-mouse-protocol.md)。要点：

- 发送 `feature report 0x12`（63 字节）/ `0x11`（19 字节），接收 `0x11`
- **所有字节 XOR 0xFF**（最容易踩的坑），长度不含 report id
- 切换：`0x11 [0x58, index]`（**只有两个字节**，多一个 `0x58` 会回 ACK 但不切换）
- 读配置：`0x12 [0x67]`
- 读槽名：`0x12 [0x68, slot]`
- 读电量：`0x11 [0x06]`（注意不是 `0x11 [0x04]`，那是固件版本串）

## 7. 待确认 / 风险

1. **Wayland 置顶**：`set_keep_above` 在 Mutter 下可能不生效，
   需要实测；不行就上 gtk-layer-shell
2. **无线休眠**：鼠标闲置后 HID 返回全零，需重试 + 唤醒
3. **热键冲突**：`keyboard_hook.rs` 已有注册机制，需检查是否支持多热键并存
4. **Xauthority 路径**：带随机后缀，需动态探测而非写死
