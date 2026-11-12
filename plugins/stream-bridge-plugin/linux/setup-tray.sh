#!/usr/bin/env bash
# 副机（Linux）托盘管理器安装脚本。
#
# 托盘能做什么：
#   - 一眼看到两路接收服务是否在跑（绿/黄/红图标）
#   - 分别 启动 / 停止 / 重启 lan-audio-recv 与 lan-mic-recv
#   - 一键重启全部（改完 pipewire 配置后最常用）
#   - 一键重启 OBS（pipewire 重启后 OBS 的音频采集流会断，必须重启才重连）
#   - 查看 journalctl 实时日志
#
# 用法（普通用户直接跑，不需要 sudo）：
#   ./setup-tray.sh install     安装并立即启动托盘 + 开机自启
#   ./setup-tray.sh status      看托盘服务状态
#   ./setup-tray.sh uninstall   卸载托盘
#
# 开机自启原理：
#   托盘是个 systemd **用户**服务，绑 graphical-session.target —— 登录桌面就起，
#   注销就退。接收端服务是 WantedBy=default.target，配合 linger 已经能在
#   开机后不登录也跑。两者组合 = 重启 Linux 后什么都不用手动敲。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRAY_SRC="$HERE/lan-tray.py"
UNIT_SRC="$HERE/lan-tray.service.in"

# 以 root 跑时用 SUDO_USER，否则就是当前用户
if [ "$(id -u)" -eq 0 ]; then
    USER_NAME="${USER_NAME:-${SUDO_USER:-root}}"
else
    USER_NAME="${USER_NAME:-$(id -un)}"
fi
UID_NUM="$(id -u "$USER_NAME")"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
UNIT_DIR="$HOME_DIR/.config/systemd/user"
TRAY_DEST="${TRAY_DEST:-$HOME_DIR/.local/bin/lan-tray.py}"
SERVICE="lan-tray.service"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31m!!!\033[0m %s\n' "$*" >&2; exit 1; }

# 以目标用户身份跑命令。本人执行时直接用，别走 runuser（那要 root）。
as_user() {
    if [ "$(id -u)" -eq "$UID_NUM" ]; then
        env XDG_RUNTIME_DIR="/run/user/$UID_NUM" "$@"
    else
        runuser -u "$USER_NAME" -- env XDG_RUNTIME_DIR="/run/user/$UID_NUM" "$@"
    fi
}

check_deps() {
    [ -f "$TRAY_SRC" ] || die "找不到 $TRAY_SRC"
    [ -f "$UNIT_SRC" ] || die "找不到 $UNIT_SRC"

    command -v python3 >/dev/null 2>&1 || die "没有 python3"

    if ! python3 -c 'import gi; gi.require_version("Gtk","3.0"); from gi.repository import Gtk' 2>/dev/null; then
        die "缺 python3-gi 或 GTK3 绑定。Ubuntu 上装：
    sudo apt install python3-gi gir1.2-gtk-3.0"
    fi

    if ! python3 -c 'import gi; gi.require_version("AyatanaAppIndicator3","0.1")' 2>/dev/null &&
       ! python3 -c 'import gi; gi.require_version("AppIndicator3","0.1")' 2>/dev/null; then
        die "缺 AppIndicator 绑定。sudo apt install gir1.2-ayatanaappindicator3-0.1"
    fi

    # GNOME 必须有 appindicator 扩展，否则托盘图标不会出现
    if command -v gnome-extensions >/dev/null 2>&1; then
        if as_user gnome-extensions list --enabled 2>/dev/null | grep -qi appindicator; then
            log "GNOME appindicator 扩展已启用"
        else
            log "警告：GNOME 没启用 appindicator 扩展，托盘图标不会显示。
    启用：gnome-extensions enable ubuntu-appindicators@ubuntu.com"
        fi
    fi
    log "依赖检查通过"
}

install_tray() {
    mkdir -p "$(dirname "$TRAY_DEST")"
    install -m 755 "$TRAY_SRC" "$TRAY_DEST"
    log "已安装 $TRAY_DEST"

    # 从当前图形会话里取真实的 DISPLAY / WAYLAND_DISPLAY，
    # 写死 ":0" 在有些机器上是 :1，会导致托盘起不来。
    local disp way
    disp="$(as_user printenv DISPLAY 2>/dev/null || true)"
    way="$(as_user printenv WAYLAND_DISPLAY 2>/dev/null || true)"
    [ -n "$disp" ] || disp=":0"
    [ -n "$way" ] || way="wayland-0"

    mkdir -p "$UNIT_DIR"
    sed -e "s|__UID__|$UID_NUM|g" \
        -e "s|__DISPLAY__|$disp|g" \
        -e "s|__WAYLAND__|$way|g" \
        -e "s|__TRAY_PY__|$TRAY_DEST|g" \
        "$UNIT_SRC" > "$UNIT_DIR/$SERVICE"

    if [ "$(id -u)" -eq 0 ]; then
        chown -R "$USER_NAME":"$USER_NAME" "$UNIT_DIR" "$(dirname "$TRAY_DEST")"
    fi
    log "已写入 $UNIT_DIR/$SERVICE  （DISPLAY=$disp WAYLAND_DISPLAY=$way）"

    as_user systemctl --user daemon-reload
    as_user systemctl --user enable --now "$SERVICE"
    sleep 2
    if as_user systemctl --user is-active --quiet "$SERVICE"; then
        log "托盘已启动，看屏幕右上角"
    else
        log "托盘没起来，看日志：journalctl --user -u $SERVICE -n 40"
    fi
}

ensure_linger() {
    # 没有 linger 的话，用户服务只在登录后才跑；开了之后开机即跑，
    # 接收端在没人登录桌面时也能收流。
    local cur
    cur="$(loginctl show-user "$USER_NAME" -p Linger --value 2>/dev/null || echo no)"
    if [ "$cur" = "yes" ]; then
        log "linger 已开启（开机不登录也跑服务）"
        return
    fi
    if [ "$(id -u)" -eq 0 ]; then
        loginctl enable-linger "$USER_NAME" && log "已开启 linger"
    else
        log "提示：想让接收端在没人登录桌面时也收流，执行
    sudo loginctl enable-linger $USER_NAME"
    fi
}

case "${1:-}" in
    install)
        check_deps
        ensure_linger
        install_tray
        cat <<EOF

托盘用法：
  图标悬停  看整体状态
  左键点击  展开菜单（每路服务独立的 启动/停止/重启）
  菜单底部  「重启全部服务」「重启 OBS」「查看日志」「退出托盘」

常用命令：
  systemctl --user status lan-tray        # 托盘自己
  systemctl --user status lan-audio-recv  # 主声音
  systemctl --user status lan-mic-recv    # 麦克风
  journalctl --user -u lan-audio-recv -f  # 跟日志
EOF
        ;;
    status)
        as_user systemctl --user --no-pager status "$SERVICE" || true
        echo "--- 接收端 ---"
        as_user systemctl --user --no-pager is-active lan-audio-recv lan-mic-recv || true
        ;;
    uninstall)
        as_user systemctl --user disable --now "$SERVICE" 2>/dev/null || true
        rm -f "$UNIT_DIR/$SERVICE" "$TRAY_DEST"
        as_user systemctl --user daemon-reload
        log "已卸载托盘"
        ;;
    *)
        sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
