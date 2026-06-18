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
  Turning a knob auditions the pitch and shows a note popup, so steps can be
  "played" live.
- **Switch** — PLAY / MUTE / RESET (RESET shortens the loop → polyrhythm). The
  step LED is green for PLAY, red for MUTE.
- **Play/Stop + Mute** — per track. Play/Stop starts/stops just that track,
  independently of the global RUN; Mute keeps it running but silent.
- **Length** — 8 / 16 / 32 steps.
- **Gate** — note length, 10–95 % of the step.
- **Scale** (root + type) — re-quantizes the sequence live and drives Randomize.
- **Swing** — shuffle feel (delays off-beat steps). **Probability** — chance
  each PLAY step fires.
- **Randomize / Undo / Step** — to the right of the steps. Randomize fills fresh
  scale-quantized notes + a random PLAY/MUTE pattern (RESET untouched); Undo
  reverts the last Randomize; Step advances the track one step while stopped.
- **Duplicate** — clones the track directly below it.

Global transport: RUN/STOP, a global STEP, a tap-tempo BPM readout,
clock-out port selection, and fullscreen (scales to fit, 2 columns for 5+
tracks).

## Milestones

- [x] **M1** — MIDI out, lookahead scheduler, one 8-step track (knobs + LEDs)
- [x] **M2** — 3-position toggles (MUTE/RESET), 16/32 step length
- [x] **M3** — Multi-track, per-track port/channel, MIDI clock out
- [x] **M4** — Persistence (localStorage + JSON export/import), gate-length
  knob, per-track scale selector + Randomize, polish
- [x] **M5** — Per-track Play/Stop + Mute, green/red step LEDs, tap tempo,
  per-track Duplicate
- [x] **M6** — Knob audition (hear/"play" notes), lower knob sensitivity,
  note popup
- [x] **M7** — Per-track Swing + Probability

Also: per-track Play runs independently of the global transport; fullscreen
fit-to-screen scaling (2 columns for 5+ tracks); grouped panel header with a
Randomize / Undo / Step action column.
