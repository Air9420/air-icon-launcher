# 远程交叉编译（Linux → Windows）

本机打游戏时不想被 `cargo build` 占满 CPU，可以把 Windows 安装包的构建丢给局域网
Linux 主机 `air-ubuntu`（`192.168.31.66`，32 核 / 30G）。产物与本机原生构建等价，可直接发布。

## 快速开始

```bash
cd Z:\VScodeProject\air-icon-launcher

# 载入签名密码（每个新 shell 一次）
set -a && . ./.env.local && set +a

bash scripts/build-remote.sh
```

产物落在 `src-tauri/target-remote/`：

| 文件 | 用途 |
|---|---|
| `air-icon-launcher_x.y.z_x64-setup.exe` | 手动安装包 |
| `air-icon-launcher_x.y.z_x64-setup.nsis.zip` | 自动更新包 |
| `air-icon-launcher_x.y.z_x64-setup.nsis.zip.sig` | 更新包签名 |

参数：`--no-sign` 跳过签名；`--no-sync` 复用远端已有代码（只改了 Rust 代码时更快）。

## 已验证的结论

| 项 | 结果 |
|---|---|
| 交叉编译产物 | PE32+ GUI x86-64，合法 |
| 在本机实际运行 | ✅ 窗口正常，46 MB 内存 |
| NSIS 安装包 | ✅ 6.0 MB（原生 6.13 MB） |
| 签名校验 | ✅ `Signature and comment signature verified`，绑定 `version:0.9.1` |
| 全量耗时 | 约 2–4 分钟（32 核，比本机快） |

## 关键约束与坑位

### 1. `tauri build` 在 Linux 上拒绝 `nsis` 打包

```
error: invalid value 'nsis' for '--bundles [<BUNDLES>...]'
  [possible values: deb, rpm, appimage]
```

tauri-cli 按**宿主平台**决定可用 bundle 类型，Linux 宿主只认 deb/rpm/appimage。

**绕过办法**（脚本已实现）：先 `--no-bundle` 只编译出 exe，再拿 tauri 生成的
`installer.nsi` 直接调 `makensis`：

```bash
bun tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle
cd src-tauri/target/x86_64-pc-windows-msvc/release/nsis/x64
# 改三处路径后打包
makensis installer.nsi
```

需要改的路径（都是 Windows 绝对路径，Linux 上不存在）：

| 宏 | 原值 | 改为 |
|---|---|---|
| `MAINBINARYSRCPATH` | `Z:\...\air-icon-launcher.exe` | 远端绝对路径 |
| `ADDITIONALPLUGINSPATH` | `C:\Users\...\NSIS\Plugins\...` | `$HOME/.local/share/tauri/...` |
| `!include "...\SimpChinese.nsh"` | Windows 绝对路径 | `SimpChinese.nsh` |

### 2. `Can't detect any appindicator library` 崩溃

Linux 上 tauri-cli 启动时会探测 appindicator，缺失则 panic。装 `libayatana-appindicator3-dev`
即可（脚本自检会提示）。

### 3. 缺 `llvm-lib` 导致 cc-rs 失败

```
error occurred in cc-rs: failed to find tool "llvm-lib"
```

需要 `llvm-21` + `lld-21`，并把 `/usr/lib/llvm-21/bin` 加入 PATH，同时设
`AR_x86_64_pc_windows_msvc=llvm-lib`。

### 4. `LNK4099` 警告可忽略

链接时大量 `Cannot use debug info for 'libcmt.lib(...)'` —— 这是 xwin 下载的 Windows SDK
不含 `.pdb` 导致的，只是调试信息缺失，不影响功能。已确认产物正常运行。

### 5. `nsis_tauri_utils.dll` 必须手动放

tauri 的 NSIS 脚本依赖该插件（`SemverCompare` / `RunAsUser` 等宏）。Linux 上
tauri-cli 不会自动下载，需从 Windows 机器拷：

```bash
scp "$LOCALAPPDATA/tauri/NSIS/Plugins/x86-unicode/additional/nsis_tauri_utils.dll" \
    air-ubuntu:'~/.local/share/tauri/NSIS/Plugins/x86-unicode/additional/'
```

### 6. 签名要带 `--app-version`

```bash
cargo tauri signer sign --app-version 0.9.1 <file>
```

不加会警告 `Signing without an app version`，且配了 `requireSignedVersion` 的 updater
会拒绝该签名。

### 7. 私钥不要落盘到远端

脚本通过 stdin 把私钥内容传过去，远端读入环境变量后立即签名，不在文件系统留痕。

## 首次部署远端环境

```bash
ssh air-ubuntu

# Rust 目标
rustup target add x86_64-pc-windows-msvc

# 交叉编译工具
cargo install cargo-xwin --locked
cargo install tauri-cli --version "^2" --locked

# 系统依赖
apt-get install -y llvm-21 lld-21 nsis libayatana-appindicator3-dev

# bun（前端构建）
curl -fsSL https://bun.sh/install | bash
```

再把 `nsis_tauri_utils.dll` 拷过去（见上）。

## 与本机构建的取舍

| | 本机（Windows） | 远端（Linux 交叉） |
|---|---|---|
| 占用本机 CPU | 是，3–5 分钟满载 | 几乎为零 |
| 耗时 | 约 3.5 分钟（fat-LTO） | 约 2–4 分钟（32 核） |
| 适合场景 | 需要调试、快速迭代 | 发版打包、打游戏时 |

> 注：`docs/RELEASE.md` §4 里“耗时约 3 分钟（release profile 开了 LTO）”的说法已过时——
> 当时 `Cargo.toml` 的 `lto` 因换行损坏实际未生效。修好后本机全量约 3.5 分钟。

## 已知未解决

- 远端 `apt-get` 有内核包配置错误（`linux-image-7.0.0-38-generic` postinst 失败），
  不影响本项目所需工具安装，但会让 `apt-get` 返回非零退出码。属远端环境既有问题，未处理。
- `cargo-xwin` 首次构建会下载 Windows SDK（约 1 GB）到 `~/.cache/xwin`，之后复用。
