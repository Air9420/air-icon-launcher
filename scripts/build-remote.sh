#!/usr/bin/env bash
# 在 Linux 主机（air-ubuntu / 192.168.31.66）交叉编译 Windows 版 exe。
#
# 用途：本机打游戏时不想被编译占满 CPU，把 Rust 编译负载丢给局域网 Linux 机器。
# 产物：src-tauri/target-remote/air-icon-launcher_x.y.z_x64-setup.exe
#
# ⚠️ tauri-cli 2.12 起远端不再能产出 NSIS 安装包（--no-bundle 不再生成 installer.nsi，
#    Linux 宿主也不接受 --bundles nsis）。打包 + 签名必须回本机做，见脚本末尾提示。
#
# 用法：
#   bash scripts/build-remote.sh              # 完整流程（同步 + 编译 + 取回）
#   bash scripts/build-remote.sh --no-sync    # 跳过代码同步（复用远端已有代码）
#
# 前置条件（首次需在远端执行一次，脚本会自检并提示）：
#   - rustup target add x86_64-pc-windows-msvc
#   - cargo install cargo-xwin --locked
#   - cargo install tauri-cli --version "^2" --locked
#   - apt-get install -y llvm-21 lld-21 nsis libayatana-appindicator3-dev
#   - bun（curl -fsSL https://bun.sh/install | bash）

set -euo pipefail

# ---------- 配置 ----------
HOST="${BUILD_HOST:-air-ubuntu}"
REMOTE_DIR="${BUILD_REMOTE_DIR:-/root/air-build}"
LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$LOCAL_ROOT/src-tauri/target-remote"

DO_SYNC=1
for arg in "$@"; do
  case "$arg" in
    --no-sync) DO_SYNC=0 ;;
    --no-sign) : ;;  # 兼容旧调用，签名现在恒在本机做
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
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
command -v llvm-lib     >/dev/null || miss="$miss llvm"
rustup target list --installed 2>/dev/null | grep -q x86_64-pc-windows-msvc || miss="$miss msvc-target"
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
    apt-get install -y llvm-21 lld-21 libayatana-appindicator3-dev'"
fi

# ---------- 3. 同步代码 ----------
# 注意：tar 只覆盖不删除，必须先清掉远端源码目录，否则本地已删/改名的文件会残留，
#       导致类型检查报「已删文件里的旧引用」。
if [ "$DO_SYNC" = 1 ]; then
  log "同步代码到 $HOST:$REMOTE_DIR"
  ssh -o BatchMode=yes "$HOST" \
      "mkdir -p '$REMOTE_DIR' && rm -rf '$REMOTE_DIR/src' '$REMOTE_DIR/src-tauri/src' '$REMOTE_DIR/scripts'"
  tar -czf - -C "$LOCAL_ROOT" \
      --exclude='./node_modules' --exclude='./target' --exclude='./.git' \
      --exclude='./dist' --exclude='./.artifacts' --exclude='./.trae' \
      --exclude='./.codex' --exclude='./.superpowers' \
      --exclude='./src-tauri/target' --exclude='./src-tauri/target-*' \
      --exclude='*.key' --exclude='.env.local' \
      . 2>/dev/null \
    | ssh -o BatchMode=yes "$HOST" "tar -xzf - -C '$REMOTE_DIR'"
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

# 前端构建 + Rust 交叉编译。
# --no-bundle 绕过 tauri-cli 在 Linux 上拒绝 nsis 的限制。
# 注意：tauri-cli 2.12 起不再生成 installer.nsi，NSIS 打包改在本机做
#       （见 docs/BUILD-REMOTE.md「当前推荐流程」）。
bun tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle

EXE=src-tauri/target/x86_64-pc-windows-msvc/release/air-icon-launcher.exe
VER=\$(grep -m1 '^version' src-tauri/Cargo.toml | cut -d'"' -f2)
mkdir -p out
cp "\$EXE" "out/air-icon-launcher_\${VER}_x64-setup.exe"
echo "REMOTE_VER=\$VER"
EOF

# ---------- 5. 签名 ----------
# 远端只产出 exe，不再生成 nsis.zip，因此签名改在本机 tauri bundle 阶段完成。
# 保留 --no-sign 参数以兼容旧调用（现在恒为不签）。
REMOTE_VER=$(ssh -o BatchMode=yes "$HOST" "grep -m1 '^version' '$REMOTE_DIR/src-tauri/Cargo.toml' | cut -d'\"' -f2")
log "版本号: $REMOTE_VER"

# ---------- 6. 取回产物 ----------
log "取回产物到 $OUT_DIR"
mkdir -p "$OUT_DIR"
scp -q "$HOST:$REMOTE_DIR/out/*" "$OUT_DIR/"

log "完成。远端产物："
ls -lh "$OUT_DIR" | tail -n +2

cat <<'NEXT'

下一步（本机打包 + 签名，tauri-cli 2.12 起必须在本机做）：

  cp src-tauri/target-remote/air-icon-launcher_VER_x64-setup.exe \
     src-tauri/target/release/air-icon-launcher.exe
  export TAURI_SIGNING_PRIVATE_KEY="$(cat private-new.key)"
  bun tauri bundle --bundles nsis

产物在 src-tauri/target/release/bundle/nsis/。
详见 docs/BUILD-REMOTE.md「当前推荐流程」。
NEXT
