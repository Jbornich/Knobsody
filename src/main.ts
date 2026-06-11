import './style.css';
import { MidiManager } from './midi';
import { Scheduler } from './scheduler';
import { TrackPanel } from './track-panel';
import { createTrack } from './types';
import type { TrackState } from './types';

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

// Set of output-port ids that receive MIDI clock (0xF8) + start/stop.
const clockPortIds = new Set<string>();

const scheduler = new Scheduler(
  () => tracks,
  () => midi.getOutputs().filter(o => clockPortIds.has(o.id)),
);

let tracksContainer: HTMLElement;
let clockOutContainer: HTMLElement;

// ── Track add / remove ─────────────────────────────────────────────────────

function addTrack(): void {
  const track = createTrack(tracks.length + 1);
  const panel = new TrackPanel(track, midi, () => removeTrack(track));
  tracks.push(track);
  panels.push(panel);
  tracksContainer.appendChild(panel.el);
  panel.populatePorts();
}

function removeTrack(track: TrackState): void {
  const idx = tracks.indexOf(track);
  if (idx < 0) return;
  // Silence the track's channel so a removal mid-run leaves no hanging notes.
  scheduler.silence(track);
  panels[idx].el.remove();
  tracks.splice(idx, 1);
  panels.splice(idx, 1);
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

  // RUN / STOP
  const runBtn = document.createElement('button');
  runBtn.className = 'btn-run';
  runBtn.textContent = 'RUN';
  runBtn.addEventListener('pointerdown', async () => {
    if (scheduler.isRunning) {
      scheduler.stop();
      runBtn.textContent = 'RUN';
      runBtn.classList.remove('running');
    } else {
      await scheduler.start();
      runBtn.textContent = 'STOP';
      runBtn.classList.add('running');
    }
  });
  bar.appendChild(runBtn);

  bar.appendChild(divider());

  // BPM control
  const bpmGroup = document.createElement('div');
  bpmGroup.className = 'bpm-group';

  const bpmLabel = document.createElement('span');
  bpmLabel.className = 'bpm-label';
  bpmLabel.textContent = 'BPM';

  const bpmSlider = document.createElement('input');
  bpmSlider.type = 'range';
  bpmSlider.className = 'bpm-slider';
  bpmSlider.min = '40';
  bpmSlider.max = '240';
  bpmSlider.value = '120';
  bpmSlider.style.touchAction = 'none';

  const bpmDisplay = document.createElement('span');
  bpmDisplay.className = 'bpm-value';
  bpmDisplay.textContent = '120';

  bpmSlider.addEventListener('input', () => {
    const v = parseInt(bpmSlider.value, 10);
    scheduler.bpm = v;
    bpmDisplay.textContent = String(v);
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

// (Re)build the clock-out port toggles. Selections persist by port id across
// rebuilds; ids that no longer exist (unplugged) are dropped from the set.
function refreshClockPorts(): void {
  const outputs = midi.getOutputs();
  const liveIds = new Set(outputs.map(o => o.id));
  for (const id of [...clockPortIds]) {
    if (!liveIds.has(id)) clockPortIds.delete(id);
  }

  clockOutContainer.innerHTML = '';
  if (outputs.length === 0) {
    const none = document.createElement('span');
    none.className = 'clock-none';
    none.textContent = '(no ports)';
    clockOutContainer.appendChild(none);
    return;
  }

  for (const o of outputs) {
    const btn = document.createElement('button');
    btn.className = 'btn-clock-port' + (clockPortIds.has(o.id) ? ' active' : '');
    btn.textContent = o.name ?? o.id;
    btn.title = `Send MIDI clock to ${o.name ?? o.id}`;
    btn.style.touchAction = 'none';
    btn.addEventListener('pointerdown', () => {
      if (clockPortIds.has(o.id)) {
        clockPortIds.delete(o.id);
        btn.classList.remove('active');
      } else {
        clockPortIds.add(o.id);
        btn.classList.add('active');
      }
    });
    clockOutContainer.appendChild(btn);
  }
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

  // Start with a single track (matches the previous hardcoded behaviour).
  addTrack();

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

  requestAnimationFrame(rafLoop);
}

init();
