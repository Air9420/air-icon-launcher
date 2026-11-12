#!/usr/bin/env python3
"""LAN 音频接收服务托盘管理器。

管理两个 systemd 用户服务：
  - lan-audio-recv  (47800, sink lanaudio)
  - lan-mic-recv    (47801, sink lanmic)

功能：
  - 托盘图标显示两路服务的整体状态（绿=都在跑，黄=部分，红=都停了）
  - 分别 启动 / 停止 / 重启 每一路
  - 一键重启全部（改完 pipewire 配置后最常用）
  - 一键重启 OBS（pipewire 重启后 OBS 的音频采集流会断，必须重启 OBS 才重连）
  - 查看实时日志（开一个终端跑 journalctl -f）
  - 查看虚拟 sink 是否存在

依赖：python3-gi + gir1.2-ayatanaappindicator3-0.1 + GNOME 的 appindicator 扩展。
Ubuntu 上这些默认就有，无需额外安装。

用法：
    lan-tray.py            # 启动托盘
    lan-tray.py --status   # 只打印一次状态（调试用）
"""

import os
import shutil
import subprocess
import sys

import gi

gi.require_version("Gtk", "3.0")

try:
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3 as AppIndicator
except (ValueError, ImportError):  # 老系统只有 AppIndicator3
    gi.require_version("AppIndicator3", "0.1")
    from gi.repository import AppIndicator3 as AppIndicator

from gi.repository import GLib, Gtk

APP_ID = "lan-audio-tray"

# (服务名, 中文显示名, 端口, sink 名)
SERVICES = [
    ("lan-audio-recv", "主声音 (LAN-Audio)", 47800, "lanaudio"),
    ("lan-mic-recv", "麦克风 (LAN-Mic)", 47801, "lanmic"),
]

ICON_OK = "audio-card"
ICON_PARTIAL = "audio-card-symbolic"
ICON_DOWN = "audio-card"  # 配合 status=ATTENTION 变红


def run(cmd, timeout=10):
    """跑一条命令，返回 (returncode, stdout+stderr)。"""
    try:
        p = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
        )
        return p.returncode, p.stdout.strip()
    except FileNotFoundError:
        return 127, f"命令不存在: {cmd[0]}"
    except subprocess.TimeoutExpired:
        return 124, f"超时: {' '.join(cmd)}"


def systemctl(*args):
    return run(["systemctl", "--user", *args])


def is_active(unit):
    rc, out = systemctl("is-active", unit)
    return out.strip() == "active"


def sink_exists(name):
    rc, out = run(["pactl", "list", "short", "sinks"])
    return any(line.split("\t")[1:2] == [name] for line in out.splitlines())


def overall_state():
    """返回 (全部运行, 部分运行, 全部停止) 三态字符串。"""
    states = [is_active(u) for u, *_ in SERVICES]
    if all(states):
        return "all"
    if any(states):
        return "partial"
    return "none"


def notify(title, body):
    if shutil.which("notify-send"):
        run(["notify-send", "-a", "LAN 音频", "-i", ICON_OK, title, body], timeout=5)


def launch_env():
    """给子进程准备图形会话环境。

    这台机器是 **Wayland** 会话，`/tmp/.X11-unix/X0` 那份 X socket 没有对应的
    X server 在监听。写死 `DISPLAY=:0` 会让 Qt 直接崩：

        qt.qpa.xcb: could not connect to display
        This application failed to start because no Qt platform plugin
        could be initialized.

    所以必须把 DISPLAY 从环境里**删掉**，只留 WAYLAND_DISPLAY。
    """
    env = os.environ.copy()
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    env.setdefault("DBUS_SESSION_BUS_ADDRESS",
                   f"unix:path=/run/user/{os.getuid()}/bus")
    if env.get("WAYLAND_DISPLAY"):
        # 有 Wayland 就走 Wayland，别让 Qt 去试 xcb
        env.pop("DISPLAY", None)
        env.setdefault("QT_QPA_PLATFORM", "wayland")
    else:
        env.setdefault("DISPLAY", ":0")
    return env


class Tray:
    def __init__(self):
        self.indicator = AppIndicator.Indicator.new(
            APP_ID, ICON_OK, AppIndicator.IndicatorCategory.HARDWARE
        )
        self.indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self.indicator.set_title("LAN 音频接收")
        self.menu = Gtk.Menu()
        self.indicator.set_menu(self.menu)
        self.busy = False
        self.rebuild()
        # 5 秒轮询状态，服务被外部停掉也能反映到图标上
        GLib.timeout_add_seconds(5, self.on_tick)

    # ---------------------------------------------------------------- 菜单

    def rebuild(self):
        for child in self.menu.get_children():
            self.menu.remove(child)

        state = overall_state()
        if state == "all":
            self.indicator.set_icon_full(ICON_OK, "运行中")
            self.indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        elif state == "partial":
            self.indicator.set_icon_full(ICON_PARTIAL, "部分运行")
            self.indicator.set_status(AppIndicator.IndicatorStatus.ATTENTION)
        else:
            self.indicator.set_icon_full(ICON_DOWN, "已停止")
            self.indicator.set_status(AppIndicator.IndicatorStatus.ATTENTION)

        for unit, label, port, sink in SERVICES:
            active = is_active(unit)
            mark = "●" if active else "○"
            head = Gtk.MenuItem(label=f"{mark} {label}  :{port}")
            head.set_sensitive(False)
            self.menu.append(head)

            start = Gtk.MenuItem(label="　　启动")
            start.set_sensitive(not active and not self.busy)
            start.connect("activate", lambda _w, u=unit, l=label: self.act(
                ("start", u), f"正在启动 {l}"))
            self.menu.append(start)

            stop = Gtk.MenuItem(label="　　停止")
            stop.set_sensitive(active and not self.busy)
            stop.connect("activate", lambda _w, u=unit, l=label: self.act(
                ("stop", u), f"正在停止 {l}"))
            self.menu.append(stop)

            restart = Gtk.MenuItem(label="　　重启")
            restart.set_sensitive(active and not self.busy)
            restart.connect("activate", lambda _w, u=unit, l=label: self.act(
                ("restart", u), f"正在重启 {l}"))
            self.menu.append(restart)

            self.menu.append(Gtk.SeparatorMenuItem())

        restart_all = Gtk.MenuItem(label="重启全部服务")
        restart_all.set_sensitive(not self.busy)
        restart_all.connect("activate", self.on_restart_all)
        self.menu.append(restart_all)

        restart_obs = Gtk.MenuItem(label="重启 OBS（重建音频采集流）")
        restart_obs.set_sensitive(not self.busy)
        restart_obs.connect("activate", self.on_restart_obs)
        self.menu.append(restart_obs)

        self.menu.append(Gtk.SeparatorMenuItem())

        sinks = Gtk.MenuItem(label="虚拟 sink 状态")
        sinks.set_sensitive(False)
        detail = "  ".join(
            f"{s}={'有' if sink_exists(s) else '无'}" for _, _, _, s in SERVICES
        )
        sinks.set_label(f"虚拟 sink：{detail}")
        self.menu.append(sinks)

        logs = Gtk.MenuItem(label="查看日志")
        logs.connect("activate", self.on_logs)
        self.menu.append(logs)

        quit_item = Gtk.MenuItem(label="退出托盘")
        quit_item.connect("activate", lambda _w: Gtk.main_quit())
        self.menu.append(quit_item)

        self.menu.show_all()

    def on_tick(self):
        # 只在状态真正变化时重建，避免菜单闪烁
        cached = getattr(self, "_last_state", None)
        now = overall_state()
        if cached != now:
            self._last_state = now
            self.rebuild()
        return True

    # ---------------------------------------------------------------- 动作

    def act(self, op, label):
        """在后台线程里跑 systemctl，避免阻塞 GTK 主循环。"""
        verb, unit = op
        self.busy = True
        self.rebuild()

        def worker():
            rc, out = systemctl(verb, unit)
            GLib.idle_add(self.after_act, rc, out, label)

        import threading

        threading.Thread(target=worker, daemon=True).start()

    def after_act(self, rc, out, label):
        self.busy = False
        self._last_state = None
        self.rebuild()
        if rc != 0:
            notify(f"{label} 失败", out[-400:] or f"退出码 {rc}")
        return False

    def on_restart_all(self, *_args):
        self.busy = True
        self.rebuild()

        def worker():
            msgs = []
            for unit, label, *_ in SERVICES:
                rc, out = systemctl("restart", unit)
                msgs.append(f"{label}: {'ok' if rc == 0 else out[-120:]}")
            # 重启后确认 sink 还在
            for _, _, _, sink in SERVICES:
                if not sink_exists(sink):
                    msgs.append(f"警告：sink {sink} 不存在")
            GLib.idle_add(self.after_act, 0, "\n".join(msgs), "重启全部")

        import threading

        threading.Thread(target=worker, daemon=True).start()

    def on_restart_obs(self, *_args):
        self.busy = True
        self.rebuild()

        def worker():
            # flatpak 版 OBS：先 kill 再拉起
            run(["flatpak", "kill", "com.obsproject.Studio"], timeout=15)
            import time

            time.sleep(3)
            env = launch_env()
            # setsid -f 让 OBS 脱离托盘进程组，托盘退出/重启不会连带杀掉 OBS
            try:
                subprocess.Popen(
                    ["flatpak", "run", "com.obsproject.Studio"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    stdin=subprocess.DEVNULL,
                    env=env,
                    start_new_session=True,
                )
                msg = "OBS 已重新拉起，等它启动完音频流会自动重连"
            except Exception as e:  # noqa: BLE001
                msg = f"拉起 OBS 失败: {e}"
            GLib.idle_add(self.after_act, 0, msg, "重启 OBS")

        import threading

        threading.Thread(target=worker, daemon=True).start()

    def on_logs(self, *_args):
        """打开内建日志窗口。

        不走外部终端：这台机器上 gnome-terminal 根本没装，
        x-terminal-emulator 指向 ptyxis，行为还不一致。
        用 GTK TextView 直接 tail journalctl，零外部依赖。
        """
        LogWindow.open()


class LogWindow:
    """内建日志窗口：Gtk.TextView + 后台线程 tail journalctl。"""

    _instance = None

    @classmethod
    def open(cls):
        if cls._instance is not None:
            cls._instance.window.present()
            return
        cls._instance = cls()

    def __init__(self):
        self.proc = None
        self.closed = False

        self.window = Gtk.Window(title="LAN 音频服务日志")
        self.window.set_default_size(900, 520)
        self.window.connect("destroy", self.on_destroy)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)

        # 顶部工具条
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        bar.set_border_width(6)
        for label, units in (
            ("全部", [u for u, *_ in SERVICES]),
            ("仅主声音", [SERVICES[0][0]]),
            ("仅麦克风", [SERVICES[1][0]]),
        ):
            btn = Gtk.Button(label=label)
            btn.connect("clicked", lambda _b, us=units: self.restart_tail(us))
            bar.pack_start(btn, False, False, 0)
        clear_btn = Gtk.Button(label="清空")
        clear_btn.connect("clicked", self.on_clear)
        bar.pack_start(clear_btn, False, False, 0)
        box.pack_start(bar, False, False, 0)

        scroller = Gtk.ScrolledWindow()
        scroller.set_vexpand(True)
        self.view = Gtk.TextView()
        self.view.set_editable(False)
        self.view.set_cursor_visible(False)
        self.view.set_monospace(True)
        self.view.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        scroller.add(self.view)
        box.pack_start(scroller, True, True, 0)

        self.status = Gtk.Label(label="正在连接 journalctl …")
        self.status.set_xalign(0)
        self.status.set_margin_start(8)
        self.status.set_margin_end(8)
        self.status.set_margin_bottom(6)
        box.pack_start(self.status, False, False, 0)

        self.window.add(box)
        self.window.show_all()

        self.restart_tail([u for u, *_ in SERVICES])

    # -------------------------------------------------------------- 日志流

    def restart_tail(self, units):
        self.stop_tail()
        self.on_clear()

        cmd = ["journalctl", "--user", "-f", "-n", "120",
               "-o", "short-iso", "--no-pager"]
        for u in units:
            cmd += ["-u", u]

        self.status.set_text(f"跟随中：{', '.join(units)}")

        def worker():
            try:
                self.proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
            except Exception as e:  # noqa: BLE001
                GLib.idle_add(self.append, f"[启动 journalctl 失败] {e}\n")
                return
            assert self.proc.stdout is not None
            for line in self.proc.stdout:
                if self.closed:
                    break
                GLib.idle_add(self.append, line)

        import threading

        threading.Thread(target=worker, daemon=True).start()

    def stop_tail(self):
        if self.proc is not None:
            try:
                self.proc.terminate()
            except Exception:  # noqa: BLE001
                pass
            self.proc = None

    def append(self, text):
        if self.closed:
            return False
        buf = self.view.get_buffer()
        buf.insert(buf.get_end_iter(), text)
        # 只保留最后 4000 行，防止内存无限涨
        if buf.get_line_count() > 4000:
            start = buf.get_iter_at_line(max(0, buf.get_line_count() - 3000))
            buf.delete(buf.get_start_iter(), start)
        mark = buf.create_mark(None, buf.get_end_iter(), False)
        self.view.scroll_mark_onscreen(mark)
        buf.delete_mark(mark)
        return False

    def on_clear(self, *_args):
        buf = self.view.get_buffer()
        buf.set_text("")
        return False

    def on_destroy(self, *_args):
        self.closed = True
        self.stop_tail()
        LogWindow._instance = None


def print_status():
    for unit, label, port, sink in SERVICES:
        active = is_active(unit)
        print(f"{'●' if active else '○'} {label}  :{port}  "
              f"active={active}  sink={sink}={'有' if sink_exists(sink) else '无'}")
    print(f"整体状态: {overall_state()}")


def main():
    if "--status" in sys.argv:
        print_status()
        return 0

    if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
        print("没有图形会话（DISPLAY / WAYLAND_DISPLAY 都为空），托盘无法显示。",
              file=sys.stderr)
        return 1

    Gtk.init([])
    tray = Tray()  # noqa: F841  （保持引用，否则被 GC）
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
