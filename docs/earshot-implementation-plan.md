# Earshot — Implementation Plan v1.1

**Status:** Proposed, awaiting owner approval · 18 Aug 2026 · v1.1 reconciled against the parallel (Gemini) plan: closed-form 2×2 pan solver, vanilla-TS client option added, basic PWA packaging pulled into MVP
**Stage:** 3 of 4 (mocks ✓ → architecture ✓ → **implementation plan** → MVP)
**Locked upstream decisions:** P2P mesh + VPS coordinator (approved); **web client (PWA)**; degree cap 12; hush loss on coordinator restart acceptable. UI per `earshot-ui-spec.md` v1.0; architecture per `earshot-architecture.md` v1.1.

---

## 1. Stack

Chosen to match the owner's existing toolchain (Python, React, Ubuntu VPS, AI-assisted coding) rather than to minimize language count.

| Component | Choice | Rationale |
|---|---|---|
| Coordinator | **Python 3.11+, FastAPI + uvicorn, `websockets`** | Control plane only (no media), so Python's throughput is a non-issue at hobby scale; owner's primary language. The "SVD" reduces to a closed-form eigenvector of a 2×2 covariance matrix (~15 lines, no numpy required) — which also makes the pan solver trivially portable to any parallel implementation |
| Client | **TypeScript + Vite, PWA** — two options, owner to pick: **(a) vanilla DOM (recommended):** the approved mock *is* vanilla JS, so its soundstage, leader-line measurement, and pill logic port nearly verbatim; measured-DOM rendering is also awkward in React (refs + effects). **(b) React 18:** owner's familiar stack, better if the app is expected to grow screens | Vite either way; no WebRTC SDK — native `RTCPeerConnection` with the *perfect negotiation* pattern + lower-UUID-offers rule |
| Audio | **Web Audio API directly** (Gain → StereoPanner per remote stream; AnalyserNode VAD) | Per architecture §5; no library needed |
| Sim bots | **Python + `aiortc`** | Headless clients that join with synthetic GPS and loop audio files — Python does full WebRTC, so bots exercise the *real* data plane (see §5, the linchpin of solo testing) |
| TURN | **coturn** (apt package) | Same VPS; long-term credentials mechanism with shared secret |
| Web serving / TLS | **Caddy** | Serves the built client, terminates TLS (automatic Let's Encrypt), reverse-proxies `wss://…/ws` to uvicorn |
| Process management | **systemd units** (earshot-coordinator, coturn) | VPS-native; no Docker needed for two small processes (owner may containerize later if preferred) |

## 2. Repository layout

```
earshot/
├── server/            # coordinator (FastAPI)
│   ├── app.py         # ws endpoint, session table
│   ├── graph.py       # mutual 5-NN, cap-12 symmetric trim
│   ├── pan.py         # per-user SVD, sign stability
│   ├── hush.py        # TTL registry, neighbors-only auth
│   ├── protocol.py    # message schemas (pydantic), validation
│   └── tests/
├── client/            # React + TS + Vite PWA
│   ├── src/
│   │   ├── audio/     # graph per peer: source→gain→panner; VAD
│   │   ├── rtc/       # perfect negotiation, mesh reconciliation
│   │   ├── ws/        # coordinator protocol client
│   │   ├── ui/        # Soundstage, Ruler, Leaders, Strip, HushPill, modals
│   │   └── state/     # roster/pan/hush store (zustand or useReducer)
│   └── public/        # manifest, icons
├── sim/               # aiortc bot clients + scenario runner
│   ├── bot.py         # one synthetic user: fake GPS, looped WAV, full WebRTC
│   └── scenarios/     # e.g. "6 users in a park", "crowd edge", "walker"
├── deploy/            # Caddyfile, systemd units, coturn.conf, install.sh
└── docs/              # the three spec documents + protocol.md
```

## 3. Coordinator protocol (v0, JSON over WSS)

Client→server: `hello{id}` · `pos{lat,lon}` (heartbeat, 15 s) · `hush{target}` · `unhush{target}` · `sig{to,payload}`
Server→client: `roster{neighbors:[{id,pan,hushes}],self:{hushes}}` · `hushcount{id,n}` · `sig{from,payload}` · `bye{id}`

Rules carried from architecture: pydantic validation on every message; unknown fields rejected; `sig` relayed only between current neighbor pairs; hush accepted only from a current neighbor of the target; no position ever echoed back out (clients receive **pans, never coordinates** — neighbors' locations are not disclosed even in relative form beyond the 1-D pan).

## 4. MVP scope

**In:** everything in the three user stories — first-run modals, roster/soundstage UI per mocks v4, live mesh audio with panning, hush/unhush with counts and dimming, 5-minute recompute with animated re-panning, heartbeat drop-out. Plus: sim harness (§5), deploy scripts, wake-lock request (`navigator.wakeLock`) to reduce screen-off drops, and basic PWA packaging (manifest + static-asset service worker — cheap enough to include now).

**Out (post-MVP):** PWA offline/install polish; secondary hosted TURN; abuse hardening beyond per-IP session caps and hush rate limits; iOS background-audio workarounds (documented limitation: screen must stay on — revisit native wrapper only if the PWA proves the concept); roster-change toasts; localization.

## 5. Solo-testing strategy (the practical linchpin)

A one-person field test of a proximity app is the hardest part of this project — you can't be six people in a park. Three layers:

1. **Sim bots (`sim/bot.py`):** each bot connects to the real coordinator with synthetic coordinates and speaks a looped WAV over real aiortc WebRTC. Scenario files place bots around a chosen lat/lon. You stand in the middle with one phone and hear the full spatialized experience end-to-end — real signaling, real mesh, real TURN.
2. **Location spoof toggle (dev builds only):** client flag to inject a fake position, so multi-tab desktop testing works without GPS.
3. **Unit level:** `graph.py` and `pan.py` are pure functions — property tests for mutuality, cap-12 symmetry, pan ∈ [−1,1], self-at-origin, and sign continuity across successive frames.

## 6. Milestones

| # | Deliverable | Definition of done |
|---|---|---|
| M0 | Scaffold + deploy skeleton | Repo builds; Caddy serves a stub client over HTTPS on the VPS; `wss` echo works from a phone |
| M1 | Control plane complete | Sim bots (no audio yet) join with fake GPS; coordinator emits correct rosters/pans; property tests green |
| M2 | Mesh audio | 3 browser tabs + 2 bots exchange audio via real signaling; TURN verified by forcing relay (`iceTransportPolicy: "relay"`) |
| M3 | Full UI + mechanics | Mocks-v4 UI wired to live state: panning ramps, VAD indicators, hush end-to-end with counts/dimming/expiry |
| M4 | Field test | You + 5 bots around a real park via phone on LTE (CGNAT path exercised); wake lock; PWA manifest; go/no-go list of observed issues |

Sequenced so every milestone is independently demonstrable; M1–M2 are where the two parallel efforts (Claude/Gemini) can most usefully diverge and compare, since they're behind the frozen protocol of §3.

## 7. Risks specific to this plan

- **iOS Safari:** PWA audio dies on screen lock (accepted, decision #2); wake lock mitigates but drains battery. This is the #1 candidate to falsify the PWA choice in M4.
- **Autoplay policies:** audio output requires a user gesture — the "Headphones on!" OK tap doubles as the gesture that unlocks the AudioContext (spec-aligned, free).
- **aiortc/browser interop quirks:** known-workable but occasionally fussy (DTLS role, codec params); contained in M2.
- **Clock discipline:** all TTLs server-side (already in architecture); bots and client display only.

## 8. Approval requested

1. Stack as in §1 (notably: Python coordinator, React/TS client, aiortc bots, Caddy+systemd on the existing VPS).
2. Protocol v0 shape in §3 — worth freezing early so parallel implementations stay interoperable.
3. MVP in/out list in §4.

On approval, work begins at M0.
