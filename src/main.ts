import './style.css';
import { MidiManager } from './midi';
import { Scheduler } from './scheduler';
import { TrackPanel } from './track-panel';
import { createTrack } from './types';
import type { TrackState } from './types';
import { serialize, save, load, sanitize } from './persistence';
import type { SerializedState } from './persistence';

// ── App setup ────────────────────────────────────────────────────────────

document.addEventListener('contextmenu', e => e.preventDefault());

const app = document.getElementById('app')!;

if (!MidiManager.isSupported()) {
  app.innerHTML = `
    <div class="midi-error">
      <strong>Web MIDI API not available</strong>
      Knobsody requires the Web MIDI API, which is only supported in
      <strong>Chrome</strong> or <strong>Edge</strong> on desktop.<br><br>
      Please open this page in Chrome or Edge.
    </div>
  `;
  throw new Error('Web MIDI API not supported');
}

const midi = new MidiManager();

// Live app state. The scheduler reads getTracks() on every pass, so mutating
// these arrays takes effect without rescheduling.
const tracks: TrackState[] = [];
const panels: TrackPanel[] = [];

// Output-port NAMES that receive MIDI clock (0xF8) + start/stop. Name-based so
// the selection survives replug and restore (ids are not stable).
const clockPortNames = new Set<string>();

const scheduler = new Scheduler(
  () => tracks,
  () => midi.getOutputs().filter(o => o.name != null && clockPortNames.has(o.name)),
);

let tracksContainer: HTMLElement;
let clockOutContainer: HTMLElement;
let bpmSlider: HTMLInputElement;
let bpmDisplay: HTMLButtonElement;
let runBtn: HTMLButtonElement;

// Sync all transport-dependent UI to the scheduler's running state: the global
// RUN/STOP button, the body class that disables manual STEP, and every track's
// Play/Stop + Mute buttons.
function refreshUI(): void {
  const running = scheduler.isRunning;
  runBtn.textContent = running ? 'STOP' : 'RUN';
  runBtn.classList.toggle('running', running);
  document.body.classList.toggle('seq-running', running);
  panels.forEach(p => p.refresh());
}

// ── Persistence ────────────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Debounced autosave — called from every mutation point.
function requestSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    save(serialize(tracks, scheduler.bpm, [...clockPortNames]));
    saveTimer = null;
  }, 400);
}

// ── Track add / remove ─────────────────────────────────────────────────────

// Attach an existing TrackState to the DOM + state arrays at the given index
// (default: append to the end).
function mountTrack(track: TrackState, index: number = tracks.length): void {
  const panel = new TrackPanel(
    track, midi,
    () => removeTrack(track),
    requestSave,
    () => scheduler.manualStep(track),
    () => duplicateTrack(track),
    (note) => scheduler.auditionNote(track, note),
    async () => {
      if (track.enabled) scheduler.stopTrack(track);
      else await scheduler.playTrack(track);
      refreshUI();
    },
  );
  tracks.splice(index, 0, track);
  panels.splice(index, 0, panel);
  const after = panels[index + 1];
  tracksContainer.insertBefore(panel.el, after ? after.el : null);
  panel.populatePorts();
}

function addTrack(): void {
  mountTrack(createTrack(tracks.length + 1));
  requestSave();
}

// Duplicate a track; the copy is inserted directly below the source.
function duplicateTrack(source: TrackState): void {
  const idx = tracks.indexOf(source);
  if (idx < 0) return;
  const clone = createTrack(1); // fresh unique id; fields overwritten below
  clone.name = source.name + ' copy';
  clone.steps = source.steps.map(s => ({ note: s.note, mode: s.mode }));
  clone.length = source.length;
  clone.midiChannel = source.midiChannel;
  clone.gateLength = source.gateLength;
  clone.scaleRoot = source.scaleRoot;
  clone.scaleType = source.scaleType;
  clone.swing = source.swing;
  clone.probability = source.probability;
  clone.muted = source.muted;
  clone.enabled = false; // the copy starts stopped
  clone.midiOutput = source.midiOutput;
  clone.desiredPortName = source.desiredPortName ?? (source.midiOutput?.name ?? null);
  mountTrack(clone, idx + 1);
  requestSave();
}

function removeTrack(track: TrackState): void {
  const idx = tracks.indexOf(track);
  if (idx < 0) return;
  // Silence the track's channel so a removal mid-run leaves no hanging notes.
  scheduler.silence(track);
  panels[idx].el.remove();
  tracks.splice(idx, 1);
  panels.splice(idx, 1);
  requestSave();
}

function clearAllTracks(): void {
  for (const track of tracks) scheduler.silence(track);
  for (const panel of panels) panel.el.remove();
  tracks.length = 0;
  panels.length = 0;
}

// Replace the whole setup from a serialized state (restore-on-load or import).
function applyState(state: SerializedState): void {
  clearAllTracks();

  scheduler.bpm = state.bpm;
  bpmSlider.value = String(scheduler.bpm);
  bpmDisplay.textContent = String(scheduler.bpm);

  clockPortNames.clear();
  for (const name of state.clockPortNames) clockPortNames.add(name);

  for (const st of state.tracks) {
    const track = createTrack(1);          // fresh unique id
    track.name = st.name;
    track.steps = st.steps.map(s => ({ note: s.note, mode: s.mode }));
    track.length = st.length;
    track.midiChannel = st.channel;
    track.gateLength = st.gateLength;
    track.scaleRoot = st.scaleRoot;
    track.scaleType = st.scaleType;
    track.muted = st.muted;
    track.enabled = st.enabled;
    track.desiredPortName = st.portName; // resolved to a live port on populatePorts
    mountTrack(track);
  }
}

// ── Transport bar ────────────────────────────────────────────────────────

function buildTransport(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'transport-bar';

  // Branding
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = `
    <span class="brand-name">KNOBSODY</span>
    <span class="brand-sub">by Bornich Audio</span>
  `;
  bar.appendChild(brand);

  const divider = () => {
    const d = document.createElement('div');
    d.className = 'transport-divider';
    return d;
  };
  bar.appendChild(divider());

  // RUN / STOP — global transport (plays/stops all tracks).
  runBtn = document.createElement('button');
  runBtn.className = 'btn-run';
  runBtn.textContent = 'RUN';
  runBtn.addEventListener('pointerdown', async () => {
    if (scheduler.isRunning) scheduler.stop();
    else await scheduler.start();
    refreshUI();
  });
  bar.appendChild(runBtn);

  bar.appendChild(divider());

  // BPM control
  const bpmGroup = document.createElement('div');
  bpmGroup.className = 'bpm-group';

  const bpmLabel = document.createElement('span');
  bpmLabel.className = 'bpm-label';
  bpmLabel.textContent = 'BPM';

  bpmSlider = document.createElement('input');
  bpmSlider.type = 'range';
  bpmSlider.className = 'bpm-slider';
  bpmSlider.min = '40';
  bpmSlider.max = '240';
  bpmSlider.value = '120';
  bpmSlider.style.touchAction = 'none';

  bpmDisplay = document.createElement('button');
  bpmDisplay.className = 'bpm-value';
  bpmDisplay.textContent = '120';
  bpmDisplay.title = 'Tap to set tempo';
  bpmDisplay.style.touchAction = 'none';

  bpmSlider.addEventListener('input', () => {
    const v = parseInt(bpmSlider.value, 10);
    scheduler.bpm = v;
    bpmDisplay.textContent = String(v);
    requestSave();
  });

  // Tap tempo: derive BPM from the average interval of recent taps. A gap of
  // more than 2 s starts a fresh measurement.
  let tapTimes: number[] = [];
  bpmDisplay.addEventListener('pointerdown', () => {
    const now = performance.now();
    if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length > 5) tapTimes.shift();
    if (tapTimes.length < 2) return;
    let total = 0;
    for (let i = 1; i < tapTimes.length; i++) total += tapTimes[i] - tapTimes[i - 1];
    const bpm = Math.round(60000 / (total / (tapTimes.length - 1)));
    scheduler.bpm = bpm; // setter clamps to 40–240
    bpmSlider.value = String(scheduler.bpm);
    bpmDisplay.textContent = String(scheduler.bpm);
    requestSave();
  });

  bpmGroup.appendChild(bpmLabel);
  bpmGroup.appendChild(bpmSlider);
  bpmGroup.appendChild(bpmDisplay);
  bar.appendChild(bpmGroup);

  bar.appendChild(divider());

  // Clock-out port selection (one toggle per output port)
  const clockGroup = document.createElement('div');
  clockGroup.className = 'clock-group';
  const clockLabel = document.createElement('span');
  clockLabel.className = 'clock-label';
  clockLabel.textContent = 'CLOCK OUT';
  clockGroup.appendChild(clockLabel);
  clockOutContainer = document.createElement('div');
  clockOutContainer.className = 'clock-ports';
  clockGroup.appendChild(clockOutContainer);
  bar.appendChild(clockGroup);

  bar.appendChild(divider());

  // + track
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-track';
  addBtn.textContent = '+ track';
  addBtn.style.touchAction = 'none';
  addBtn.addEventListener('pointerdown', () => addTrack());
  bar.appendChild(addBtn);

  // Export / import setup as JSON
  bar.appendChild(buildSetupIO());

  // Global manual STEP — advances every track one step while stopped.
  const stepAllBtn = document.createElement('button');
  stepAllBtn.className = 'btn-step btn-step-top';
  stepAllBtn.textContent = 'STEP ▸';
  stepAllBtn.title = 'Advance all tracks one step (when stopped)';
  stepAllBtn.style.touchAction = 'none';
  stepAllBtn.addEventListener('pointerdown', () => scheduler.manualStepAll());
  bar.appendChild(stepAllBtn);

  // Fullscreen toggle (far right)
  const fsBtn = document.createElement('button');
  fsBtn.className = 'btn-fullscreen';
  fsBtn.title = 'Toggle fullscreen';
  fsBtn.textContent = '⛶';
  fsBtn.addEventListener('pointerdown', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
  bar.appendChild(fsBtn);

  return bar;
}

// Export-/import-setup buttons. Export downloads the full setup as JSON; import
// reads a JSON file, validates it, and replaces the whole setup.
function buildSetupIO(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'io-group';

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn-io';
  exportBtn.textContent = 'Export';
  exportBtn.title = 'Download the whole setup as a JSON file';
  exportBtn.style.touchAction = 'none';
  exportBtn.addEventListener('pointerdown', () => {
    const json = JSON.stringify(serialize(tracks, scheduler.bpm, [...clockPortNames]), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'knobsody-setup.json';
    a.click();
    URL.revokeObjectURL(url);
  });
  group.appendChild(exportBtn);

  const importBtn = document.createElement('button');
  importBtn.className = 'btn-io';
  importBtn.textContent = 'Import';
  importBtn.title = 'Load a setup from a JSON file';
  importBtn.style.touchAction = 'none';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      const state = sanitize(JSON.parse(await file.text()));
      if (!state) { alert('That file is not a valid Knobsody setup.'); return; }
      applyState(state);
      // Resolve ports against the currently enumerated MIDI outputs.
      panels.forEach(p => p.populatePorts());
      refreshClockPorts();
      requestSave();
    } catch {
      alert('Could not read that file.');
    }
  });

  importBtn.addEventListener('pointerdown', () => fileInput.click());
  group.appendChild(importBtn);
  group.appendChild(fileInput);
  return group;
}

// (Re)build the clock-out port toggles. Selection is name-based, so it survives
// replug and restore automatically; a port simply shows active when its name is
// in clockPortNames.
function refreshClockPorts(): void {
  const outputs = midi.getOutputs();
  clockOutContainer.innerHTML = '';

  if (outputs.length === 0) {
    const none = document.createElement('span');
    none.className = 'clock-none';
    none.textContent = '(no ports)';
    clockOutContainer.appendChild(none);
    return;
  }

  for (const o of outputs) {
    const name = o.name ?? o.id;
    const btn = document.createElement('button');
    btn.className = 'btn-clock-port' + (clockPortNames.has(name) ? ' active' : '');
    btn.textContent = name;
    btn.title = `Send MIDI clock to ${name}`;
    btn.style.touchAction = 'none';
    btn.addEventListener('pointerdown', () => {
      if (clockPortNames.has(name)) {
        clockPortNames.delete(name);
        btn.classList.remove('active');
      } else {
        clockPortNames.add(name);
        btn.classList.add('active');
      }
      requestSave();
    });
    clockOutContainer.appendChild(btn);
  }
}

// ── Fullscreen fit-to-screen scaling ───────────────────────────────────────

// Arrange the track panels in N columns (1 = the default vertical stack).
function setColumns(cols: number): void {
  if (cols >= 2) {
    tracksContainer.style.display = 'grid';
    tracksContainer.style.gridTemplateColumns = 'max-content '.repeat(cols).trim();
    tracksContainer.style.alignItems = 'start'; // panels keep their own height
  } else {
    tracksContainer.style.display = '';
    tracksContainer.style.gridTemplateColumns = '';
    tracksContainer.style.alignItems = '';
  }
}

// Lay out in `cols` columns, then measure the fit-scale for the current
// viewport. offsetWidth/Height are layout sizes (unaffected by the transform),
// and the .fs-scaled class makes #app size to its natural content.
function fitScaleForColumns(cols: number): number {
  setColumns(cols);
  app.style.transform = 'none';
  const w = app.offsetWidth;
  const h = app.offsetHeight;
  if (w === 0 || h === 0) return 0;
  return Math.min(window.innerWidth / w, window.innerHeight / h);
}

// In fullscreen, scale the whole app so every track fits without scrolling.
// From 5 tracks up, also try a 2-column layout and keep it when it lets the
// panels be larger (it won't, e.g., for very wide 32-step tracks).
function applyFullscreenScale(): void {
  const root = document.documentElement;
  if (!document.fullscreenElement) {
    root.classList.remove('fs-scaled');
    setColumns(1);
    app.style.transform = '';
    return;
  }
  root.classList.add('fs-scaled');

  const candidates = panels.length >= 5 ? [1, 2] : [1];
  let best = { cols: 1, scale: 0 };
  for (const cols of candidates) {
    const scale = fitScaleForColumns(cols);
    if (scale > best.scale) best = { cols, scale };
  }
  setColumns(best.cols);
  app.style.transform = `scale(${best.scale})`;
}

// ── rAF display loop ─────────────────────────────────────────────────────

function rafLoop(): void {
  scheduler.updateDisplay();
  for (let i = 0; i < panels.length; i++) {
    panels[i].updateLeds(scheduler.displayStepFor(tracks[i].id));
  }
  requestAnimationFrame(rafLoop);
}

// ── Init ─────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  app.appendChild(buildTransport());

  tracksContainer = document.createElement('div');
  tracksContainer.className = 'tracks-container';
  app.appendChild(tracksContainer);

  // Pay the AudioContext construction cost now, and resume it on the very first
  // user gesture, so the clock is already running when the user presses RUN
  // (no first-press startup delay). Capture phase so it runs before RUN's own
  // handler if the first gesture happens to be the RUN button itself.
  scheduler.prewarm();
  const warmUp = () => { scheduler.resumeContext(); };
  window.addEventListener('pointerdown', warmUp, { once: true, capture: true });

  // Restore the saved setup, or start with a single default track.
  const saved = load();
  if (saved && saved.tracks.length > 0) {
    applyState(saved);
  } else {
    addTrack();
  }

  try {
    await midi.init();
    // One statechange handler refreshes every panel's ports plus the clock list,
    // so hot-plugging a multi-port interface keeps all selectors in sync.
    const refreshAll = () => {
      panels.forEach(p => p.populatePorts());
      refreshClockPorts();
    };
    refreshAll();
    midi.onStateChange(refreshAll);
  } catch (err) {
    // MIDI access denied or unavailable — non-fatal; show it in the clock list.
    console.warn('MIDI access failed:', err);
    clockOutContainer.innerHTML = '<span class="clock-none">MIDI access denied</span>';
  }

  // Re-fit on entering/leaving fullscreen, on viewport resize, and whenever the
  // content size changes (adding/removing tracks, changing length) — the
  // ResizeObserver watches #app's layout size, which the transform does not
  // affect, so there is no feedback loop.
  document.addEventListener('fullscreenchange', applyFullscreenScale);
  window.addEventListener('resize', applyFullscreenScale);
  new ResizeObserver(() => applyFullscreenScale()).observe(app);

  requestAnimationFrame(rafLoop);
}

init();
