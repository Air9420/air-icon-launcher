# 迈从（MCHOSE）鼠标板载配置协议

> 目标设备：**MCHOSE A7 V2 Ultra+**
> 状态：**协议已完全打通，读写链路实测验证通过**

## 1. 设备识别

| 项 | 值 |
|---|---|
| Vendor ID | `0x3837`（14391，迈从） |
| Product ID | `0x100B`（A7 V2 Ultra+） |
| 产品名 | `MCHOSE A7 V2 Ultra+`（RealTek 方案） |
| 配置接口 | `usage_page = 0xFF01`, `usage = 0x01`, interface 2, collection Col02 |
| HID 路径 | `\\?\HID#VID_3837&PID_100B&MI_02&Col02#...` |

同 VID 下其他设备（不要误选）：`0x600A` = V9 Turbo+ 耳机，`0x1012` = MagDock 磁吸座，
`0x6008` = V9 Turbo 底座。

## 2. 通信模型（关键）

```
发送：feature report 0x12（或 0x11），payload 不含 report id，payload 字节 XOR 0xFF
接收：feature report 0x11，65 字节（buf[0]=report id 不 XOR），buf[1..] XOR 0xFF
```

**三个必踩的坑**（都是实测踩出来的）：

1. **payload 字节要 XOR 0xFF**。不取反只能读到回显。
2. **payload 长度必须精确**：
   - `0x12` 类命令 → payload **63 字节**
   - `0x11` 类命令 → payload **19 字节**
   - payload **不含** report id

   多发一个字节，固件会判为非法帧——仍然回 ACK（回显），但**不执行也不返回数据**。
   表现就是"命令成功但数据全 0"，极具迷惑性。

3. **响应帧头是 `0x12` / `0x11`，不是 `0xED` / `0xEE`**。
   `0xED = 0x12 ^ 0xFF`、`0xEE = 0x11 ^ 0xFF`，所以「全字节 XOR」的记法里
   帧头会写成 0xED/0xEE，但用 hidapi 读出来时 **`buf[0]` 是未取反的 report id**，
   只有 `buf[1..]` 需要 XOR。按 0xED/0xEE 校验会永远匹配不上，
   把正常响应误判成「设备无响应」。校验应写成 `dec[0] == send_rid`。

**读取重试的正确姿势**：设备偶尔不产生新响应，此时 `get_feature_report`
会返回**上一次写入的帧**（`buf[0]` 仍是 0x11/0x12，但 `dec[1]` 是命令码本身）。
所以只清一条残留不够，要在 `xfer` 内循环读到「帧头对得上 **且** 命令码回显对得上」
的响应为止，再交给上层解析。

### 帧格式

```
payload[0] = 命令码
payload[1..] = 参数
```

发送时 `send_feature_report([rid] + payload)`，其中 payload 已逐字节取反。

响应（XOR 还原后）：

```
dec[0] = 0xED（0x12 类）或 0xEE（0x11 类）
dec[1] = 回显的命令码
dec[2..] = 数据
```

**注意 `dec[0]` 不是固定值**，取决于命令通道。

## 3. 已验证命令

### 读板载配置（含当前槽位索引）`0x12` + `[0x67]`

实测响应（XOR 还原后）：

```
ed 67 01 40 20 00 b0 04 20 03 40 06 80 0c 00 19 10 a4 01 02 ...
   ^^ ^^^^^^ dpi0=0x0440=1088? 实际读作 1200
   |
   cmd echo
      profileIndex = 1
```

字段布局（数据从 `dec[2]` 开始）：

| 偏移（相对 dec[2]） | 含义 |
|---|---|
| `[0]` | profileIndex 当前槽位 |
| `[1]` 高 4 位 / 低 4 位 | gDpiIndex / gRateIndex |
| `[2]` 高 4 位 / 低 4 位 | usbDpiIndex / usbRateIndex |
| `[3]` | reserved |
| `[4..15]` | dpi0–dpi5，各 2 字节小端 |
| `[16]` | dpiSum 档位总数 |
| `[17]` | sensor |
| `[18]` | keyDebounce 去抖 |
| `[19]` | sleep 休眠 |
| `[50]` bit0 | **X/Y 轴是否独立**（1=独立，Y 单独设置） |
| `[51..62]` | dpi0–dpi5 的 **Y 轴**值，各 2 字节小端（仅 `[50]` bit0=1 时有效） |

实测本机：槽位 1，DPI `[1200, 800, 1600, 3200, 6400, 42000]`，去抖 8ms，休眠 0（永不休眠）。

**X/Y 独立**：三个槽实测对比（`body` 相对 `dec[2]`）：

| 槽 | `body[50]` | X 组 | Y 组 | 解读 |
|---|---|---|---|---|
| 0 三角洲 | `0x81` | 1000 | 1400 | Y 独立 |
| 1 日常 | `0x80` | 1200 | — | Y 跟随 X |
| 2 三角洲-MK4 | `0x81` | 1200 | 1600 | Y 独立 |

> **坑**：切换槽位后必须**重新读一次配置**再渲染。每个槽的
> `body[50]`（Y 是否独立）和 Y 组数值都是**逐槽独立**的，
> 复用切换前读到的 `before` 结构会把上一个槽的 X/Y 设置套到新槽上，
> 表现为「日常显示成 1200 x 1600、MK4 只显示 1200」这种错位。
> 重读时要用「`profile_index == 目标`」做校验，因为设备有约 15% 概率回空帧。

### 读槽位名称 `0x12` + `[0x68, slot]`

实测三个槽的名字：

| 槽 | 参数 | 名称 |
|---|---|---|
| 0 | `[0x68, 0x00]` | **三角洲** |
| 1 | `[0x68, 0x01]` | **日常** |
| 2 | `[0x68, 0x02]` | **三角洲-MK4** |

响应：`dec[0]=0xED, dec[1]=0x68, dec[2]=槽位号, dec[3..]=UTF-8 名称`，
到 `0x00` 结束。空槽返回全 0。

**设备偶尔返回空帧**，必须重试（实测约 1/3 概率），
且空槽要连续两次读到空才能确认。

### 切换板载配置 `0x11` + `[0x58, index]`

```
通道 0x11，payload = [0x58, <index>]，19 字节
```

实测 ACK：`ee 58 <index> 00 ...`。

**踩过的坑**：不要写成 `[0x58, 0x58, index]`。多一个 `0x58` 固件会照常回 ACK
（`ee 58 58 00`），但**槽位根本不切换**。必须正好两个字节。

实测三个槽位全部切换成功并读回确认：

```
切换到槽 0 -> 读回 0  [OK]
切换到槽 1 -> 读回 1  [OK]
切换到槽 2 -> 读回 2  [OK]
```

### 轮换 vs 指定切换 —— 两者都原生支持

**主机侧**用 `0x11` + `[0x58, index]` 可以指定切到任意槽位；
轮换逻辑（在启用的槽位间循环）由插件自己算，见插件 `next_slot()`。

**按键绑定层面**（固件原生，可把切换绑到鼠标侧键，不需要电脑参与）：

```js
"mouse.switchOnboardProfile1": "0x330000",   // 指定切到槽 1
"mouse.switchOnboardProfile2": "0x330001",   // 指定切到槽 2
"mouse.switchOnboardProfile3": "0x330002",   // 指定切到槽 3
"mouse.cycleOnboardProfiles":  "0x3300ff",   // 循环切换（轮换）
```

注意 `0x3300xx` 是**按键动作编码**（写进按键映射表），
而 `0x11 0x58` 是**主机侧直接下发的切换命令**。两条路径都能用。

> 另有 `pF` 表中 `cycleOnboardProfiles: ["0x040000","0x040100"]` 的变体编码，
> 出现在另一套（键盘侧）按键表里，鼠标用的是 `0x3300ff`。

### 自动切换（应用联动）

官方还有「按前台应用自动切板载」的功能（`autoBoard`）：
监听当前窗口 exe，匹配到规则就调 `setProfileIndex(configIndex)`，
本质还是走 `0x11 0x58`。日志里能看到：

```
autoBoard_切换板载${productName},当前id:${curIndex}=>目标id:${configIndex}
```

### 其他已确认命令

| 功能 | 命令 |
|---|---|
| 固件版本 | `0x11 0x03` |
| 设备信息（VID/PID/固件/连接/电量） | `0x11 0x04` |
| 性能信息 | `0x11 0x06` |
| 整体写入配置 | `0x12 0x57`（`command:87` + 完整配置） |
| 槽位改名 | `0x12 0x59`（`[89, idx, ...UTF8]`） |

## 4. 关键实现细节

### 字节取反（必须）

```python
def build(cmd_tokens, length):
    """length: 0x12 类=63，0x11 类=19；不含 report id"""
    body = (cmd_tokens + [0] * length)[:length]
    return bytes(b ^ 0xFF for b in body)

def parse(resp):
    # resp[0] 是 report id（0x11），不参与 XOR
    return bytes([resp[0]]) + bytes(b ^ 0xFF for b in resp[1:])
```

### 偶发空帧

设备会间歇性返回空帧（实测约 1/3 概率，与休眠无关，休眠已是关闭状态）。
所有读取都必须重试。判空标准：

- `0x12 0x67`：`dec[2:]` 中非零字节数 > 5 才算有效
- `0x12 0x68`：`dec[1] == 0x68 && dec[2] == slot` 才采信

更稳的做法是在收发层（`xfer`）就校验「`dec[0] == 请求通道` 且命令码回显匹配」，
不合格就重新发送，不要把这个负担全压给上层。

### 曾经的误判

早期把"数据全 0"归因为**无线休眠**，并建议关闭 M HUB 进程——**这是错的**。
真实原因是：

1. 帧长度多发了 1 字节（64 而非 63），固件判为非法帧
2. 切换命令多写了一个 `0x58`
3. 帧头按 `0xED/0xEE` 校验（那是「连 report id 一起 XOR」的记法），
   实际 `buf[0]` 是未取反的 `0x12/0x11`，导致把正常响应当成无响应

三者都表现为"命令返回 ACK 但没有效果"或"设备无响应"，
极易误判为设备休眠、被 M HUB 抢占或硬件故障。

## 5. 参考来源

官方驱动 `MCHOSE HUB` 的渲染进程从 CDN 加载明文 JS，协议实现在：

- `https://www.mchose.com.cn/assets/purify.es-oHexKX_U.js` ← 核心，含 `readCommandEntrance` / `setCommands` / order 表
- `https://www.mchose.com.cn/assets/index-D9ufMCB0.js` ← 上层业务逻辑（`0x12 0x67`、`0x12 0x68` 调用点）
- `https://www.mchose.com.cn/gmouse/` ← 网页版驱动（另一套 `0x55` 协议，**不适用**于本机）

## 6. 安全边界

- 全程只读写 `0xFF01` 配置接口的 feature report，**不触碰** `MCHOSE_V9_TURBO.SYS` 内核驱动
- 切换槽位是只读索引变更，不覆盖配置内容，风险低
- 写入配置（`0x12 0x57`）会落到板载 Flash，需「先读后写 + 可回滚」
