# Earshot — UI Specification v1.0

**Status:** UX mocks approved (v4) · 18 Aug 2026
**Audience:** Any agent or engineer continuing this project (this document is shared between Claude and Gemini, working in parallel).
**Companion artifact:** `situated-audio-chat-mocks.html` — a self-contained interactive HTML mock (no build step, no dependencies beyond Google Fonts). It is the reference implementation of everything below; where prose and mock disagree, the mock wins.
**Source of truth for product behavior:** "Instructions for creating a situated audio chat app" (owner's original spec, 17 Aug 2026). This document covers UI/UX decisions layered on top of it; it does not repeat every product rule.

---

## 1. Product in one paragraph

Earshot is a login-free mobile-first audio chat app. Each user hears their geographic "neighbors" — the 5 closest other users, plus anyone for whom this user is among *their* 5 closest (the relationship is bidirectional) — as live voice, spatialized in stereo. Relative geography is mapped (via SVD) to a one-dimensional audio axis with the user at the origin. Users can "hush" a neighbor for one hour (−10 dB per active hush, stacking, from any user, undoable by whoever set it). Neighbor sets and positions are recomputed roughly every 5 minutes. Fine-grained location is required but never stored.

## 2. Decisions log (agreed with owner)

| # | Decision | Notes |
|---|----------|-------|
| D1 | App name: **Earshot** | Working name; wordmark "Earshot." with amber period |
| D2 | **No numeric dB text anywhere in the UI** | Attenuation is communicated only by hush count + progressive visual dimming |
| D3 | Hush count is **clustered with the hush affordance** in a single pill | A standalone badge on the avatar was rejected as unclear |
| D4 | Hush icon: **mixer fader pulled low** | Rejected: ear icon, shush-finger face, speaker+wave, speaker+minus, pressed waves, 🤫 emoji. Rationale: fader means *attenuate* (not mute), stacks conceptually, matches the audio-hardware visual language |
| D5 | Live screen layout: **soundstage ruler + leader lines + horizontal avatar strip** | Leader lines are computed from measured DOM positions so they land exactly on avatars; they re-render on resize/scroll/rotation |
| D6 | Crowding: strip holds ~6 tiles unscrolled (portrait), **scrolls horizontally beyond that**; the ruler always shows every pin | See §7 for the geometric bound on neighbor count |
| D7 | **Landscape is supported and desirable** | Wider ruler = better pan resolution; layout is flex-driven and reflows without special casing |

## 3. Visual language

Metaphor: **backlit audio hardware** — VU meters, radio dials, mixing desks.

Semantic color rule (strict): **amber = sound is happening; cool slate = silenced.** Never use amber for hush states or slate for activity.

### Tokens

```css
--bg:       #171209;  /* warm black (hardware, backlight off) */
--panel:    #211A0F;
--panel-2:  #2A2114;
--line:     #3A3020;  /* borders, ruler, leader lines */
--amber:    #F5A83C;  /* VU glow: talking, live, primary action */
--amber-soft: #C9862B;
--amber-dim:  #7A5A24;
--cream:    #F3E9D2;  /* primary text */
--muted:    #9A8B6C;  /* secondary text */
--hush:     #7D8C97;  /* cool slate: silenced */
--hush-dim: #46525B;  /* active-hush fills */
--radius:   14px;
```

### Type

- Display: **Bricolage Grotesque** (weights 400/600/800) — headlines, wordmark
- Mono: **IBM Plex Mono** (400/500/600) — labels, counters, status, ruler markings (mixer vernacular)
- Body: **IBM Plex Sans** (400/500/600)

Buttons/labels in mono are uppercase with letter-spacing ≈ .08–.14em.

## 4. Screen 1 — Location consent (first run only)

- Modal card over dark scrim. Kicker "BEFORE WE START", headline "Earshot uses your precise location".
- Copy leads with *why* (relative position → voices come from the right direction) before the ask.
- The spec's privacy promise gets its own visual "pledge" row (shield icon, amber stroke): "Your location is **never stored** — it's used in the moment, then discarded."
- Single full-width amber button labeled **OK** (per product spec) → routes into the OS location-permission flow. Small footnote: "Next, your phone will ask for permission."

## 5. Screen 2 — Headphones (each session start)

- Card, centered, large display type: **"Headphones on!"** (per product spec: large type).
- Headphones illustration (cream band, amber earcups) and an `L ◄ ► R` mono glyph row foreshadowing the stereo mechanic.
- One sentence: stereo placement only works well with stereo headphones or earbuds. **OK** proceeds to the live screen. No login exists anywhere.
- **Open question for owner (flagged, not decided):** spec shows this on every normal use; consider showing it only when the OS reports a non-stereo output route.

## 6. Screen 3 — Live soundstage (main screen)

Vertical composition (portrait): app bar → soundstage ruler → leader lines → avatar strip → spacer → mic bar.

### 6.1 App bar
Wordmark left; right-aligned mono status block: `● LIVE` (amber) and `N neighbours · refresh in M:SS` (countdown to the ~5-minute neighbor recomputation).

### 6.2 Soundstage ruler (signature element)
- Horizontal 1-px axis with 11 ticks; center tick taller and amber-dim. Mono labels `L`, `YOU`, `R` at 0/50/100%.
- One **pin** per person at `left = 50% + pan × 50%` where pan ∈ [−1, +1] and the current user is fixed at pan 0 (origin). Current user's pin: larger, cream, double-ring.
- Talking: two concentric amber rings ripple outward from the pin (1.5 s loop, staggered). Hushed (count > 0): pin turns slate.
- Pins animate position changes (0.6 s ease) — this is how the 5-minute re-map will read.

### 6.3 Leader lines
- An SVG band (~34 px tall) between ruler and strip. One cubic curve per person from **pin x** (true pan position) down to **avatar center x** (evenly spaced strip slot).
- Must be computed from measured positions (getBoundingClientRect or equivalent), not assumed slots — and recomputed on resize, strip scroll, rotation, and roster changes.
- A person's leader line turns amber-soft while they talk.
- Purpose: preserves the spec's "horizontal array sorted by audio position" while making true (possibly colliding) pan positions legible.

### 6.4 Avatar strip
- Horizontal flex row, one tile per person **including the current user**, sorted by pan.
- Tile = avatar (48 px, 12 px radius) → name (11.5 px, ellipsized) → talking bars (3 animated amber bars, hidden when silent) → hush pill.
- Avatar: deterministic identicon generated from user id (mock: 3 seeded shapes on a dark warm field; production may substitute any deterministic generator). Talking adds a 2-px amber border; the current user's avatar has a dashed muted border.
- Attenuation dimming, applied per total active hushes on that person: opacity 1 / .75 / .55 / .40 / .28 / .20 for 0–5+ hushes. (Visual analog of −10 dB per hush; someone at 4+ hushes looks as faint as they sound.)
- Crowding: tiles are `flex: 1 0 52px; max-width: 76px`; the strip container scrolls horizontally (`overflow-x: auto`) when tiles exceed the viewport. The ruler does **not** scroll — every pin stays visible.

### 6.5 Hush pill (affordance + counter, one unit)
- Rounded pill under each avatar: **fader-pulled-low icon** + count of *all* active hushes on that person. Count hides at zero (pill shows icon only).
- Fader icon (20-unit viewBox): vertical track, filled knob near the bottom, faint scale marks either side. Stroke style matches app iconography, `currentColor`.
- Neighbor pill = button: tap to hush 1 hour; tap again to undo *your* hush. Active state: slate fill (`--hush-dim`), slate border. Tooltip/long-press reveals remaining time (e.g. "Undo your hush (56 min left)"); no countdown text is shown by default (D2: keep UI quiet).
- Current user's pill = same visual, dashed border, non-interactive; its count is hushes *on you* (the spec's bidirectional accountability).

### 6.6 Mic bar
Bottom card: pulsing amber dot + "**Your mic is open.** Neighbours hear you from your position." Plain words, no numbers.

## 7. Scaling & orientation

- **Neighbor count:** the bidirectional definition means the set is your 5 nearest **plus reverse-nearest others**. In the plane, reverse-k-nearest in-degree is geometrically bounded (≈ 6k, so ~30 for k = 5) but that requires pathological arrangements; expect 5–10 typically, low teens near density edges. UI is comfortable to ~6 unscrolled (portrait), scrolls beyond. **Recommendation carried to architecture phase:** cap intake of reverse-neighbors (suggested total cap ≈ 12) — the ceiling is really simultaneous audio streams and bandwidth, not pixels.
- **Landscape:** fully supported, no alternate layout — flex reflow only. Ruler widens (better pan resolution), more tiles fit unscrolled, vertical chrome compresses (smaller ruler height, tighter mic bar, 42-px avatars). The mock has demo toggles for both crowding (+4 neighbors) and rotation.

## 8. Accessibility & motion

- Visible keyboard focus (2-px amber outline) on all interactive elements.
- `prefers-reduced-motion`: ripple rings, talking bars, mic pulse, and pin transitions are disabled.
- Hush pills carry `aria-pressed` and descriptive titles; ruler and leader lines are `aria-hidden` (the strip is the accessible representation).

## 9. Explicitly NOT yet decided (next phases)

- Architecture: client/server split, control plane (neighbor computation, hush registry) vs. data plane (audio transport), protocol choices (ATProto adaptation was floated in the product spec). Constraint: hobby budget, no expensive server-side deployment.
- Implementation plan: web vs. native clients, hosting model, languages.
- Display names ("Kestrel", "Moss" etc. in the mock are placeholder auto-generated handles — whether/how handles are generated is an open product question).
- Headphones-dialog frequency (see §5 open question).
- Exact refresh cadence UX during the 5-minute re-map (pins animate; whether to toast/announce roster changes is undecided).

## 10. Process contract

Per the owner's original instructions, work proceeds in gated stages: **mocks (done) → architecture → implementation plan → MVP implementation**, with owner approval required between stages.
