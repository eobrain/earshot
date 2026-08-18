"""Mutual k-nearest-neighbor graph with a symmetric degree cap.

Edge rule (architecture 4.2):
    edge(A, B)  <=>  B in kNN(A)  or  A in kNN(B)         (symmetric by construction)

Degree cap: while any user's degree exceeds CAP, remove that user's farthest
*reverse-excess* edge (an edge (A, B) is reverse-excess for A when B is not in
A's own kNN — it exists only because A is in B's kNN). Removal is symmetric.
A user's own-kNN degree is at most k (< CAP), so trimming always terminates
with every degree <= CAP.

O(n^2) distance computation — fine at hobby scale (thousands of users is
milliseconds); swap in a grid/KD-tree if that ever changes.
"""
from __future__ import annotations

import math
from typing import Hashable, Mapping

from .pan import M_PER_DEG_LAT, M_PER_DEG_LON_EQ

Id = Hashable
Vec = tuple[float, float]

K = 5
CAP = 12


def _dist2_m(a: Vec, b: Vec) -> float:
    coslat = math.cos(math.radians((a[0] + b[0]) / 2.0))
    dx = (a[1] - b[1]) * M_PER_DEG_LON_EQ * coslat
    dy = (a[0] - b[0]) * M_PER_DEG_LAT
    return dx * dx + dy * dy


def neighbor_graph(
    positions: Mapping[Id, Vec], k: int = K, cap: int = CAP
) -> dict[Id, set[Id]]:
    """Return adjacency {id -> set of neighbor ids}, symmetric, degrees <= cap."""
    ids = sorted(positions.keys(), key=repr)  # deterministic
    n = len(ids)
    adj: dict[Id, set[Id]] = {i: set() for i in ids}
    if n < 2:
        return adj

    d2: dict[tuple[Id, Id], float] = {}
    for i in range(n):
        for j in range(i + 1, n):
            a, b = ids[i], ids[j]
            d2[(a, b)] = d2[(b, a)] = _dist2_m(positions[a], positions[b])

    knn: dict[Id, set[Id]] = {}
    for a in ids:
        others = sorted((i for i in ids if i is not a and i != a), key=lambda b: (d2[(a, b)], repr(b)))
        knn[a] = set(others[:k])

    for a in ids:
        for b in knn[a]:
            adj[a].add(b)
            adj[b].add(a)

    # Symmetric trim of reverse-excess edges, farthest first.
    changed = True
    while changed:
        changed = False
        for a in ids:
            while len(adj[a]) > cap:
                excess = [b for b in adj[a] if b not in knn[a]]
                if not excess:
                    break  # unreachable: own-kNN degree <= k < cap
                b = max(excess, key=lambda b: (d2[(a, b)], repr(b)))
                adj[a].discard(b)
                adj[b].discard(a)
                changed = True
    return adj
