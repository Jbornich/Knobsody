# Knobsody — analog-style MIDI step sequencer (web app)

**Product name:** Knobsody (by Bornich Audio). Repo name: `knobsody`.
Show "KNOBSODY" as panel branding in the transport bar with a smaller
"by Bornich Audio" beneath it, styled like silkscreen print on hardware.
Browser tab title: "Knobsody — Bornich Audio".

## Purpose
A browser-based emulation of an analog hardware step sequencer with MIDI output,
for live standalone use with hardware synthesizers. Desktop only, Chrome/Edge
(Web MIDI API is not available in Safari/iOS — show a clear error if missing).

## Stack
- Vite + TypeScript, vanilla DOM/SVG. No UI framework, no backend.
- Web MIDI API directly (`navigator.requestMIDIAccess()`), no wrapper library.
- Code comments in English.

## Core concepts

### Tracks
- Each track is a full sequencer panel bound to one MIDI output port + channel.
- Tracks are stacked vertically, visually separated, ALL always visible.
  No tabs, no collapsing, no view switching, no menus. Adding a track appends
  a new panel; removing deletes it.
- Fullscreen fit: in fullscreen the whole app is scaled so every track is
  visible without scrolling. From 5 tracks up it may arrange panels in two
  columns when that keeps them larger (it falls back to one column when two
  would be smaller, e.g. for very wide 32-step tracks).
- All tracks share one master clock but each track has its own step counter.

### Steps
- Per-track length selector: 8 / 16 / 32. Steps render in rows of 16:
  length 8 = one row of 8; length 16 = one full row of 16 (8 + 8 side by
  side, with a slightly larger visual gap between step 8 and 9 for
  readability); length 32 = two rows of 16. Changing length adds/removes
  steps in place; existing step data is preserved.
- Layout assumes a wide screen (≥ ~1600 px). On narrower viewports, scale
  the whole panel down proportionally rather than re-wrapping rows.
- Each step has:
  1. **Rotary knob** — sets MIDI note (pitch). Vertical drag to turn,
     double-click to reset to C3. Range C1–C6, chromatic. Show note name
     under the knob. Turning a knob auditions the pitch (note sent on press and
     on every change, in stop or run mode, ignoring track mute — so steps can be
     "played"; no-ops with no port) and shows a larger note popup to the LEFT of
     the knob while adjusting. Knobs themselves stay chromatic. A per-track scale
     (root note + scale type) is part of v1 to drive Randomize (see below)
     and to re-quantize the existing sequence: changing the scale root or
     type immediately snaps every step's note to the nearest note in the
     chosen scale, so the user can audition keys/scales live (chromatic =
     no change). Manual quantize-on-turn for the knobs remains an optional
     nice-to-have.
  2. **3-position toggle switch** — laid out like a traffic light:
     RESET (top, red) / MUTE (middle, yellow) / PLAY (bottom, green).
     Default is PLAY. Interaction: tap/click toggles upward
     PLAY → MUTE → RESET and wraps back to PLAY (no dragging required):
     - PLAY: note fires when the playhead hits the step.
     - MUTE: the step consumes clock time but sends nothing (timing preserved).
     - RESET: when the counter REACHES this step, it immediately jumps to
       step 1 WITHOUT playing the step. This shortens the effective loop
       and is the polyrhythm mechanism (e.g. track 1 loops 16, track 2 has
       RESET on step 13 → 12-step loop against 16).
  3. **Step LED** — lit while the playhead is on the step (running-light chase):
     green for a PLAY step, red for a MUTE step (red/green is easier to read at
     speed than yellow/green).
- The RESET step itself and all steps after it (outside the effective loop)
  render dimmed.

### Randomize (Milestone 4)
- A per-track **Randomize** button in the panel header. Randomizes that
  track's step data in place (only the pressed track is affected):
  - **Notes**: a fresh random pitch per step, quantized to the track's
    selected scale (root + scale type), within C1–C6.
  - **Modes**: a fresh random PLAY/MUTE pattern per step. RESET is left
    untouched, so randomizing never silently changes the loop length.
- Requires a per-track scale selector (root note + scale type — e.g. major,
  minor, pentatonic, chromatic). Chromatic = no constraint.
- Writes only to step data; the lookahead scheduler picks the new values up
  on its next pass with no rescheduling glitch (it reads `getTracks()` live).

### Clock & scheduling (critical — do not use setInterval as the clock)
- The app is CLOCK MASTER. Internal clock only, no external sync in v1.
- Lookahead scheduler pattern (Chris Wilson, "A Tale of Two Clocks",
  https://web.dev/articles/audio-scheduling):
  - A timer ticks every ~25 ms and schedules all events falling within the
    next ~100 ms window.
  - Time base: `AudioContext.currentTime` (create a silent AudioContext).
  - MIDI events are sent with a FUTURE timestamp:
    `output.send(bytes, performance.now() + deltaMs)` — convert AudioContext
    time to the `performance.now()` timebase once at startup. The browser
    then emits them with sub-millisecond accuracy regardless of main-thread jank.
- Note off: schedule explicitly. Gate length = per-track knob, 10–95 % of the
  step duration. Default 50 %. Always send note-off before a re-trigger of the
  same note (no hanging notes).
- Velocity: fixed 100 in v1.
- Tempo: 40–240 BPM, one step = one 16th note.
- **MIDI clock out**: send 0xF8 at 24 ppqn plus 0xFA (start) / 0xFC (stop) on
  transport, scheduled through the same lookahead mechanism, to a user-selected
  set of output ports (so hardware can sync to the app).
- Stop = all-notes-off (CC 123) on every active channel.

### Playhead UI
- Decoupled from the scheduler: a `requestAnimationFrame` loop reads the
  scheduler's "current step per track" state and updates LEDs. The scheduler
  must never wait on rendering.

### MIDI I/O
- Enumerate outputs on load; per-track selectors for output port and channel
  (1–16). Handle `statechange` for hot-plugging interfaces (the user runs a
  multi-port USB MIDI interface).
- Request access WITHOUT sysex.

### Persistence
- Autosave full app state (tracks, steps, tempo, port/channel choices) to
  localStorage on change (debounced). Restore on load; reselect MIDI ports by
  name with graceful fallback if a port is missing.
- Export/import the whole setup as a JSON file.

## Visual design (hardware-panel aesthetic)
- Dark faceplate panels (#2C2C2A), one panel per track, rounded corners,
  generous spacing between panels.
- Per step, vertically: LED (green when active, red on a MUTE step), knob
  (dark with light pointer line), note name, 3-position switch (traffic light:
  red = RESET top, yellow = MUTE middle, green = PLAY bottom), step number.
- Panel header: track name, per-track Play/Stop + Mute toggles, MIDI
  port/channel selectors, length selector (8/16/32 buttons), per-track
  gate-length knob, scale selector (root + type), swing + probability knobs, a
  Randomize button, a manual STEP button, and (right-aligned) Duplicate +
  Remove. Duplicate inserts a copy directly below the track.
- Per-track Swing delays the off-beat (odd) steps for a shuffle feel without
  drifting the grid; per-track Probability is the chance each PLAY step actually
  fires (rolled per trigger, so the pattern varies between loops — the step
  still keeps its LED/timing slot when skipped).
- Per-track Play/Stop starts/stops just that track, independently of the global
  transport — pressing a track's PLAY starts it even when RUN is not engaged.
  The shared clock runs whenever at least one track is playing; a track restarts
  at step 1 each time it is started. Per-track Mute keeps a track running (LEDs
  chase) but sends no notes. The button shows the action (green PLAY when
  stopped, red STOP when playing), like the global RUN/STOP button.
- Global transport bar: RUN/STOP, a global STEP button, tempo knob + BPM
  readout (the readout doubles as a tap-tempo button), clock-out port
  selection, "+ track" button.
- Manual STEP (per-track and global) advances the sequence one step while
  stopped — playing that step's note (MUTE advances silently, RESET steps are
  skipped) and lighting its LED. Disabled while running.
- Flat colors, no gradients. Knobs and switches as inline SVG.

## Touch (primary input — large touchscreen on a Windows PC)
- All interactive elements ≥ 48×48 px hit area; knobs 56–64 px diameter,
  toggles tall enough for a fingertip. Desktop mouse must still work.
- Double-tap = double-click (knob reset to C3).
- Suppress browser/OS interference: `user-select: none` globally,
  `contextmenu` preventDefault (kills long-press menu), viewport
  `user-scalable=no`, `touch-action: none` on controls,
  `touch-action: pan-y` on the page so vertical scrolling between many
  tracks still works outside controls.
- Fullscreen toggle button using the Fullscreen API (requires a user
  gesture — trigger on first tap). Recommend running Edge in kiosk mode
  for live use.
- No hover-dependent UI; every state must be visible without hover.
- Knob interaction: Pointer Events with `setPointerCapture`, vertical drag
  (~8 px per semitone — tuned to be easy to land the right note on touch).
  Track state per `pointerId` so multiple knobs can be
  turned simultaneously (multi-touch). Fine mode: Shift on mouse; on touch,
  resolution increases with horizontal finger distance from the knob.
  Set `touch-action: none` on all knobs/switches.

## Milestones (implement and verify in this order)
0. Before any code: ensure the project is a git repository with a GitHub
   remote. If `git status` fails, run `git init`, commit the scaffold +
   SPEC.md, and create the remote with
   `gh repo create knobsody --public --source . --push`.
   Commit at the end of every milestone (and after significant fixes)
   with descriptive messages.
1. MIDI out + lookahead scheduler + ONE hardcoded 8-step track (knobs + LEDs).
   Verify timing tightness against hardware before building more UI.
2. 3-position toggles with MUTE/RESET semantics; 16/32 length with
   16-per-row layout and 8/8 grouping gap.
3. Multi-track (add/remove panels), per-track port/channel, MIDI clock out.
4. Persistence (localStorage + JSON export/import), gate-length knob,
   per-track scale selector + Randomize button (scale-quantized notes +
   modes), polish.

## Build & deployment
- `npm run build` must produce TWO usable outputs from the same codebase:
  1. **Single-file build**: use `vite-plugin-singlefile` so `dist/index.html`
     is fully self-contained (all JS/CSS inlined). It must work when opened
     directly via `file://` (double-click on the desktop) — no module/CORS
     errors, no external asset requests at runtime.
  2. **Static hosting**: the same `dist/` output deploys to GitHub Pages.
     Add a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
     builds and publishes `dist/` to Pages on every push to `main`.
     Set Vite `base: './'` (works for both the GitHub Pages subpath
     `/knobsody/` and the `file://` single-file build).
- No runtime network requests at all: no CDN scripts, no external fonts.
  Everything bundled.
- Document in README: known `file://` caveats (MIDI permission may be
  re-prompted per session; localStorage is tied to the file path, so moving
  the file loses saved state) and the recommended live setup:
  `msedge --kiosk https://<username>.github.io/knobsody/`.

## Non-goals (v1)
- External clock sync (slave mode), MIDI input, CC sequencing,
  per-step velocity, per-step probability (probability is per-track),
  manual quantize-on-turn for knobs
  (the scale selector drives Randomize and re-quantizes the sequence on
  change, but the knobs stay chromatic while dragging),
  small-screen/phone
  layouts, iOS/iPadOS (no Web MIDI).
- Desktop packaging (see Future below).

## Future (v2) — desktop packaging
- Target: installable desktop app for Windows AND Linux.
- Decision: **Electron**, not Tauri. Tauri uses WebKitGTK on Linux, which
  has no Web MIDI — Electron bundles Chromium and behaves identically on
  both platforms. Add `session.setPermissionRequestHandler` to grant MIDI
  permission in the main process.
- Build via GitHub Actions (electron-builder) on version tags, publishing
  .exe (NSIS), AppImage and .deb as GitHub Release assets.
- Known caveat: unsigned Windows builds trigger SmartScreen; code signing
  (e.g. Azure Trusted Signing) only if distribution beyond personal use.
- Note: the web app already runs on Linux in Chrome/Chromium (ALSA);
  avoid the Ubuntu Chromium snap for MIDI access (sandbox restrictions) —
  use the Google Chrome .deb.