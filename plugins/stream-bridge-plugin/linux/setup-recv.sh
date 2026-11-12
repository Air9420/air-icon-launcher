#!/usr/bin/env bash
# 副机（Linux）一键部署：建 LAN-Audio null sink + 装接收端服务 + 指向 OBS。
#
# 用法：
#   ./setup-recv.sh install      建 sink、装服务、打印 OBS 该选什么
#   ./setup-recv.sh sink         只建 null sink
#   ./setup-recv.sh status       看服务状态、sink、流路由
#   ./setup-recv.sh uninstall    撤服务与 sink
#
# 关键坑（都是实测踩到的）：
#
# 1. **null sink 必须由 PipeWire 自己建**，不能用 `pactl load-module`。
#    后者建出来的 sink 在 pipewire 重启后就消失，OBS 里会突然找不到设备。
#    正确做法是写 `~/.config/pipewire/pipewire.conf.d/*.conf`。
#
# 2. **cpal 走 ALSA 后端，PULSE_SINK 对它无效**。只设 PULSE_SINK 时
#    音频流会挂到默认 sink（板载 HDMI）上，LAN-Audio 永远是 SUSPENDED，
#    OBS 采到的就是静音。必须同时设 `PIPEWIRE_NODE=lanaudio`，
#    把流定向到那个节点。
#
# 3. **--allow 别写死主机 IP**。这台主机实际是 192.168.31.254，
#    写错成别的地址会表现为「服务在跑但一个包都不收」。

set -euo pipefail

SINK_NAME="${SINK_NAME:-lanaudio}"
SINK_DESC="${SINK_DESC:-LAN-Audio}"
PORT="${PORT:-47800}"
ALLOW_IP="${ALLOW_IP:-}"            # 主机 IP，留空 = 不限制（推荐留空）
BIN="${BIN:-/opt/lan-audio/target/release/lan-audio-recv}"
SERVICE="lan-audio-recv.service"
USER_NAME="${USER_NAME:-$(id -un)}"
UID_NUM="$(id -u "$USER_NAME")"
UNIT_DIR="/home/$USER_NAME/.config/systemd/user"
PW_CONF="/home/$USER_NAME/.config/pipewire/pipewire.conf.d/99-lanaudio.conf"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31m!!!\033[0m %s\n' "$*" >&2; exit 1; }

as_user() { runuser -u "$USER_NAME" -- env XDG_RUNTIME_DIR="/run/user/$UID_NUM" "$@"; }

write_sink_conf() {
    mkdir -p "$(dirname "$PW_CONF")"
    cat > "$PW_CONF" <<EOF
# Air Stream Bridge: OBS 采集用的虚拟 sink
# 用 PipeWire 原生方式建，比 pactl load-module 可靠：
# 后者在 pipewire 重启后就没了，OBS 里会突然找不到设备。
context.objects = [
    {   factory = adapter
        args = {
            factory.name           = support.null-audio-sink
            node.name              = "$SINK_NAME"
            node.description       = "$SINK_DESC"
            media.class            = Audio/Sink
            object.linger          = true
            audio.position         = [ FL FR ]
            monitor.channel-volumes = true
        }
    }
]
EOF
    chown -R "$USER_NAME":"$USER_NAME" "/home/$USER_NAME/.config/pipewire"
    log "写入 $PW_CONF"
}

reload_pipewire() {
    as_user systemctl --user restart pipewire
    sleep 2
    as_user pactl list short sinks | grep -q "$SINK_NAME" \
        || die "sink '$SINK_NAME' 没建起来，看 journalctl --user -u pipewire"
    log "sink '$SINK_NAME' 就绪"
}

write_unit() {
    [ -x "$BIN" ] || die "找不到 $BIN（先 cargo build --release 并把二进制放好）"
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/$SERVICE" <<EOF
[Unit]
Description=LAN audio receiver (Air Stream Bridge)
After=pipewire-pulse.service
Wants=pipewire-pulse.service

[Service]
Type=simple
# 这两个都要：PULSE_SINK 是给 PulseAudio 客户端的提示，
# PIPEWIRE_NODE 才是真正把流钉到 LAN-Audio 节点的那个。
Environment=PIPEWIRE_NODE=$SINK_NAME
Environment=PULSE_SINK=$SINK_NAME
ExecStart=$BIN --bind 0.0.0.0:$PORT --device PulseAudio --target-ms 6 --min-target-ms 3${ALLOW_IP:+ --allow $ALLOW_IP}
Restart=always
RestartSec=2
Nice=-10

[Install]
WantedBy=default.target
EOF
    chown -R "$USER_NAME":"$USER_NAME" "$UNIT_DIR"
    as_user systemctl --user daemon-reload
    as_user systemctl --user enable --now "$SERVICE"
    log "服务已启动：systemctl --user status $SERVICE"
}

case "${1:-}" in
    install)
        write_sink_conf
        reload_pipewire
        write_unit
        cat <<EOF

下一步（在 OBS 里）：
  1. 添加源 → 「音频输出采集 (PulseAudio)」
  2. 属性里把设备改成  **Monitor of $SINK_DESC**
  3. 高级音频属性里确认这个源的监听是「仅监听关闭 / 输出开启」

OBS 是 Flatpak 的话不用额外授权，它默认带 pulseaudio socket
和 xdg-run/pipewire-0 权限，能看到宿主机新建的 sink。
EOF
        ;;
    sink)
        write_sink_conf; reload_pipewire ;;
    status)
        as_user systemctl --user --no-pager status "$SERVICE" || true
        echo
        as_user pactl list short sinks
        echo "--- 音频流路由（关键：output 要指向 $SINK_NAME:playback）---"
        as_user wpctl status 2>/dev/null | sed -n '/Streams:/,/Video/p' | head -20
        ;;
    uninstall)
        as_user systemctl --user disable --now "$SERVICE" 2>/dev/null || true
        rm -f "$UNIT_DIR/$SERVICE" "$PW_CONF"
        as_user systemctl --user daemon-reload
        as_user systemctl --user restart pipewire || true
        log "已卸载"
        ;;
    *)
        sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
