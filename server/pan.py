"""Per-user 1-D pan mapping.

The product spec calls for SVD; for n*2 offset matrices this reduces to the
dominant eigenvector of the (uncentered) 2x2 covariance matrix, computed in
closed form. Uncentered on purpose: the axis is taken about the *user's own
position*, so the user maps exactly to the origin (pan 0).

Sign stability (architecture 4.3): prefer continuity with the user's previous
axis; otherwise fix east >= 0, tie-break north >= 0. Prevents the soundstage
mirror-flipping between refreshes.
"""
from __future__ import annotations

import math
from typing import Sequence

M_PER_DEG_LAT = 110_540.0
M_PER_DEG_LON_EQ = 111_320.0

Vec = tuple[float, float]


def offsets_m(user: Vec, others: Sequence[Vec]) -> list[Vec]:
    """Local equirectangular projection of (lat, lon) points to meters about user."""
    lat0, lon0 = user
    coslat = math.cos(math.radians(lat0))
    return [
        ((lon - lon0) * M_PER_DEG_LON_EQ * coslat, (lat - lat0) * M_PER_DEG_LAT)
        for lat, lon in others
    ]


def principal_axis(offsets: Sequence[Vec], prev_axis: Vec | None = None) -> Vec:
    """Unit vector of the dominant (uncentered) principal axis, sign-stabilized."""
    sxx = sum(x * x for x, _ in offsets)
    syy = sum(y * y for _, y in offsets)
    sxy = sum(x * y for x, y in offsets)

    if sxx == 0.0 and syy == 0.0 and sxy == 0.0:
        # All neighbors coincide with the user; axis is arbitrary.
        wx, wy = 1.0, 0.0
    else:
        theta = 0.5 * math.atan2(2.0 * sxy, sxx - syy)
        wx, wy = math.cos(theta), math.sin(theta)

    # Sign rule: continuity first, else east>=0 (tie: north>=0).
    if prev_axis is not None and (wx * prev_axis[0] + wy * prev_axis[1]) < 0.0:
        wx, wy = -wx, -wy
    elif prev_axis is None and (wx < 0.0 or (wx == 0.0 and wy < 0.0)):
        wx, wy = -wx, -wy
    return (wx, wy)


def pans(
    user: Vec,
    neighbors: Sequence[Vec],
    prev_axis: Vec | None = None,
) -> tuple[list[float], Vec]:
    """Return ([pan in [-1, 1] per neighbor, order preserved], axis).

    The caller (coordinator) stores the returned axis per session and passes it
    back on the next recompute for sign continuity.
    """
    if not neighbors:
        return [], prev_axis or (1.0, 0.0)
    offs = offsets_m(user, neighbors)
    axis = principal_axis(offs, prev_axis)
    proj = [x * axis[0] + y * axis[1] for x, y in offs]
    m = max(abs(p) for p in proj)
    if m == 0.0:
        return [0.0 for _ in proj], axis
    return [p / m for p in proj], axis
