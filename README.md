# Earshot

Situated audio chat: hear your geographic neighbours, spatialized in stereo.
No login. Location used in the moment, never stored.

- `docs/` — the governing documents: UI spec, architecture (v1.1), implementation plan (v1.1), and the approved interactive mock (`situated-audio-chat-mocks.html`, the UI reference implementation).
- `server/` — coordinator: RAM-only sessions, mutual 5-NN graph (cap 12), closed-form pan solver with sign stability, TTL hush registry, protocol-v0 validation. `python -m pytest server/tests/` (11 tests).
- `client/` — Vite + vanilla TypeScript PWA. M0 stub proves the wss loop; the mock UI ports in at M3. Dev: `npm run dev`, then open `http://localhost:5173/?spoof=37.77,-122.42`.
- `sim/` — headless bots for solo testing (position-only now; aiortc audio at M2). `python sim/bot.py ws://127.0.0.1:8700/ws --lat 37.771 --lon -122.421 --name kestrel`
- `deploy/` — Caddyfile, systemd unit, coturn config, `install.sh` for the VPS.

## Quickstart (local)
```bash
pip install fastapi 'uvicorn[standard]' websockets pydantic
uvicorn server.app:app --port 8700          # terminal 1
cd client && npm install && npm run dev     # terminal 2
python sim/bot.py ws://127.0.0.1:8700/ws --lat 37.7712 --lon -122.4210 --name kestrel  # terminal 3+
```
Open http://localhost:5173/?spoof=37.7710,-122.4212 — the status line should count your bots as neighbours.

## Milestones
M0 scaffold+deploy ✓(seed) · M1 control plane · M2 mesh audio · M3 full UI · M4 field test.
Protocol v0 is FROZEN (`server/protocol.py`) for interop with the parallel implementation.
