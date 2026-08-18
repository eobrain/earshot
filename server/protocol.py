"""Protocol v0 — FROZEN (implementation plan §3).

JSON over WSS. Unknown message types and unknown fields are rejected.
Clients receive pans, never coordinates.

Client -> server: hello, pos, hush, unhush, sig
Server -> client: roster, hushcount, sig, bye, error
"""
from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

PROTOCOL_VERSION = 0


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------- client -> server ----------

class Hello(_Strict):
    t: Literal["hello"]
    id: str = Field(min_length=8, max_length=64)
    v: int = PROTOCOL_VERSION


class Pos(_Strict):
    t: Literal["pos"]
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Hush(_Strict):
    t: Literal["hush"]
    target: str


class Unhush(_Strict):
    t: Literal["unhush"]
    target: str


class Sig(_Strict):
    t: Literal["sig"]
    to: str
    payload: dict[str, Any]  # opaque SDP/ICE; size-capped at transport layer


ClientMsg = Annotated[Union[Hello, Pos, Hush, Unhush, Sig], Field(discriminator="t")]


# ---------- server -> client ----------

class NeighborInfo(_Strict):
    id: str
    pan: float = Field(ge=-1, le=1)
    hushes: int = Field(ge=0)


class Roster(_Strict):
    t: Literal["roster"] = "roster"
    neighbors: list[NeighborInfo]
    self_hushes: int = Field(ge=0)
    refresh_s: int  # seconds until next scheduled recompute


class HushCount(_Strict):
    t: Literal["hushcount"] = "hushcount"
    id: str
    n: int = Field(ge=0)


class SigOut(_Strict):
    t: Literal["sig"] = "sig"
    frm: str = Field(alias="from")
    payload: dict[str, Any]
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Bye(_Strict):
    t: Literal["bye"] = "bye"
    id: str


class Error(_Strict):
    t: Literal["error"] = "error"
    reason: str


MAX_MSG_BYTES = 32 * 1024  # generous for SDP; reject larger at the socket
