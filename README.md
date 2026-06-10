# Knobsody — Bornich Audio

Browser-based analog-style MIDI step sequencer. Desktop-only; requires **Chrome or Edge** (Web MIDI API is unavailable in Safari/Firefox).

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome or Edge.

## Build

```bash
npm run build
```

Produces two usable outputs from the same `dist/` folder:

| Output | How to use |
|--------|-----------|
| `dist/index.html` | Fully self-contained (all JS/CSS inlined via `vite-plugin-singlefile`). Double-click to open via `file://` — no server required. |
| `dist/` (folder) | Deploy to any static host, including GitHub Pages. |

## Recommended live setup

```
msedge --kiosk https://<username>.github.io/knobsody/
```

Or open `dist/index.html` directly in Edge kiosk mode.

## `file://` caveats

- **MIDI permission** may be re-prompted each session when using `file://`. This is a browser security policy — saving the file to a stable path and using a hosted URL avoids it.
- **localStorage** is tied to the exact file path. Moving or renaming the file will lose saved state. Use the JSON export to back up your setup.

## GitHub Pages deployment

Push to `main` — the included GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and publishes `dist/` to Pages automatically.

## Milestones

- [x] **M1** — MIDI out, lookahead scheduler, one 8-step track (knobs + LEDs)
- [ ] M2 — 3-position toggles (MUTE/RESET), 16/32 step length
- [ ] M3 — Multi-track, per-track port/channel, MIDI clock out
- [ ] M4 — Persistence, gate-length knob, polish
