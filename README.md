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

The app is published to GitHub Pages on every push to `main`. Open it in Edge
kiosk mode (HTTPS, so the MIDI permission is remembered):

```
msedge --kiosk https://jbornich.github.io/Knobsody/
```

You need to be online to load the page; after that it runs locally in the
browser. Saved state (localStorage) is tied to this URL + browser, so use
**Export / Import** to move a setup between machines.

### Offline alternative — single-file build

`npm run build` also produces a self-contained `dist/index.html` that runs from
`file://` with no server:

```
msedge --kiosk "file:///C:/path/to/Knobsody/dist/index.html"
```

Keep it at a **stable path** so saved state persists, and **Export** before
moving it.

## `file://` caveats

- **MIDI permission** may be re-prompted each session when using `file://`. This is a browser security policy — the hosted HTTPS URL avoids it.
- **localStorage** is tied to the exact file path. Moving or renaming the file will lose saved state. Use the JSON export to back up your setup.

## GitHub Pages deployment

Push to `main` — the GitHub Actions workflow (`.github/workflows/deploy.yml`)
builds and publishes `dist/` to Pages automatically. `base: './'` supports both
the Pages subpath (`/Knobsody/`) and the `file://` single-file build.

## Saving your setup

- The full setup (tracks, steps, tempo, port/channel choices, gate, scale,
  clock-out ports) **autosaves to localStorage** on every change and restores
  on load. MIDI ports are remembered by name and re-selected when available,
  falling back to "no output" if a port is missing.
- Use **Export** to download the whole setup as a JSON file and **Import** to
  load one back — handy for backups and for moving a setup between machines or
  `file://` paths (where localStorage does not carry over).

## Per-track controls

- **Knob** — MIDI note per step (drag vertically; double-tap resets to C3).
- **Switch** — PLAY / MUTE / RESET (RESET shortens the loop → polyrhythm).
- **Length** — 8 / 16 / 32 steps.
- **Gate** — note length, 10–95 % of the step.
- **Scale** (root + type) + **Randomize** — fills the track with fresh
  scale-quantized notes and a random PLAY/MUTE pattern; RESET steps are left
  untouched so the loop length never changes silently.

## Milestones

- [x] **M1** — MIDI out, lookahead scheduler, one 8-step track (knobs + LEDs)
- [x] **M2** — 3-position toggles (MUTE/RESET), 16/32 step length
- [x] **M3** — Multi-track, per-track port/channel, MIDI clock out
- [x] **M4** — Persistence (localStorage + JSON export/import), gate-length
  knob, per-track scale selector + Randomize, polish
