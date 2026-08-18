"""In-memory hush registry (architecture 4.4).

One active hush per (source, target). 1-hour TTL, server-authoritative clock
(injectable for tests). Nothing is ever persisted; a restart loses hushes by
design (approved decision #4).

Authorization (only current neighbors of the target may hush it) is enforced
by the coordinator layer, which owns the neighbor graph.
"""
from __future__ import annotations

import time
from typing import Callable, Hashable

Id = Hashable

TTL_S = 3600.0


class HushRegistry:
    def __init__(self, now: Callable[[], float] = time.monotonic, ttl_s: float = TTL_S):
        self._now = now
        self._ttl = ttl_s
        self._expiry: dict[tuple[Id, Id], float] = {}  # (src, tgt) -> expires_at

    def hush(self, src: Id, tgt: Id) -> int:
        """Set/refresh src's hush on tgt. Returns tgt's new active count."""
        self._expiry[(src, tgt)] = self._now() + self._ttl
        return self.count(tgt)

    def unhush(self, src: Id, tgt: Id) -> int:
        """Remove src's hush on tgt if present. Returns tgt's new active count."""
        self._expiry.pop((src, tgt), None)
        return self.count(tgt)

    def has(self, src: Id, tgt: Id) -> bool:
        exp = self._expiry.get((src, tgt))
        return exp is not None and exp > self._now()

    def count(self, tgt: Id) -> int:
        now = self._now()
        return sum(1 for (_, t), exp in self._expiry.items() if t == tgt and exp > now)

    def purge(self) -> set[Id]:
        """Drop expired entries; return targets whose count changed."""
        now = self._now()
        dead = [key for key, exp in self._expiry.items() if exp <= now]
        touched = {t for (_, t) in dead}
        for key in dead:
            del self._expiry[key]
        return touched

    def drop_user(self, user: Id) -> set[Id]:
        """OPTIONAL policy: remove all hushes set *by* a departing user.

        The default coordinator policy does NOT call this: the spec frames a
        hush as a one-hour attenuation, so it survives its setter leaving and
        simply expires. Hushes *on* a departed user are likewise kept until
        expiry, in case they return within the hour. This method exists so the
        alternative policy is one line away if the owner changes their mind.
        """
        dead = [key for key in self._expiry if key[0] == user]
        touched = {t for (_, t) in dead}
        for key in dead:
            del self._expiry[key]
        return touched
