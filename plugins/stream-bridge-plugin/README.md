# 直播推流桥（stream-bridge）

解决采集卡做不到的两件事：**声音**和**隐私**。

| 问题 | 采集卡的局限 | 本插件的做法 |
|---|---|---|
| 耳机声音进不了 OBS | 采集卡只抓 HDMI 里的音频；USB 耳机插不到采集卡上 | WASAPI 环回抓「默认播放设备上正在响的那份」，UDP 直送副机，落 null sink，OBS 采 Monitor |
| 桌面窗口不能只排除某个 | 抓的是整块显示器，无法按窗口裁 | 判「前台窗口是否独占显示器」，一离开全屏就让 OBS 把画面藏起来 |

实测数据来自本机（48 kHz、240 帧/包、千兆局域网）：

| 指标 | 结果 |
|---|---|
| 包率 / 带宽 | 200 pkt/s，192 kB/s（1.5 Mbps 无压缩） |
| 包抖动 | p50 0.08 ms，p99 0.12 ms |
| 丢包 | 0.000% |
| 采集积压 | 0.00 ms（事件驱动，引擎无排队） |
| 设备周期 | 3.00 ms（端点允许的最小值） |
| 端到端 | 软件栈约 8 ms（见 `lan-audio` 的基准） |

## 一、声音

### 主机（Windows）

插件已经编好：`plugins/com.air.stream.bridge/air_stream_bridge.dll`。

**必须显式选对播放端点。** 这台机器的默认播放设备是
`Capture Card (NVIDIA HDMI)`——那是采集卡自己的 HDMI 音频，里面没有声音；
真正的音频在 `迈从 (MCHOSE V9 Turbo+)`。所以设置里 `audio_device` 默认填了 `MCHOSE`。

调 `audio_devices` 可以列出所有端点及哪个是系统默认：

```json
{"data": {"devices": [
  {"index": 0, "name": "迈从 (MCHOSE V9 Turbo+)", "state": "Active", "default": false},
  {"index": 1, "name": "Capture Card (NVIDIA High Definition Audio)", "state": "Active", "default": true}
]}}
```

| 设置项 | 含义 |
|---|---|
| `audio_dest` | 副机 `IP:47800` |
| `audio_device` | 播放端点名片段，如 `MCHOSE` |
| `audio_rate` | 线上采样率；与混音格式一致时零重采样 |
| `audio_frames_per_packet` | 240 帧 = 5 ms，单包 980 B，不分片 |
| `audio_period_ms` | 0 = 端点最小值（你的设备 3 ms） |
| `audio_keepalive` | 无声时补静音，副机时间轴不断、恢复播放不爆音 |

### 副机（Linux）

```bash
# 先编好接收端（副机上有 cargo 就直接编，比交叉编译可靠）
sudo apt-get install -y libasound2-dev pkg-config
cd /opt/lan-audio && cargo build --release --bin lan-audio-recv

# 再装服务
sudo ./linux/setup-recv.sh install
```

OBS 里加 **音频输出采集 (PulseAudio)**，设备选 **Monitor of LAN-Audio**。

#### 三个实测踩到的坑

**1. null sink 必须由 PipeWire 自己建，不能用 `pactl load-module`。**
`pactl` 建出来的 sink 在 `systemctl --user restart pipewire` 之后就消失了，
表现为「OBS 里本来能选到，重启后又没了」。正确做法是写
`~/.config/pipewire/pipewire.conf.d/99-lanaudio.conf`，用 `support.null-audio-sink`。

**2. `PULSE_SINK` 对 cpal 无效，必须加 `PIPEWIRE_NODE`。**
接收端用 cpal，Linux 上走 ALSA 后端，绕过了 PulseAudio 层。
只设 `PULSE_SINK=lanaudio` 时，`wpctl status` 显示音频流挂在**默认 sink（板载 HDMI）**上，
`LAN-Audio` 永远是 `SUSPENDED`，OBS 采到的是静音。
必须同时设 `PIPEWIRE_NODE=lanaudio`，流才会连到 `LAN-Audio:playback_FL/FR`。

验证方法：

```bash
wpctl status | sed -n '/Streams:/,/Video/p'
# 正确：output_FL > LAN-Audio:playback_FL
# 错误：output_FL > 内置音频 数字立体声(HDMI):playback_FL
```

**3. `--allow` 别写死主机 IP。**
这台主机实际是 `192.168.31.254`，写成别的地址会表现为
「服务在跑、端口在听、但一个包都不收」。留空最稳。

#### 延迟与稳定性的取舍

PipeWire 的默认回调块是 512 帧（10.7 ms），抖动缓冲的下限被它抬高，
稳态 `target` 落在 25 ms 左右。压到 `--buffer-frames 128 --target-ms 5`
能把缓冲降到 8–13 ms，但实测 `drop` 持续增长（欠载），不划算。
默认配置取 `--target-ms 6 --min-target-ms 3`，稳定后缓冲在 16–26 ms 之间波动、
`und`/`drop` 不再增长。

手动跑（调试）：

```bash
pactl load-module module-null-sink sink_name=lanaudio rate=48000
PIPEWIRE_NODE=lanaudio lan-audio-recv --bind 0.0.0.0:47800 --device PulseAudio
```

## 二、隐私虚化

### 判据

采集卡抓整块显示器，所以「排除某个窗口」这条路不存在。
判据换成**前台窗口是否独占一整块显示器**：

1. 前台窗口存在、可见、未最小化
2. 不是 shell 窗口（`Progman` / `WorkerW` / `Shell_TrayWnd` / IME 等）
3. 无标题栏，或标题栏被顶到屏幕外（真全屏 / 无边框全屏）
4. 窗口矩形覆盖所属显示器整个区域（容差 2 px）

四条全满足 → 不虚化；任一不满足 → 虚化。状态要稳定 `privacy_debounce_ms`
（默认 500 ms）才下发，避免切窗口时反复闪。

`privacy_fail_safe` 打开时，插件加载后先按「非全屏」处理并立即虚化，
等首次判定通过再放开——宁可多糊一下，也不在启动瞬间漏桌面。

### 三种下发方式

OBS 33 的 `GetSourceFilterKindList` 里**没有** `blur_filter_v1`
（实测 `CreateSourceFilter` 直接回 607「filter kind is not supported」），
所以准备了三档：

| `obs_mode` | 做法 | 适用 |
|---|---|---|
| `blur` | 挂 `scale_filter` 把画面缩到 32×18 再放大 = 整屏模糊 | **默认**，不依赖模糊滤镜 |
| `scene` | 切到专用隐私场景 | 想完全换一张画面时 |

`transform` 会在首次虚化时记下源原来的变换，还原时只回写
`scaleX/scaleY/position/alignment/bounds*`，不动 crop 等其它字段；
`boundsWidth/Height` 为 0 时跳过（OBS 要求 ≥ 1，否则报 402）。

### OBS 端配置

副机 OBS：**工具 → WebSocket 服务器设置**，启用并记下端口（默认 4455）与密码。

插件设置里：

| 设置项 | 值 |
|---|---|
| `obs_url` | `ws://192.168.31.66:4455` |
| `obs_password` | 上面那个密码；未开认证留空 |
| `obs_source` | OBS 输入源里的真实名字。这台是 `视频采集设备 (V4L2)` |
| `obs_mode` | `transform` |

不确定名字就跑 `obs_list`，它会把场景、输入源、每个源已有的滤镜全列出来：

```json
{"data": {
  "current_scene": "场景",
  "scenes": ["场景"],
  "inputs": [
    {"name": "桌面音频", "kind": "pulse_output_capture", "filters": []},
    {"name": "视频采集设备 (V4L2)", "kind": "v4l2_input", "filters": []}
  ]}}
```

## 三、三路音频来源

同一个插件支持三路独立推流，各自一个端口、一个线程、一份统计：

| 来源 | `audio_device` 选什么 | 说明 |
|---|---|---|
| 播放设备环回 | 具体端点名 / 「跟随系统默认」 | 抓「耳朵听到的声音」，走 WASAPI Render 端点环回 |
| 麦克风 | 单独一块 `mic_*` 配置 | 走 WASAPI Capture 端点，端口默认 `47801` |
| 单程序音频 | 「单程序音频」+ 填进程名 | 走 `ActivateAudioInterfaceAsync` 进程环回，只抓指定进程 |

### 麦克风

副机上再起一个接收端，监听不同端口：

```bash
pactl load-module module-null-sink sink_name=lanmic rate=48000
PIPEWIRE_NODE=lanmic lan-audio-recv --bind 0.0.0.0:47801 --device PulseAudio
```

OBS 里加第二个「音频输出采集」，设备选 `Monitor of LAN-Mic`。

注意 `PIPEWIRE_NODE` 必须设，原因和主路一样（见下面「三个实测踩到的坑」）。

### 单程序音频

Windows 10 2004+ 才有。`audio_process` 填进程名（`chrome.exe`）或 PID。

wasapi 0.27 已内置 `AudioClient::new_application_loopback_client`，不需要自己拼
`ActivateAudioInterfaceAsync` + PROPVARIANT。但这条路径有一批 API 不可用
（`get_mixformat` / `get_device_period` / `get_buffer_size`），所以代码里
对 `SourceKind::ProcessLoopback` 直接指定 WaveFormat 和 10 ms 周期，不去问设备。

限制：目标进程必须**正在播放音频**，否则激活会失败。

## 三、插件方法

前端走 `plugin_host_invoke`，参数都是 JSON。

| 方法 | 作用 |
|---|---|
| `audio_start` / `audio_stop` | 起停推流 |
| `audio_status` | 端点、混音格式、包数、帧数、积压、错误 |
| `audio_devices` | 列出播放端点，标出系统默认 |
| `privacy_start` / `privacy_stop` | 起停全屏监视 + OBS 通道 |
| `privacy_status` | 当前前台窗口的进程/类名/矩形/全屏判定 |
| `obs_probe` | 连 OBS，返回版本、当前场景、源上的滤镜 |
| `obs_list` | 枚举场景 / 输入源 / 滤镜 |
| `obs_source_settings` | 读输入源设置，如音频源绑的设备 |
| `obs_set_source_settings` | 改输入源设置（overlay 合并） |
| `obs_blur` | 手动下发虚化（`{"on": true}`），调试用 |
| `obs_create_filter` | 在采集源上建模糊滤镜（多候选 kind 逐个试） |
| `obs_filter_setting` | 改滤镜参数，如 `{"key":"blur_radius","value":20}` |
| `obs_reconnect` | 丢弃现有连接，下次指令重连 |
| `settings.get` / `settings.set` | 读写配置 |
| `run_on_autostart` | 宿主 `--autostart` 时按开关自动起线程 |

## 四、实现要点

### 音频线程

- `wasapi` 0.27，`Direction::Render` 端点 + `Direction::Capture` 流 = 环回
- `StreamMode::EventsShared` + 端点最小周期（3 ms），事件驱动不轮询
- 原生混音格式优先（`48000/2ch/32bit/Float` → 零转换）；否则自动转换
- 8 声道端点自动降混立体声（取前两声道，与接收端一致）
- 每包盖「这帧进入音频引擎的时刻」，副机据此测真实端到端延迟
- 空闲 2 ms 以上补静音包，避免副机反复重新预热

### 隐私线程

- 200 ms 轮询 `GetForegroundWindow` + `MonitorFromWindow` + `GetWindowRect`
- 状态机带去抖，只在稳定变化时下发
- OBS 指令走独立线程 + `mpsc`，串行化，断线由下条指令触发重连
- `applied` 记忆已下发状态，重复指令直接短路

### 一个必须守住的约束

**join 线程绝不能发生在持有 `STATE` 锁的时候。**
后台线程退出前会打日志，`host_log` 要取 `STATE` 锁；持锁 join 就是必然自死锁。
冒烟测试第一版就卡死在这里（`stop_privacy` 持锁 join），
现在统一走 `halt_audio()` / `halt_privacy()`：先持锁摘句柄，放锁后再 join。

## 五、三个已修的真实 bug

**1. 改完设置「已保存」但界面回退**

`settings.set` 之前返回 `{saved, audio_restarted, config}`，而前端 `saveSetting`
是把返回值**整体当成新设置表**替换的：

```ts
settings.value = r.value
```

于是这层包装被当成了设置表，刚改的项全部「消失」，必须重进页面才正常。
改成返回扁平配置对象（和迈从插件一致）即可。

**2. 增益 1.1 变 1.100000023841858**

`audio_gain` 原先是 `f32`，1.1 在 f32 里存不下精确值，JSON 往返后
就变成那个长串。改成 `f64`，只在真正传给采集层时转 `f32`。

**3. 开关模糊滤镜没反应**

两个原因叠加：

- **这台副机的 OBS 33 没有模糊滤镜**：`GetSourceFilterKindList` 里没有
  `blur_filter_v1`，`CreateSourceFilter` 直接回 607。
- **`CreateSourceFilter` 建出来的滤镜默认是停用的**，必须再调一次
  `SetSourceFilterEnabled(filterEnabled: true)` 才会生效。少了这一步，
  滤镜建出来了、参数也对，画面就是不变。

现在的 `blur` 模式用内置 `scale_filter`（把画面缩到 32×18 再双线性放大），
同时把场景项 bounds 铺满画布，既模糊又满屏。验证方式是读回
`filterEnabled`：开启后应为 `true`，关闭后为 `false`。

## 五、验证

```bash
cd plugins/stream-bridge-plugin
cargo test --release --offline          # 17 项单元测试
cargo build --release --offline

# 真实 DLL 冒烟（加载/init/invoke/推流/隐私/OBS/卸载）
cd ../.. && python -u tools/plugin-smoke.py
```

单元测试覆盖：线格式往返、MTU 边界、降混、OBS 认证串、配置 clamp、
失败安全初值、未知方法错误信封。

端到端实测（本机回环）：200 pkt/s、零丢包、抖动 p50 0.08 ms；
OBS 33 上 `transform` 模式开关成功，还原不再报 402。

## 六、已知边界

- `transform` 模式视觉上是「缩成小图」而不是「糊」，隐私目的达到但不如真模糊自然。
  想要真模糊就在副机 OBS 里装一个带模糊滤镜的插件，然后把 `obs_mode` 切回 `filter`。
- 全屏判定按「整块显示器」算。多显示器下把游戏拖到副屏全屏也能正确识别，
  但「窗口最大化到副屏、主屏还有内容」会被判为非全屏（会虚化）。
- 采集卡如果同时把 HDMI 音频送进系统，环回抓到的就是那份；
  想只送耳机声音，就在 Windows 里把耳机设为默认播放设备。
- `panic = "unwind"` 是硬要求：`cdylib` 里 panic 若直接 abort 会连带杀掉宿主进程。
