"""同时推主音频 + 麦克风到副机，用于端到端验证。

用法: py tools/push-both.py <秒数>
"""

import ctypes
import json
import sys
import time

DLL = r"Z:\VScodeProject\air-icon-launcher\plugins\com.air.stream.bridge\air_stream_bridge.dll"
SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0

LOG_FN = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p)
INVOKE_FN = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p)
_KEEP = []


def log_cb(ud, level, msg):
    pass


def invoke_cb(ud, method, args):
    buf = ctypes.create_string_buffer(json.dumps({"ok": True, "data": {}}).encode())
    _KEEP.append(buf)
    return ctypes.cast(buf, ctypes.c_void_p).value


class VTable(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("user_data", ctypes.c_void_p),
        ("log", LOG_FN),
        ("host_invoke", INVOKE_FN),
    ]


lib = ctypes.CDLL(DLL)
lib.air_plugin_init.argtypes = [ctypes.POINTER(VTable), ctypes.c_void_p]
lib.air_plugin_init.restype = ctypes.c_int
lib.air_plugin_invoke.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
lib.air_plugin_invoke.restype = ctypes.c_void_p
lib.air_plugin_free_string.argtypes = [ctypes.c_void_p]

keep = (ctypes.c_char * 8)()
_log = LOG_FN(log_cb)
_inv = INVOKE_FN(invoke_cb)
vt = VTable(1, ctypes.cast(ctypes.pointer(keep), ctypes.c_void_p), _log, _inv)
print("init rc =", lib.air_plugin_init(ctypes.byref(vt), None))


def call(method, args=None):
    p = lib.air_plugin_invoke(method.encode(), json.dumps(args or {}).encode())
    s = ctypes.string_at(p).decode("utf-8")
    lib.air_plugin_free_string(p)
    return json.loads(s)


cfg = {
    "audio_dest": "192.168.31.66:47800",
    "audio_device": "迈从 (MCHOSE V9 Turbo+)",
    "mic_dest": "192.168.31.66:47801",
    "mic_device": "迈从麦克风 (MCHOSE V9 Turbo+)",
}
print("settings.set ->", call("settings.set", cfg).get("ok"))
print("audio_start  ->", call("audio_start").get("ok"))
print("mic_start    ->", call("mic_start").get("ok"))
time.sleep(SECS)
a = call("audio_status")["data"]
m = call("mic_status")["data"]
print("audio:", a["packets"], "pkt", a["frames"], "fr", "err=", repr(a["last_error"]))
print("mic  :", m["packets"], "pkt", m["frames"], "fr", "err=", repr(m["last_error"]))
call("audio_stop")
call("mic_stop")
lib.air_plugin_shutdown()
print("done")
