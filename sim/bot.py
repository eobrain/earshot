"""One synthetic Earshot user (M1: position-only; M2 adds aiortc audio).

Usage: python sim/bot.py wss://host/ws --lat 37.771 --lon -122.421 [--name kestrel]
"""
import argparse
import asyncio
import json
import uuid

import websockets  # pip install websockets

HEARTBEAT_S = 15


async def run(url: str, lat: float, lon: float, name: str) -> None:
    bot_id = f"bot-{name}-{uuid.uuid4().hex[:8]}"
    async with websockets.connect(url, max_size=32 * 1024) as ws:
        await ws.send(json.dumps({"t": "hello", "id": bot_id, "v": 0}))

        async def heartbeat():
            while True:
                await ws.send(json.dumps({"t": "pos", "lat": lat, "lon": lon}))
                await asyncio.sleep(HEARTBEAT_S)

        hb = asyncio.create_task(heartbeat())
        try:
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("t") == "roster":
                    ns = ", ".join(f"{n['id'][:16]}@{n['pan']:+.2f}" for n in msg["neighbors"])
                    print(f"[{name}] roster({len(msg['neighbors'])}): {ns}")
                # M2: respond to {"t":"sig"} with aiortc offer/answer + looped WAV track
        finally:
            hb.cancel()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--name", default="bot")
    a = p.parse_args()
    asyncio.run(run(a.url, a.lat, a.lon, a.name))
