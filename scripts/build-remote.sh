#!/usr/bin/env bash
# 在 Linux 主机（air-ubuntu / 192.168.31.66）交叉编译 Windows 版安装包。
#
# 用途：本机打游戏时不想被编译占满 CPU，把编译负载丢给局域网 Linux 机器。
# 产物：src-tauri/target-remote/ 下的 setup.exe + nsis.zip + .sig
#
# 用法：
#   bash scripts/build-remote.sh              # 完整构建（含 NSIS 打包 + 签名）
#   bash scripts/build-remote.sh --no-sign    # 跳过签名（仅本地验证）
#   bash scripts/build-remote.sh --no-sync    # 跳过代码同步（复用远端已有代码）
#
# 前置条件（首次需在远端执行一次，脚本会自检并提示）：
#   - rustup target add x86_64-pc-windows-msvc
#   - cargo install cargo-xwin --locked
#   - cargo install tauri-cli --version "^2" --locked
#   - apt-get install -y llvm-21 lld-21 nsis libayatana-appindicator3-dev
#   - bun（curl -fsSL https://bun.sh/install | bash）
#   - nsis_tauri_utils.dll 需放到 ~/.local/share/tauri/NSIS/Plugins/x86-unicode/additional/

set -euo pipefail

# ---------- 配置 ----------
HOST="${BUILD_HOST:-air-ubuntu}"
REMOTE_DIR="${BUILD_REMOTE_DIR:-/root/air-build}"
LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$LOCAL_ROOT/src-tauri/target-remote"

DO_SYNC=1
DO_SIGN=1
for arg in "$@"; do
  case "$arg" in
    --no-sync) DO_SYNC=0 ;;
    --no-sign) DO_SIGN=0 ;;
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31m错误:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. 连通性检查 ----------
log "检查 SSH 连通性: $HOST"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" true 2>/dev/null \
  || die "无法免密 SSH 到 $HOST。请先配置 ~/.ssh/config 或 ssh-copy-id 部署公钥。"

# ---------- 2. 远端环境自检 ----------
log "检查远端工具链"
MISSING=$(ssh -o BatchMode=yes "$HOST" 'bash -s' <<'EOF'
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:/usr/lib/llvm-21/bin:$PATH"
miss=""
command -v bun          >/dev/null || miss="$miss bun"
command -v cargo-xwin   >/dev/null || miss="$miss cargo-xwin"
command -v cargo-tauri  >/dev/null || miss="$miss tauri-cli"
command -v makensis     >/dev/null || miss="$miss nsis"
command -v llvm-lib     >/dev/null || miss="$miss llvm"
rustup target list --installed 2>/dev/null | grep -q x86_64-pc-windows-msvc || miss="$miss msvc-target"
ls "$HOME/.local/share/tauri/NSIS/Plugins/x86-unicode/additional/nsis_tauri_utils.dll" >/dev/null 2>&1 || miss="$miss nsis-tauri-plugin"
echo "$miss"
EOF
)
if [ -n "${MISSING// /}" ]; then
  die "远端缺少组件:$MISSING
首次部署请执行：
  ssh $HOST 'export PATH=\$HOME/.bun/bin:\$HOME/.cargo/bin:/usr/lib/llvm-21/bin:\$PATH
    rustup target add x86_64-pc-windows-msvc
    cargo install cargo-xwin --locked
    cargo install tauri-cli --version \"^2\" --locked
    apt-get install -y llvm-21 lld-21 nsis libayatana-appindicator3-dev'
（nsis_tauri_utils.dll 见 docs/BUILD-REMOTE.md）"
fi

# ---------- 3. 同步代码 ----------
if [ "$DO_SYNC" = 1 ]; then
  log "同步代码到 $HOST:$REMOTE_DIR"
  tar -czf - -C "$LOCAL_ROOT" \
      --exclude='./node_modules' --exclude='./target' --exclude='./.git' \
      --exclude='./dist' --exclude='./.artifacts' --exclude='./.trae' \
      --exclude='./.codex' --exclude='./.superpowers' \
      --exclude='./src-tauri/target' --exclude='./src-tauri/target-*' \
      --exclude='*.key' --exclude='.env.local' \
      . 2>/dev/null \
    | ssh -o BatchMode=yes "$HOST" "mkdir -p '$REMOTE_DIR' && tar -xzf - -C '$REMOTE_DIR'"
else
  log "跳过同步，使用远端已有代码"
fi

# ---------- 4. 远端编译 ----------
log "远端交叉编译（x86_64-pc-windows-msvc, release, fat-LTO）"
ssh -o BatchMode=yes "$HOST" 'bash -s' <<EOF
set -euo pipefail
export PATH="\$HOME/.bun/bin:\$HOME/.cargo/bin:/usr/lib/llvm-21/bin:\$PATH"
export AR_x86_64_pc_windows_msvc=llvm-lib
cd '$REMOTE_DIR'

# 前端依赖（bun 已装则秒过）
bun install --silent

# 前端构建 + Rust 交叉编译（--no-bundle 绕过 tauri-cli 在 Linux 上拒绝 nsis 的限制）
bun tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle

# NSIS 打包：用 tauri 生成的 .nsi，改路径后直接 makensis
NSI_DIR=src-tauri/target/x86_64-pc-windows-msvc/release/nsis/x64
EXE=src-tauri/target/x86_64-pc-windows-msvc/release/air-icon-launcher.exe
mkdir -p out
sed -i "s|^!define MAINBINARYSRCPATH .*|!define MAINBINARYSRCPATH \"\$PWD/\$EXE\"|"  "\$NSI_DIR/installer.nsi"
sed -i "s|^!define ADDITIONALPLUGINSPATH .*|!define ADDITIONALPLUGINSPATH \"\$HOME/.local/share/tauri/NSIS/Plugins/x86-unicode/additional\"|" "\$NSI_DIR/installer.nsi"
sed -i 's|^!include "Z:.*SimpChinese.nsh"|!include "SimpChinese.nsh"|' "\$NSI_DIR/installer.nsi"
VER=\$(grep -m1 '^version' src-tauri/Cargo.toml | cut -d'"' -f2)
sed -i "s|^!define OUTFILE .*|!define OUTFILE \"\$PWD/out/air-icon-launcher_\${VER}_x64-setup.exe\"|" "\$NSI_DIR/installer.nsi"

cd "\$NSI_DIR" && makensis -V2 installer.nsi && cd '$REMOTE_DIR'

# 更新包 zip（nsis.zip 是 setup.exe 的 zip，Tauri updater 用）
cd out
ZIP="air-icon-launcher_\${VER}_x64-setup.nsis.zip"
zip -q -9 "\$ZIP" "air-icon-launcher_\${VER}_x64-setup.exe"
cd '$REMOTE_DIR'
echo "REMOTE_VER=\$VER"
EOF

# ---------- 5. 签名（可选） ----------
REMOTE_VER=$(ssh -o BatchMode=yes "$HOST" "grep -m1 '^version' '$REMOTE_DIR/src-tauri/Cargo.toml' | cut -d'\"' -f2")
log "版本号: $REMOTE_VER"

if [ "$DO_SIGN" = 1 ]; then
  KEY_FILE="$LOCAL_ROOT/private-new.key"
  [ -f "$KEY_FILE" ] || die "找不到签名私钥 $KEY_FILE"
  : "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:?请先设置 TAURI_SIGNING_PRIVATE_KEY_PASSWORD 环境变量（见 .env.local）}"
  log "在远端签名（私钥经 stdin 传入，不写入远端磁盘）"

  # 远端签名脚本：从 stdin 读私钥，密码走环境变量
  cat > /tmp/_dsh_sign_remote.sh <<'REMOTE_SIGN'
export PATH="$HOME/.cargo/bin:$PATH"
export TAURI_SIGNING_PRIVATE_KEY="$(cat)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$PASS"
cd "$REMOTE_DIR/out"
cargo tauri signer sign --app-version "$VER" "air-icon-launcher_${VER}_x64-setup.nsis.zip"
REMOTE_SIGN

  scp -q /tmp/_dsh_sign_remote.sh "$HOST:/tmp/_dsh_sign_remote.sh"
  cat "$KEY_FILE" | ssh -o BatchMode=yes "$HOST" \
      "REMOTE_DIR='$REMOTE_DIR' VER='$REMOTE_VER' PASS='$TAURI_SIGNING_PRIVATE_KEY_PASSWORD' bash /tmp/_dsh_sign_remote.sh"
  ssh -o BatchMode=yes "$HOST" "rm -f /tmp/_dsh_sign_remote.sh"
  rm -f /tmp/_dsh_sign_remote.sh
fi

# ---------- 6. 取回产物 ----------
log "取回产物到 $OUT_DIR"
mkdir -p "$OUT_DIR"
scp -q "$HOST:$REMOTE_DIR/out/*" "$OUT_DIR/"

log "完成。产物："
ls -lh "$OUT_DIR" | tail -n +2
