"""直接驱动插件往副机推流，绕开 plugin-smoke.py 里写死的 127.0.0.1。

用法: py tools/push-to-linux.py <秒数>
"""

import ctypes
import json
import sys
import time

DLL = r"Z:\VScodeProject\air-icon-launcher\plugins\com.air.stream.bridge\air_stream_bridge.dll"
SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 8.0

LOG_FN = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p)
INVOKE_FN = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p)
_KEEP = []


def log_cb(ud, level, msg):
    pass


def invoke_cb(ud, method, args):
    m = method.decode("utf-8", "replace")
    payload = json.dumps({"ok": True, "data": {}})
    buf = ctypes.create_string_buffer(payload.encode())
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
rc = lib.air_plugin_init(ctypes.byref(vt), None)
print("init rc =", rc)


def call(method, args=None):
    a = json.dumps(args or {}).encode()
    p = lib.air_plugin_invoke(method.encode(), a)
    s = ctypes.string_at(p).decode("utf-8")
    lib.air_plugin_free_string(p)
    return json.loads(s)


print("settings.set ->", call("settings.set", {"audio_dest": "192.168.31.66:47800"}).get("ok"))
print("audio_start  ->", call("audio_start"))
time.sleep(SECS)
print("audio_status ->", json.dumps(call("audio_status")["data"], ensure_ascii=False))
call("audio_stop")
lib.air_plugin_shutdown()
print("done")
