# Earshot — Architecture Design v1.1

**Status:** Proposed, awaiting owner approval · 18 Aug 2026 · v1.1 reconciled against the parallel (Gemini) proposal: AnalyserNode VAD adopted, TURN reclassified as mandatory, responsibility matrix added
**Stage:** 2 of 4 (mocks ✓ → **architecture** → implementation plan → MVP)
**Companions:** `earshot-ui-spec.md` (UI decisions, v1.0), owner's product spec of 17 Aug 2026.
**Format note:** structured as overview → control plane → data plane → cost model → failure modes → alternatives, to allow side-by-side comparison with a parallel proposal.

---

## 1. Goals and constraints

- Real-time voice between each user and their 5–12 neighbors, spatialized in stereo **at the receiver**.
- Neighbor graph is *mutual k-nearest-neighbor* (k = 5): `edge(A,B) ⟺ B ∈ 5NN(A) or A ∈ 5NN(B)`. Note this relation is symmetric by construction.
- Recompute neighbors/positions ~every 5 minutes; drop unresponsive users.
- Global hush registry: any user may hush a neighbor for 1 h; each active hush attenuates that person's output **for everyone** by 10 dB; hushes are individually undoable by their setter.
- **No login.** **Fine-grained location is used but never stored.**
- **Hobby budget:** no expensive server-side deployment. Owner already runs an always-on 4 GB Ubuntu VPS; the design treats that as free marginal capacity, with a serverless alternative noted.

## 2. Overview

Two planes, cleanly separated:

- **Control plane** — one small always-on coordinator process (on the existing VPS). Holds *all* mutable state in RAM only: live sessions, last-known positions, the neighbor graph, hush counters, and WebRTC signaling relay. Nothing is written to disk. Speaks WebSocket to every active client.
- **Data plane** — **peer-to-peer WebRTC mesh**. Audio flows directly between neighbors (DTLS-SRTP encrypted); the server never carries or can read audio, except as an opaque TURN relay for NAT-blocked pairs.

```
            CONTROL PLANE (VPS, RAM only)                DATA PLANE (P2P)
   ┌──────────────────────────────────────────┐
   │  coordinator process                     │        ┌────┐  opus  ┌────┐
   │  ├─ session table   {id → ws, pos, seen} │        │ A  │◄──────►│ B  │
   │  ├─ neighbor graph  (mutual 5-NN, cap 12)│        └─┬──┘        └──┬─┘
   │  ├─ pan solver      (per-user 1-D SVD)   │          │   ┌────┐     │
   │  ├─ hush registry   {(src,tgt) → expiry} │          └──►│ C  │◄────┘
   │  └─ signaling relay (SDP/ICE passthrough)│              └────┘
   └──────────────▲───────────────────────────┘        mesh edges = neighbor
                  │ WebSocket (wss)                     graph edges only
        position updates, neighbor lists,
        pan values, hush counts, signaling
   ┌──────────────┴───────────┐
   │ coturn (same VPS)        │  TURN fallback for NAT-blocked pairs
   └──────────────────────────┘  (encrypted passthrough, can't read audio)
```

Why mesh and not an SFU: per-user degree is small and bounded (§4.2 caps it at 12), so uplink is ≤ ~360 kbps — comfortably within phone budgets — and a mesh keeps the server nearly free, keeps audio off the server entirely (strong privacy story), and removes the largest operational component. The SFU upgrade path is preserved (§8).

## 3. Identity and privacy model

- **Identity:** client generates a random UUID on first run, kept in local storage. It seeds the identicon and the auto-generated handle. No accounts, no PII, no server-side identity records beyond the live session.
- **Location:** clients send position over the WebSocket. The coordinator holds it in RAM for the session, uses it in the periodic recompute, and discards it on disconnect. No database, no logs of position, no analytics. Server access/error logs must scrub message bodies.
- **Audio:** never touches the server in readable form. P2P legs are DTLS-SRTP; TURN-relayed legs remain encrypted end-to-end (TURN forwards ciphertext).
- **Hushes:** in-RAM with TTL. A coordinator restart loses active hushes; accepted hobby trade-off (worst case: a hushed loudmouth returns to full volume an hour early).

## 4. Control plane

### 4.1 Session lifecycle
1. Client opens `wss://` connection, sends `hello {id}` then `pos {lat, lon}` once granted location.
2. Heartbeat every 15 s (ping/pong plus fresh position, which also handles movement). Missing 3 heartbeats ⇒ session dropped, neighbors notified (spec's "not responding ⇒ removed").
3. Position changes beyond a small threshold (~25 m) may trigger an early localized recompute; otherwise the global 5-minute tick governs.

### 4.2 Neighbor computation (every ~5 min, and on join/leave)
- All live positions go into a spatial index (grid hash or KD-tree; trivial at hobby scale — thousands of users is single-digit milliseconds).
- Compute each user's 5 nearest; form the symmetric edge set `E = {(A,B): B∈5NN(A) or A∈5NN(B)}`.
- **Degree cap 12** (carried over from the UI spec's recommendation; the real ceiling is simultaneous audio streams, not pixels): while any user's degree exceeds 12, remove that user's farthest edge — removal is symmetric, so both endpoints lose it. The 5-NN core is never trimmed below what mutuality requires; only reverse-neighbor excess is shed.
- Diff against the previous graph; each affected client receives an updated neighbor list.

### 4.3 Pan mapping (per user, the "SVD" of the product spec)
- For user U with neighbor offsets `vᵢ = pᵢ − p_U` (projected to meters via local equirectangular approximation), take the first right singular vector `w` of the n×2 offset matrix — i.e., the dominant axis of the neighborhood *about U*, uncentered, so U itself maps exactly to the origin.
- `panᵢ = (vᵢ·w) / max|vⱼ·w|` ⇒ each neighbor in [−1, +1], U at 0.
- **Sign stability:** fix the sign of `w` so `w·east ≥ 0` (tie-break `w·north ≥ 0`), and prefer the sign that maximizes continuity with U's previous axis. Prevents the whole soundstage flipping left↔right between refreshes.
- Pans are computed server-side (it already has the geometry) and sent with the neighbor list; clients only render. Each user gets their own axis — correct, since spatialization is per-listener.

### 4.4 Hush registry
- `hush {target}` ⇒ upsert `(src, tgt) → now + 1 h`; `unhush {target}` ⇒ delete. One active hush per (src, tgt) pair. Only current neighbors of the target may hush it (limits drive-by abuse).
- Count per target = live entries. On any change or expiry, push `hushcount {tgt, n}` to every client that currently neighbors `tgt` — including `tgt` itself (the UI shows hushes on you).
- Clients apply gain `10^(−n·10/20)` to that person's stream; the count also drives the UI dimming ladder. No numeric dB anywhere in UI (per UI spec D2).

### 4.5 Signaling
Plain SDP/ICE passthrough between neighbor pairs over the existing WebSockets. Deterministic initiator rule (lower UUID offers) avoids glare. No persistence.

## 5. Data plane

- **Transport:** one WebRTC peer connection per neighbor edge, Opus mono @ ~24 kbps (VBR, DTX on — silence costs almost nothing). Audio-only.
- **Spatialization at the receiver:** each remote stream → `GainNode` (hush gain) → `StereoPannerNode` (pan value from control plane) → destination. Constant-power panning; ramp pan/gain changes over ~0.5 s to match the UI's animated pins.
- **Talking indication:** local, per-stream level detection — MVP default is a polled `AnalyserNode` per stream (simple, adequate for UI), with an `AudioWorklet` RMS upgrade if polling proves janky — with hysteresis; drives rings/bars/leader-line highlight. No server involvement.
- **NAT traversal:** STUN first (free public servers); **coturn on the same VPS** as fallback. Note TURN is **not optional** for this app: mobile carriers widely use CGNAT, and a walk-outside phone app will hit relay-required pairs routinely, not rarely. A free-tier hosted TURN (e.g., Cloudflare's) can be configured as a secondary fallback behind the VPS coturn. Bandwidth math in §6.
- **Reconciliation on refresh:** client diffs the new neighbor list — open connections to added neighbors, close removed ones, re-ramp pans for retained ones. In-flight audio is never interrupted for surviving edges.

### 5.1 Responsibility matrix

| Function | Client | Server |
|---|---|---|
| Identity & position | Generates/stores random UUID; reads GPS; sends position over WS | RAM-only session/position registry; never persisted or logged |
| Mesh resolution | Renders ruler, pins, leader lines, strip | Mutual 5-NN graph (cap 12, symmetric trim), per-user SVD pans, signaling relay (lower-UUID offers) |
| Audio processing | VAD (AnalyserNode), hush gain, stereo panning, 0.5 s ramps | None — no readable media path (TURN relays ciphertext only) |
| Moderation | Renders counts/dimming; sends hush/unhush | TTL hush registry; neighbors-only authorization; count broadcasts (incl. to target) |
| State expiry | Animates position changes; tears down removed peers | Drops sessions after 3 missed heartbeats; purges expired hushes |

## 6. Cost model

| Item | Cost |
|---|---|
| Coordinator process | $0 marginal (existing 4 GB VPS; footprint is a few hundred MB at thousands of sessions) |
| coturn | $0 marginal (same VPS) |
| Bandwidth, coordinator | Negligible (JSON control messages) |
| Bandwidth, TURN | ~30 kbps per relayed *stream*; even 50 simultaneously relayed streams ≈ 1.5 Mbps ≈ 0.5 TB/mo worst case — well inside typical VPS 20 TB allowances |
| Client uplink | degree d × ~30 kbps; d = 12 ⇒ ~360 kbps up, fine on LTE; DTX slashes this when not talking |
| TLS | Let's Encrypt, $0 |

Total: effectively **$0/month** beyond the VPS the owner already pays for. Serverless alternative (Cloudflare Worker + one Durable Object as coordinator, Cloudflare TURN) also lands ~$0–5/mo if the VPS is ever retired.

## 7. Failure modes and risks

- **Sybil hushing** (spin up fake clients to silence someone): the neighbors-only rule helps but doesn't prevent colocated sybils. Hobby-stage mitigations: per-IP session limits, hush rate limits. Accepted residual risk; revisit if real abuse appears.
- **Both-symmetric-NAT pairs:** fall back to TURN automatically; if TURN is down, edge is silently absent — UI should show the neighbor as present-but-unconnected rather than pretending audio works.
- **Coordinator restart:** sessions reconnect (client auto-retry with jitter); mesh edges survive briefly without signaling; hushes are lost (§3). Acceptable.
- **Mobile browser lifecycle:** iOS Safari suspends `getUserMedia`/WebAudio on screen lock; a real "walk around" experience likely needs a native wrapper eventually. Flagged as the main input to the implementation-plan stage, not solved here.
- **Clock skew on hush expiry:** all TTLs are server-authoritative; clients only display.
- **Popular-node overload:** degree cap 12 bounds worst-case CPU/uplink on any single phone.

## 8. Scaling path (beyond hobby)

Not needed now, but nothing above dead-ends: shard the coordinator geographically (users only ever interact locally, so geo-sharding is natural — e.g., S2/geohash cells with handoff at boundaries), and swap the mesh for per-region SFUs (LiveKit/mediasoup) with selective subscription if client uplink or battery becomes the limit. Control-plane messages and client rendering are unchanged by that swap — the pan/hush/neighbor protocol is transport-agnostic by design.

## 9. Alternatives considered

- **ATProto (floated in the product spec):** built for federated, *persistent*, public social data — repos, firehoses, DIDs. Earshot's needs are the opposite: ephemeral presence, private geometry, real-time media, and a hard "never store" rule. Adopting it would import identity and persistence machinery we'd then have to fight. Set aside; a DID could someday serve as portable identity if accounts ever appear.
- **SFU-first (LiveKit et al.):** simpler clients, but a server in the audio path (privacy), a heavier ops burden, and the room model fits poorly with per-user neighbor sets (workable via selective subscription, but contorted). Kept as the scale-up path, not the start.
- **Full P2P control plane (DHT/gossip, no server):** attractive ideologically, but mutual-kNN needs a global view *somewhere*, NAT still demands infrastructure, and correctness is much harder. The coordinator is ~1k lines and $0; not worth avoiding.
- **Local-radio discovery (BLE/mDNS):** can't implement the spec's neighbor semantics (5 nearest may be 500 m away) and can't reach across networks.

## 10. Decisions requested / open for the implementation plan

1. Approve the **P2P mesh + VPS coordinator** shape (the main fork; everything else adjusts).
2. Web client (PWA) vs. native wrapper — driven mostly by the iOS background-audio constraint (§7). Recommendation to follow in the implementation plan.
3. Confirm degree cap 12 (UI and audio ceilings both point there).
4. Confirm hush-loss-on-restart is acceptable (keeps the "nothing persisted" property absolute).
