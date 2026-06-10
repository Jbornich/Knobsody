import './style.css';
import { MidiManager } from './midi';
import { Scheduler } from './scheduler';
import { Knob } from './knob';
import { defaultStep, midiToNoteName } from './types';
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

// Single hardcoded 8-step track for Milestone 1
const track: TrackState = {
  id: 'track-1',
  name: 'Track 1',
  steps: Array.from({ length: 8 }, defaultStep),
  length: 8,
  midiOutput: null,
  midiChannel: 1,
  gateLength: 0.5,
};

const scheduler = new Scheduler(() => [track]);

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

// ── Track panel ──────────────────────────────────────────────────────────

let portSelect: HTMLSelectElement;
const ledEls: HTMLDivElement[] = [];
const knobInstances: Knob[] = [];
const noteNameEls: HTMLSpanElement[] = [];

function populatePorts(): void {
  const outputs = midi.getOutputs();
  const prev = portSelect.value;
  portSelect.innerHTML = '<option value="">— no output —</option>';
  for (const o of outputs) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name ?? o.id;
    portSelect.appendChild(opt);
  }
  // Restore previous selection or best match by name
  if (outputs.some(o => o.id === prev)) {
    portSelect.value = prev;
  }
  applyPortSelection();
}

function applyPortSelection(): void {
  const id = portSelect.value;
  track.midiOutput = id ? (midi.getOutputs().find(o => o.id === id) ?? null) : null;
}

function buildTrackPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'track-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'track-header';

  const nameEl = document.createElement('span');
  nameEl.className = 'track-name';
  nameEl.textContent = track.name;
  header.appendChild(nameEl);

  // MIDI port selector
  const portLabel = document.createElement('label');
  portLabel.textContent = 'Port:';
  header.appendChild(portLabel);

  portSelect = document.createElement('select');
  portSelect.style.touchAction = 'none';
  portSelect.addEventListener('change', applyPortSelection);
  header.appendChild(portSelect);

  // MIDI channel selector
  const chLabel = document.createElement('label');
  chLabel.textContent = 'Ch:';
  header.appendChild(chLabel);

  const chSelect = document.createElement('select');
  chSelect.style.touchAction = 'none';
  for (let i = 1; i <= 16; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    chSelect.appendChild(opt);
  }
  chSelect.value = String(track.midiChannel);
  chSelect.addEventListener('change', () => {
    track.midiChannel = parseInt(chSelect.value, 10);
  });
  header.appendChild(chSelect);

  // Length selector (display-only for M1 — hardcoded 8)
  const lengthGroup = document.createElement('div');
  lengthGroup.className = 'length-group';
  for (const len of [8, 16, 32] as const) {
    const btn = document.createElement('button');
    btn.className = 'btn-len' + (len === 8 ? ' active' : '');
    btn.textContent = String(len);
    btn.title = `${len} steps`;
    btn.style.touchAction = 'none';
    // Length switching deferred to Milestone 2
    btn.addEventListener('pointerdown', () => {
      lengthGroup.querySelectorAll('.btn-len').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    lengthGroup.appendChild(btn);
  }
  header.appendChild(lengthGroup);
  panel.appendChild(header);

  // Steps row
  const stepsRow = document.createElement('div');
  stepsRow.className = 'steps-row';

  for (let i = 0; i < track.length; i++) {
    const cell = document.createElement('div');
    cell.className = 'step-cell';

    // LED
    const led = document.createElement('div');
    led.className = 'step-led';
    ledEls.push(led);
    cell.appendChild(led);

    // Knob
    const stepIndex = i;
    const knob = new Knob(track.steps[i].note, (note) => {
      track.steps[stepIndex].note = note;
      noteNameEls[stepIndex].textContent = midiToNoteName(note);
    });
    knobInstances.push(knob);
    cell.appendChild(knob.svgEl);

    // Note name
    const noteName = document.createElement('span');
    noteName.className = 'step-note';
    noteName.textContent = midiToNoteName(track.steps[i].note);
    noteNameEls.push(noteName);
    cell.appendChild(noteName);

    // Step number
    const stepNum = document.createElement('span');
    stepNum.className = 'step-num';
    stepNum.textContent = String(i + 1);
    cell.appendChild(stepNum);

    stepsRow.appendChild(cell);
  }

  panel.appendChild(stepsRow);
  return panel;
}

// ── rAF display loop ─────────────────────────────────────────────────────

function rafLoop(): void {
  scheduler.updateDisplay();
  const currentStep = scheduler.displaySteps[0]; // track index 0
  for (let i = 0; i < ledEls.length; i++) {
    ledEls[i].classList.toggle('active', i === currentStep);
  }
  requestAnimationFrame(rafLoop);
}

// ── Init ─────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  app.appendChild(buildTransport());
  app.appendChild(buildTrackPanel());

  try {
    await midi.init();
    populatePorts();
    midi.onStateChange(populatePorts);
  } catch (err) {
    // MIDI access denied or unavailable — show non-fatal warning in the port select
    console.warn('MIDI access failed:', err);
    const opt = document.createElement('option');
    opt.textContent = 'MIDI access denied';
    portSelect.appendChild(opt);
  }

  requestAnimationFrame(rafLoop);
}

init();
