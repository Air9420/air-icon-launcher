import asyncio
import json
import math
import websockets

URL = "ws://127.0.0.1:4455"


async def main():
    async with websockets.connect(URL, max_size=None) as ws:
        await ws.recv()
        sub = (1 << 0) | (1 << 16)
        await ws.send(json.dumps({"op": 1, "d": {"rpcVersion": 1, "eventSubscriptions": sub}}))
        await ws.recv()
        seen = {}
        loop = asyncio.get_event_loop()
        t0 = loop.time()
        while loop.time() - t0 < 5.0:
            try:
                m = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.8))
            except asyncio.TimeoutError:
                continue
            if m.get("op") == 5 and m["d"].get("eventType") == "InputVolumeMeters":
                for inp in m["d"]["eventData"]["inputs"]:
                    name = inp["inputName"]
                    lv = inp.get("inputLevelsMul")
                    if not lv:
                        continue
                    peak = max(max(ch) for ch in lv if ch)
                    seen[name] = max(seen.get(name, 0.0), peak)
        for k, v in sorted(seen.items()):
            db = 20 * math.log10(v) if v > 0 else -999.0
            print("%-20s max=%.5f  %6.1f dB" % (k, v, db))
        if not seen:
            print("NO METER EVENTS")


asyncio.run(main())
