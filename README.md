# Earshot

Situated audio chat: hear your geographic neighbours, spatialized in stereo.
No login. Location used in the moment, never stored.

- `docs/` — the governing documents: UI spec, architecture (v1.1), implementation plan (v1.1), and the approved interactive mock (`situated-audio-chat-mocks.html`, the UI reference implementation).
- `server/` — coordinator: RAM-only sessions, mutual 5-NN graph (cap 12), closed-form pan solver with sign stability, TTL hush registry, protocol-v0 validation. `python -m pytest server/tests/` (11 tests).
- `client/` — Vite + vanilla TypeScript PWA: full soundstage UI plus the WebRTC mesh and Web Audio graph (hush gain → stereo pan, 0.5 s ramps), AnalyserNode VAD driving the talking rings, mic capture behind the headphones-OK gesture. Dev: `npm run dev`, then open `http://localhost:5173/?spoof=37.77,-122.42`.
- `sim/` — headless bots with real aiortc WebRTC audio: each speaks a continuous sine tone pitched by its name, so you can tell bots apart by ear and by direction. `pip install -r sim/requirements.txt`, then `python sim/bot.py ws://127.0.0.1:8700/ws --lat 37.771 --lon -122.421 --name kestrel` (add `--ice https://host/ice` when TURN is configured).
- `deploy/` — Caddyfile, systemd unit, coturn config, `install.sh` for the VPS.

## Quickstart (local)
```bash
pip install -r server/requirements.txt -r sim/requirements.txt
uvicorn server.app:app --port 8700          # terminal 1
cd client && npm install && npm run dev     # terminal 2
python sim/bot.py ws://127.0.0.1:8700/ws --lat 37.7712 --lon -122.4210 --name kestrel  # terminal 3+
```
Open http://localhost:5173/?spoof=37.7710,-122.4212 with headphones on — after the two modals you should HEAR the bots' tones, each panned to its ruler position, with talking rings pulsing. Tap a fader pill: the bot's tone drops 10 dB per hush and its tile dims. (`localStorage.clear()` in devtools resets first-run state. Chrome may need mic permission for localhost.)

## Milestones
M0 scaffold+deploy ✓ · M1 control plane ✓ · M3 UI ✓ · M2 mesh audio ✓ (bot↔bot verified end-to-end) · M4 field test ← next: `deploy/install.sh` on the VPS, then bots + your phone on LTE.
Protocol v0 is FROZEN (`server/protocol.py`) for interop with the parallel implementation.
