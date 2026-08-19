"""One synthetic Earshot user with real WebRTC audio (M2).

Each bot joins the coordinator with synthetic coordinates, follows the frozen
protocol, opens aiortc peer connections to its neighbours (lower-id offers),
and speaks a continuous sine tone whose pitch is derived from its name — so
in a field test you can tell bots apart by ear as well as by direction.

Usage:
  python sim/bot.py ws://127.0.0.1:8700/ws --lat 37.771 --lon -122.421 --name kestrel
  python sim/bot.py wss://host/ws --lat ... --lon ... --name moss --ice https://host/ice
"""
import argparse
import asyncio
import fractions
import json
import time
import urllib.request
import uuid

import numpy as np
import websockets
from aiortc import (
    RTCConfiguration,
    RTCIceCandidate,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
)
from aiortc.mediastreams import MediaStreamTrack
from aiortc.sdp import candidate_from_sdp
from av import AudioFrame

HEARTBEAT_S = 15
SAMPLE_RATE = 48000
FRAME_MS = 20
SAMPLES = SAMPLE_RATE * FRAME_MS // 1000


class SineTrack(MediaStreamTrack):
    """Endless sine tone; pitch seeded by bot name (220–880 Hz)."""
    kind = "audio"

    def __init__(self, name: str):
        super().__init__()
        h = sum(ord(c) * 31 ** i for i, c in enumerate(name)) % 1000
        self.freq = 220.0 + (h / 1000.0) * 660.0
        self._ts = 0
        self._start = time.monotonic()

    async def recv(self) -> AudioFrame:
        # pace to real time
        target = self._start + self._ts / SAMPLE_RATE
        await asyncio.sleep(max(0, target - time.monotonic()))
        t = (np.arange(SAMPLES) + self._ts) / SAMPLE_RATE
        pcm = (0.25 * np.sin(2 * np.pi * self.freq * t) * 32767).astype(np.int16)
        frame = AudioFrame(format="s16", layout="mono", samples=SAMPLES)
        frame.planes[0].update(pcm.tobytes())
        frame.sample_rate = SAMPLE_RATE
        frame.pts = self._ts
        frame.time_base = fractions.Fraction(1, SAMPLE_RATE)
        self._ts += SAMPLES
        return frame


class Bot:
    def __init__(self, url: str, lat: float, lon: float, name: str, ice_url: str | None):
        self.url, self.lat, self.lon, self.name = url, lat, lon, name
        self.id = f"bot-{name}-{uuid.uuid4().hex[:8]}"
        self.ws = None
        self.pcs: dict[str, RTCPeerConnection] = {}
        self.frames_in: dict[str, int] = {}
        self.config = RTCConfiguration(iceServers=self._ice(ice_url))

    def _ice(self, ice_url: str | None) -> list[RTCIceServer]:
        if not ice_url:
            return [RTCIceServer(urls="stun:stun.l.google.com:19302")]
        with urllib.request.urlopen(ice_url) as r:
            data = json.loads(r.read())
        return [
            RTCIceServer(urls=s["urls"], username=s.get("username"), credential=s.get("credential"))
            for s in data["iceServers"]
        ]

    async def send(self, obj: dict) -> None:
        await self.ws.send(json.dumps(obj))

    async def run(self) -> None:
        async with websockets.connect(self.url, max_size=32 * 1024) as ws:
            self.ws = ws
            await self.send({"t": "hello", "id": self.id, "v": 0})
            hb = asyncio.create_task(self._heartbeat())
            counter = asyncio.create_task(self._report())
            try:
                async for raw in ws:
                    await self._handle(json.loads(raw))
            finally:
                hb.cancel(); counter.cancel()
                for pc in self.pcs.values():
                    await pc.close()

    async def _heartbeat(self) -> None:
        while True:
            await self.send({"t": "pos", "lat": self.lat, "lon": self.lon})
            await asyncio.sleep(HEARTBEAT_S)

    async def _report(self) -> None:
        while True:
            await asyncio.sleep(10)
            if self.frames_in:
                print(f"[{self.name}] audio frames received:",
                      {k[:14]: v for k, v in self.frames_in.items()}, flush=True)

    async def _handle(self, msg: dict) -> None:
        t = msg.get("t")
        if t == "roster":
            ids = [n["id"] for n in msg["neighbors"]]
            print(f"[{self.name}] roster({len(ids)}):",
                  [(n['id'][:14], round(n['pan'], 2)) for n in msg["neighbors"]], flush=True)
            await self._sync(set(ids))
        elif t == "sig":
            await self._sig(msg["from"], msg["payload"])
        elif t == "bye":
            await self._close(msg["id"])

    async def _sync(self, want: set[str]) -> None:
        for pid in list(self.pcs):
            if pid not in want:
                await self._close(pid)
        for pid in want:
            if pid not in self.pcs:
                await self._open(pid)

    async def _open(self, pid: str) -> None:
        pc = RTCPeerConnection(configuration=self.config)
        self.pcs[pid] = pc
        pc.addTrack(SineTrack(self.name))

        @pc.on("track")
        async def on_track(track):
            self.frames_in.setdefault(pid, 0)
            while True:
                try:
                    await track.recv()
                except Exception:
                    break
                self.frames_in[pid] += 1

        if self.id < pid:  # frozen rule: lower id offers
            offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            await self._send_desc(pid, pc)

    async def _send_desc(self, pid: str, pc: RTCPeerConnection) -> None:
        # aiortc gathers ICE before resolving setLocalDescription: candidates ride in the SDP
        await self.send({"t": "sig", "to": pid, "payload": {
            "description": {"type": pc.localDescription.type, "sdp": pc.localDescription.sdp}}})

    async def _sig(self, frm: str, payload: dict) -> None:
        pc = self.pcs.get(frm)
        if pc is None:
            return
        if "description" in payload:
            desc = payload["description"]
            await pc.setRemoteDescription(RTCSessionDescription(sdp=desc["sdp"], type=desc["type"]))
            if desc["type"] == "offer":
                answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                await self._send_desc(frm, pc)
        elif "candidate" in payload and payload["candidate"]:
            c = payload["candidate"]
            if c.get("candidate"):
                cand = candidate_from_sdp(c["candidate"])
                cand.sdpMid = c.get("sdpMid")
                cand.sdpMLineIndex = c.get("sdpMLineIndex")
                await pc.addIceCandidate(cand)

    async def _close(self, pid: str) -> None:
        pc = self.pcs.pop(pid, None)
        if pc:
            await pc.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--name", default="bot")
    p.add_argument("--ice", default=None, help="URL of the coordinator /ice endpoint")
    a = p.parse_args()
    asyncio.run(Bot(a.url, a.lat, a.lon, a.name, a.ice).run())
