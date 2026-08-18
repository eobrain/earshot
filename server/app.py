"""Earshot coordinator (M0/M1 seed).

Single process, all state in RAM, nothing persisted, positions never logged.
Run: uvicorn server.app:app --host 127.0.0.1 --port 8700
(Caddy terminates TLS and proxies /ws here.)
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import TypeAdapter, ValidationError

from . import graph as graphmod
from . import pan as panmod
from .hush import HushRegistry
from .protocol import (
    MAX_MSG_BYTES,
    Bye,
    ClientMsg,
    Error,
    Hello,
    Hush,
    HushCount,
    NeighborInfo,
    Pos,
    Roster,
    Sig,
    SigOut,
    Unhush,
)

RECOMPUTE_S = 300          # ~5 min per spec
HEARTBEAT_S = 15
DROP_AFTER = 3 * HEARTBEAT_S
MAX_SESSIONS_PER_IP = 4    # sybil friction (architecture §7)
HUSH_RATE_PER_MIN = 10

_client_adapter: TypeAdapter = TypeAdapter(ClientMsg)


@dataclass
class Session:
    id: str
    ws: WebSocket
    ip: str
    lat: float | None = None
    lon: float | None = None
    last_seen: float = field(default_factory=time.monotonic)
    axis: tuple[float, float] | None = None
    hush_times: list[float] = field(default_factory=list)  # rate limiting


app = FastAPI()
sessions: dict[str, Session] = {}
adjacency: dict[str, set[str]] = {}
hushes = HushRegistry()
next_recompute_at: float = 0.0
_lock = asyncio.Lock()


async def _send(s: Session, model) -> None:
    try:
        await s.ws.send_text(model.model_dump_json(by_alias=True))
    except Exception:
        pass  # departure is handled by the reaper


async def _send_roster(s: Session) -> None:
    infos = []
    me = (s.lat, s.lon)
    nbr_ids = sorted(adjacency.get(s.id, ()))
    nbrs = [sessions[i] for i in nbr_ids if i in sessions and sessions[i].lat is not None]
    pans, axis = panmod.pans(me, [(n.lat, n.lon) for n in nbrs], s.axis)
    s.axis = axis
    for n, p in zip(nbrs, pans):
        infos.append(NeighborInfo(id=n.id, pan=max(-1.0, min(1.0, p)), hushes=hushes.count(n.id)))
    infos.sort(key=lambda i: i.pan)
    await _send(
        s,
        Roster(
            neighbors=infos,
            self_hushes=hushes.count(s.id),
            refresh_s=max(0, int(next_recompute_at - time.monotonic())),
        ),
    )


async def recompute() -> None:
    """Rebuild the neighbor graph and push fresh rosters to everyone."""
    global adjacency, next_recompute_at
    async with _lock:
        positions = {
            sid: (s.lat, s.lon)
            for sid, s in sessions.items()
            if s.lat is not None and s.lon is not None
        }
        adjacency = graphmod.neighbor_graph(positions)
        next_recompute_at = time.monotonic() + RECOMPUTE_S
        for sid in positions:
            await _send_roster(sessions[sid])


async def _reaper() -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_S)
        now = time.monotonic()
        stale = [s for s in sessions.values() if now - s.last_seen > DROP_AFTER]
        for s in stale:
            await _drop(s)
        touched = hushes.purge()
        for tgt in touched:
            await _broadcast_hushcount(tgt)
        if now >= next_recompute_at:
            await recompute()


async def _drop(s: Session) -> None:
    sessions.pop(s.id, None)
    for other in adjacency.get(s.id, set()).copy():
        adjacency.get(other, set()).discard(s.id)
        if other in sessions:
            await _send(sessions[other], Bye(id=s.id))
    adjacency.pop(s.id, None)
    try:
        await s.ws.close()
    except Exception:
        pass
    # NOTE: hushes set by s deliberately survive (duration-based; see hush.py).


async def _broadcast_hushcount(tgt: str) -> None:
    n = hushes.count(tgt)
    msg = HushCount(id=tgt, n=n)
    listeners = set(adjacency.get(tgt, set()))
    if tgt in sessions:
        listeners.add(tgt)  # you see hushes on you
    for sid in listeners:
        if sid in sessions:
            await _send(sessions[sid], msg)


@app.on_event("startup")
async def _startup() -> None:
    global next_recompute_at
    next_recompute_at = time.monotonic() + RECOMPUTE_S
    asyncio.create_task(_reaper())


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    ip = ws.client.host if ws.client else "?"
    if sum(1 for s in sessions.values() if s.ip == ip) >= MAX_SESSIONS_PER_IP:
        await ws.send_text(Error(reason="too many sessions from this address").model_dump_json())
        await ws.close()
        return

    me: Session | None = None
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_MSG_BYTES:
                continue
            try:
                msg = _client_adapter.validate_json(raw)
            except ValidationError:
                await ws.send_text(Error(reason="bad message").model_dump_json())
                continue

            if isinstance(msg, Hello):
                if me is not None:
                    continue
                if msg.id in sessions:  # takeover: old socket is superseded
                    await _drop(sessions[msg.id])
                me = Session(id=msg.id, ws=ws, ip=ip)
                sessions[me.id] = me
                continue
            if me is None:
                await ws.send_text(Error(reason="hello first").model_dump_json())
                continue

            me.last_seen = time.monotonic()

            if isinstance(msg, Pos):
                first = me.lat is None
                me.lat, me.lon = msg.lat, msg.lon
                if first:
                    await recompute()  # joiners shouldn't wait 5 minutes
            elif isinstance(msg, (Hush, Unhush)):
                tgt = msg.target
                if tgt not in adjacency.get(me.id, set()):
                    await _send(me, Error(reason="not your neighbor"))
                    continue
                now = time.monotonic()
                me.hush_times = [t for t in me.hush_times if now - t < 60]
                if isinstance(msg, Hush):
                    if len(me.hush_times) >= HUSH_RATE_PER_MIN:
                        await _send(me, Error(reason="hush rate limit"))
                        continue
                    me.hush_times.append(now)
                    hushes.hush(me.id, tgt)
                else:
                    hushes.unhush(me.id, tgt)
                await _broadcast_hushcount(tgt)
            elif isinstance(msg, Sig):
                if msg.to in adjacency.get(me.id, set()) and msg.to in sessions:
                    await _send(sessions[msg.to], SigOut(frm=me.id, payload=msg.payload))
    except WebSocketDisconnect:
        pass
    finally:
        if me is not None and sessions.get(me.id) is me:
            await _drop(me)
