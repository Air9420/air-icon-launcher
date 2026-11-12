"""最小 ABI 宿主：用 ctypes 加载 air_stream_bridge.dll，按 ABI v1 调用。

用途：在不启动 Tauri 的情况下验证
  - DLL 能加载、导出符号齐全
  - air_plugin_init 能拿到 vtable
  - invoke 分发、错误信封、settings 读写
  - 推流线程与隐私线程能起来、能停、卸载后不崩

用法：
    python tools/plugin-smoke.py [dll路径]
"""

import ctypes
import json
import sys
import time

DLL = sys.argv[1] if len(sys.argv) > 1 else (
    r"Z:\VScodeProject\air-icon-launcher\plugins\stream-bridge-plugin"
    r"\target\release\air_stream_bridge.dll"
)

LOG = []
LOGS = []

# host_invoke 返回的缓冲必须活到插件拷完为止，所以留在模块级
_KEEP = []


def log_cb(user_data, level, msg):
    LOGS.append((level, msg.decode("utf-8", "replace")))
    if len(LOGS) > 5000:
        del LOGS[:2000]


def host_invoke_cb(user_data, method, args):
    """宿主能力分发的最小实现：log 与 events.emit 都回成功信封。"""
    m = method.decode("utf-8", "replace")
    if m.startswith("log"):
        payload = json.dumps({"ok": True, "data": {"logged": True}})
    elif m.startswith("events."):
        payload = json.dumps({"ok": True, "data": {"emitted": True}})
    else:
        payload = json.dumps(
            {
                "ok": False,
                "error": {"code": "capability_denied", "message": f"no capability for {m}"},
            }
        )
    buf = ctypes.create_string_buffer(payload.encode())
    _KEEP.append(buf)
    if len(_KEEP) > 256:
        del _KEEP[:128]
    return ctypes.cast(buf, ctypes.c_void_p).value


LOG_FN = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p)
INVOKE_FN = ctypes.CFUNCTYPE(
    ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p
)


class VTable(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("user_data", ctypes.c_void_p),
        ("log", LOG_FN),
        ("host_invoke", INVOKE_FN),
    ]


def main():
    lib = ctypes.CDLL(DLL)
    lib.air_plugin_abi_version.restype = ctypes.c_uint32
    # 必须用 c_void_p 接指针：restype=c_char_p 会把指针转成 Python bytes，
    # 之后 free_string 拿到的是 Python 缓冲区的地址，等于往堆上乱放。
    lib.air_plugin_manifest.restype = ctypes.c_void_p
    lib.air_plugin_free_string.argtypes = [ctypes.c_void_p]
    lib.air_plugin_free_string.restype = None

    abi = lib.air_plugin_abi_version()
    print(f"[abi] version = {abi}")
    assert abi == 1, "ABI 版本不符"

    raw_ptr = lib.air_plugin_manifest()
    manifest = json.loads(ctypes.string_at(raw_ptr).decode("utf-8"))
    lib.air_plugin_free_string(raw_ptr)
    print(f"[abi] manifest id = {manifest['id']}  entry = {manifest['entry']}")
    print(f"[abi] settings 项数 = {len(manifest['contributes']['settings'])}")

    keep = (ctypes.c_char * 8)()
    # 回调对象必须留引用：VTable 里只存函数指针，
    # CFUNCTYPE 实例被 GC 掉后插件再回调就是跳进已释放的 trampoline。
    global _LOG_CB, _INVOKE_CB
    _LOG_CB = LOG_FN(log_cb)
    _INVOKE_CB = INVOKE_FN(host_invoke_cb)
    vt = VTable(
        abi_version=1,
        user_data=ctypes.cast(ctypes.pointer(keep), ctypes.c_void_p),
        log=_LOG_CB,
        host_invoke=_INVOKE_CB,
    )

    lib.air_plugin_init.argtypes = [ctypes.POINTER(VTable), ctypes.c_void_p]
    lib.air_plugin_init.restype = ctypes.c_int
    rc = lib.air_plugin_init(ctypes.byref(vt), None)
    print(f"[init] rc = {rc}")
    assert rc == 0, "init 失败"

    lib.air_plugin_invoke.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
    lib.air_plugin_invoke.restype = ctypes.c_void_p

    def call(method, args=None):
        a = json.dumps(args or {}).encode()
        ptr = lib.air_plugin_invoke(method.encode(), a)
        assert ptr, f"{method} 返回空指针"
        s = ctypes.string_at(ptr).decode("utf-8")
        lib.air_plugin_free_string(ptr)
        return json.loads(s)

    # ---- 配置 ----
    r = call("settings.get")
    print(f"[settings.get] ok={r['ok']} dest={r['data']['audio_dest']}")
    assert r["ok"]

    r = call("settings.set", {"obs_mode": "bogus"})
    print(f"[settings.set 非法值] ok={r['ok']} code={r.get('error', {}).get('code')}")
    assert not r["ok"], "非法 obs_mode 应被拒绝"

    # ---- 未启动时的状态 ----
    r = call("audio_status")
    print(f"[audio_status 未启动] running={r['data']['running']}")
    assert not r["data"]["running"]

    r = call("privacy_status")
    fg = r["data"]["foreground"]
    print(
        f"[privacy_status] watching={r['data']['watching']} "
        f"前台={fg['process'] or '(空)'} class={fg['class'] or '(空)'} "
        f"fullscreen={fg['fullscreen']} rect={fg['window_rect']} mon={fg['monitor_rect']}"
    )

    # ---- 启动推流（真实采集；副机地址不可达也应正常启动）----
    r = call("settings.set", {"audio_dest": "127.0.0.1:47800"})
    assert r["ok"], r

    r = call("audio_devices")
    devs = r["data"]["devices"]
    print("[audio_devices] " + " / ".join(
        f"{d['name']}{'(默认)' if d['default'] else ''}" for d in devs))

    r = call("audio_start")
    print(f"[audio_start] ok={r['ok']} {r.get('data') or r.get('error')}")
    if r["ok"]:
        time.sleep(2.5)
        s = call("audio_status")["data"]
        print(
            f"[audio_status] running={s['running']} endpoint={s['endpoint']!r} "
            f"period={s['device_period_ms']}ms pkts={s['packets']} "
            f"frames={s['frames']} silent={s['silent_packets']} "
            f"lag={s['capture_lag_ms']}ms err={s['last_error']!r}"
        )
        assert s["running"], "推流未进入运行态"
        # 端点空闲时 WASAPI 环回不投递数据，此时只有 keepalive 静音包，
        # 所以「包数 > 0」才是链路健康的判据，帧数要看有没有真实播放。
        assert s["packets"] > 0, "两秒内没有任何包发出"
        if s["frames"] == 0:
            assert s["silent_packets"] > 0, "既无音频帧也无静音包"
            print("    （该端点当前无音频播放，只有 keepalive 静音包，属正常）")
        else:
            assert s["frames"] > 40_000, f"帧数偏低: {s['frames']}"

        r = call("audio_stop")
        print(f"[audio_stop] ok={r['ok']}")

    # ---- 隐私监视 + OBS 通道（OBS 不在线，指令应只是记日志不崩）----
    r = call("settings.set", {"privacy_poll_ms": 100, "privacy_debounce_ms": 100})
    assert r["ok"], r
    r = call("privacy_start")
    print(f"[privacy_start] ok={r['ok']} {r.get('data') or r.get('error')}")
    if r["ok"]:
        time.sleep(1.0)
        r = call("obs_blur", {"on": True})
        print(f"[obs_blur] ok={r['ok']} {r.get('data') or r.get('error')}")
        r = call("privacy_status")
        print(f"[privacy_status] watching={r['data']['watching']}")

    r = call("privacy_stop")
    print(f"[privacy_stop] ok={r['ok']}")

    # ---- 卸载 ----
    lib.air_plugin_shutdown()
    print(f"[shutdown] 日志条数 = {len(LOGS)}")
    for level, msg in LOGS[-12:]:
        print(f"    L{level} {msg}")

    print("\n全部检查通过")


if __name__ == "__main__":
    main()
