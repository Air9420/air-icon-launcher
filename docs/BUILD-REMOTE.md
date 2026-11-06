# 远程交叉编译（Linux → Windows）

本机打游戏时不想被 `cargo build` 占满 CPU，可以把 Windows 安装包的 Rust 编译丢给局域网
Linux 主机 `air-ubuntu`（`192.168.31.66`，32 核 / 30G）。

> ⚠️ **2026-11-07 更新（v0.10.0 实测）**：tauri-cli 2.12 起 `--no-bundle` 不再生成
> `installer.nsi`，脚本里那套「改 nsi 路径再 makensis」的绕过路径**已失效**。
> 现在改为：**远端只编译 exe，回传本机后用 `tauri bundle` 打包 + 签名**。
> 详见下方「当前推荐流程」。

## 当前推荐流程（v0.10.0 起）

```bash
cd Z:\VScodeProject\air-icon-launcher

# 1) 载入凭据
set -a && . ./.env.local && set +a

# 2) 远端只编译 exe（--no-sign 跳过远端签名，签名改在本机做）
bash scripts/build-remote.sh --no-sign

# 3) 取回 exe 覆盖本机产物
scp air-ubuntu:/root/air-build/src-tauri/target/x86_64-pc-windows-msvc/release/air-icon-launcher.exe \
    src-tauri/target/release/air-icon-launcher.exe

# 4) 本机打包 + 签名
export TAURI_SIGNING_PRIVATE_KEY="$(cat private-new.key)"
bun tauri bundle --bundles nsis
```

产物在 `src-tauri/target/release/bundle/nsis/`（不是 `target-remote/`）。

> 实测耗时：远端编译 **2 分 21 秒**（14.4 MB exe），本机 bundle + 签名约 10 秒。

> ⚠️ **同步前必须清远端源码目录**：`build-remote.sh` 用 tar 覆盖，**不删除**远端已有文件。
> 删掉或重命名的源文件会残留，导致类型检查报「已删文件里的旧引用」。
> 构建异常时先清一次：
>
> ```bash
> ssh air-ubuntu "rm -rf /root/air-build/src /root/air-build/src-tauri/src"
> ```

## 快速开始（旧流程，仅 tauri-cli < 2.12 可用）

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
| NSIS 安装包 | ✅ v0.10.0：4.99 MB（本机 `tauri bundle` 生成） |
| 签名校验 | ✅ `Signature and comment signature verified`，绑定 `version:0.10.0` |
| 全量耗时 | 远端编译 2m21s + 本机打包 10s |

## 关键约束与坑位

### 1. Linux 宿主不能打 NSIS 包

```
error: invalid value 'nsis' for '--bundles [<BUNDLES>...]'
  [possible values: deb, rpm, appimage]
```

tauri-cli 按**宿主平台**决定可用 bundle 类型，Linux 宿主只认 deb/rpm/appimage。

**当前解法**：远端 `--no-bundle` 只出 exe → 回传本机 → 本机 `tauri bundle --bundles nsis`。
见文档顶部「当前推荐流程」。

> ⚠️ **旧解法已失效**（tauri-cli < 2.12 时代）：以前 `--no-bundle` 仍会生成
> `src-tauri/target/<target>/release/nsis/x64/installer.nsi`，可以改路径后直接 `makensis`。
> 2.12 起该文件不再生成，`scripts/build-remote.sh` 里的 `sed ... installer.nsi` 会报
> `没有那个文件或目录`。**不要再依赖这条路径。**

<details>
<summary>旧解法留档（tauri-cli &lt; 2.12）</summary>

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

</details>

### 1b. 远端源码残留导致构建失败

`build-remote.sh` 用 `tar -czf - | ssh tar -xzf -` 同步，**只覆盖、不删除**。
本地删掉或重命名的文件会残留在远端，典型症状：

```
src/components/UpdateDialog.vue(12,25): error TS2339: Property 'showUpdateDialog' does not exist
```

该文件本地已删除，远端还留着旧版。**解法**：构建前清远端源码目录。

```bash
ssh air-ubuntu "rm -rf /root/air-build/src /root/air-build/src-tauri/src"
```

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
cargo tauri signer sign --app-version 0.10.0 <file>
```

不加会警告 `Signing without an app version`，且配了 `requireSignedVersion` 的 updater
会拒绝该签名。

> 现在签名在本机 `tauri bundle --bundles nsis` 阶段自动完成，版本号取自
> `src-tauri/Cargo.toml`，不需要手动调 signer。只有旧流程（`build-remote.sh` 带签名）才用到这条。

### 7. 私钥不要落盘到远端

旧流程脚本通过 stdin 把私钥内容传过去，远端读入环境变量后立即签名，不在文件系统留痕。

新流程（推荐）签名在本机做，私钥根本不出本机。

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

> 新流程下远端只跑 `tauri build --no-bundle`（不出 NSIS 包），`nsis_tauri_utils.dll`
> 和 `nsis` 包其实已不是必需；保留是为了兼容旧流程。

## 与本机构建的取舍

| | 本机（Windows） | 远端（Linux 交叉） |
|---|---|---|
| 占用本机 CPU | 是，5–6 分钟满载 | 几乎为零 |
| Rust 编译耗时 | 约 6 分钟（fat-LTO） | 约 2.5 分钟（32 核） |
| 需要额外步骤 | 无 | 回传 exe + 本机 bundle（约 10 秒） |
| 适合场景 | 需要调试、快速迭代 | 发版打包、打游戏时 |

> v0.10.0 实测：本机全量 `bun tauri build` 6 分钟；远端编译 2m21s + 本机 bundle 10s ≈ 2.5 分钟。

## 已知未解决

- 远端 `apt-get` 有内核包配置错误（`linux-image-7.0.0-38-generic` postinst 失败），
  不影响本项目所需工具安装，但会让 `apt-get` 返回非零退出码。属远端环境既有问题，未处理。
- `cargo-xwin` 首次构建会下载 Windows SDK（约 1 GB）到 `~/.cache/xwin`，之后复用。
