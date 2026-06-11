import { Knob } from './knob';
import { Switch } from './switch';
import {
  defaultStep, midiToNoteName, randomizeTrack,
  NOTE_MIN, NOTE_MAX, NOTE_DEFAULT,
  GATE_MIN, GATE_MAX, GATE_DEFAULT, PITCH_CLASS_NAMES,
} from './types';
import type { TrackState, ScaleType } from './types';
import type { MidiManager } from './midi';

const SCALE_TYPES: ScaleType[] = ['chromatic', 'major', 'minor', 'pentatonic'];

// One sequencer panel bound to a single TrackState. Owns all of its DOM and
// per-step element arrays, so the app can hold many panels side by side and
// add/remove them independently.
export class TrackPanel {
  readonly el: HTMLElement;
  private readonly track: TrackState;
  private readonly midi: MidiManager;
  private readonly onChange: () => void;

  private stepsContainer!: HTMLElement;
  private portSelect!: HTMLSelectElement;

  // Per-step element arrays, rebuilt on every length change.
  private ledEls: HTMLDivElement[] = [];
  private cellEls: HTMLDivElement[] = [];
  private knobInstances: Knob[] = [];
  private noteNameEls: HTMLSpanElement[] = [];

  private lastLitStep = -1;

  // onChange is fired whenever user-visible track data mutates, so the app can
  // debounce-save. It is NOT fired during programmatic restore (populatePorts).
  constructor(track: TrackState, midi: MidiManager, onRemove: () => void, onChange: () => void) {
    this.track = track;
    this.midi = midi;
    this.onChange = onChange;
    this.el = this.build(onRemove);
  }

  // ── Public API used by the app shell ─────────────────────────────────────

  // Light the LED for the current playhead step; clear the previous one. Cheap
  // enough to call every rAF frame — only touches classes when the step changes.
  updateLeds(currentStep: number): void {
    if (currentStep === this.lastLitStep) return;
    if (this.lastLitStep >= 0 && this.lastLitStep < this.ledEls.length) {
      this.ledEls[this.lastLitStep].classList.remove('active');
    }
    if (currentStep >= 0 && currentStep < this.ledEls.length) {
      this.ledEls[currentStep].classList.add('active');
    }
    this.lastLitStep = currentStep;
  }

  // Refresh the output-port dropdown (called on load and on MIDI statechange).
  // Restores selection by id if still present, else by the saved port name
  // (graceful fallback when a port comes back after a replug or restore).
  populatePorts(): void {
    const outputs = this.midi.getOutputs();
    this.portSelect.innerHTML = '<option value="">— no output —</option>';
    for (const o of outputs) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.name ?? o.id;
      this.portSelect.appendChild(opt);
    }

    let selId = '';
    if (this.track.midiOutput && outputs.some(o => o.id === this.track.midiOutput!.id)) {
      selId = this.track.midiOutput.id;
    } else if (this.track.desiredPortName) {
      const match = outputs.find(o => o.name === this.track.desiredPortName);
      if (match) selId = match.id;
    }
    this.portSelect.value = selId;
    this.applyPortSelection();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private applyPortSelection(): void {
    const id = this.portSelect.value;
    const port = id ? (this.midi.getOutputs().find(o => o.id === id) ?? null) : null;
    this.track.midiOutput = port;
    // Remember the chosen name so it can be restored across sessions / replugs.
    this.track.desiredPortName = port ? (port.name ?? null) : null;
  }

  // Change the track length, preserving existing step data. The data array only
  // ever grows, so shrinking then re-growing restores the previous steps.
  private setLength(newLen: 8 | 16 | 32): void {
    while (this.track.steps.length < newLen) this.track.steps.push(defaultStep());
    this.track.length = newLen;
    this.renderSteps();
  }

  // (Re)build the step cells into rows of 16 and reset the per-step element
  // arrays. Called on first build, on length change, and after Randomize.
  private renderSteps(): void {
    this.ledEls.length = 0;
    this.cellEls.length = 0;
    this.knobInstances.length = 0;
    this.noteNameEls.length = 0;
    this.lastLitStep = -1;
    this.stepsContainer.innerHTML = '';

    const PER_ROW = 16;
    for (let rowStart = 0; rowStart < this.track.length; rowStart += PER_ROW) {
      const row = document.createElement('div');
      row.className = 'steps-row';
      const rowEnd = Math.min(rowStart + PER_ROW, this.track.length);
      for (let i = rowStart; i < rowEnd; i++) {
        row.appendChild(this.buildStepCell(i));
      }
      this.stepsContainer.appendChild(row);
    }
    this.updateDimming();
  }

  // Build a single step cell (LED, knob, note name, switch, step number).
  private buildStepCell(i: number): HTMLDivElement {
    const cell = document.createElement('div');
    cell.className = 'step-cell';
    this.cellEls.push(cell);

    // LED
    const led = document.createElement('div');
    led.className = 'step-led';
    this.ledEls.push(led);
    cell.appendChild(led);

    // Knob — chromatic MIDI note, C1–C6, double-tap resets to C3.
    const knob = new Knob({
      min: NOTE_MIN, max: NOTE_MAX, value: this.track.steps[i].note, default: NOTE_DEFAULT,
      step: 1, pxPerUnit: 2,
      title: midiToNoteName,
      onChange: (note) => {
        this.track.steps[i].note = note;
        this.noteNameEls[i].textContent = midiToNoteName(note);
        this.onChange();
      },
    });
    this.knobInstances.push(knob);
    cell.appendChild(knob.svgEl);

    // Note name
    const noteName = document.createElement('span');
    noteName.className = 'step-note';
    noteName.textContent = midiToNoteName(this.track.steps[i].note);
    this.noteNameEls.push(noteName);
    cell.appendChild(noteName);

    // 3-position toggle switch (PLAY / MUTE / RESET)
    const sw = new Switch(this.track.steps[i].mode, (mode) => {
      this.track.steps[i].mode = mode;
      this.updateDimming();
      this.onChange();
    });
    cell.appendChild(sw.svgEl);

    // Step number
    const stepNum = document.createElement('span');
    stepNum.className = 'step-num';
    stepNum.textContent = String(i + 1);
    cell.appendChild(stepNum);

    return cell;
  }

  // Steps after the first RESET step fall outside the effective loop; dim them
  // (knobs stay turnable and the note stays visible — only opacity is reduced).
  private updateDimming(): void {
    let firstReset = -1;
    for (let i = 0; i < this.track.length; i++) {
      if (this.track.steps[i].mode === 'reset') { firstReset = i; break; }
    }
    // firstReset > 0: a RESET on step 1 is ignored (matches effectiveLength).
    // The RESET step itself is dimmed too — it sits outside the effective loop.
    for (let i = 0; i < this.cellEls.length; i++) {
      this.cellEls[i].classList.toggle('dimmed', firstReset > 0 && i >= firstReset);
    }
  }

  private build(onRemove: () => void): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'track-panel';

    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'track-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'track-name';
    nameEl.textContent = this.track.name;
    header.appendChild(nameEl);

    // MIDI port selector
    header.appendChild(this.label('Port:'));
    this.portSelect = document.createElement('select');
    this.portSelect.style.touchAction = 'none';
    this.portSelect.addEventListener('change', () => {
      this.applyPortSelection();
      this.onChange();
    });
    header.appendChild(this.portSelect);

    // MIDI channel selector
    header.appendChild(this.label('Ch:'));
    const chSelect = document.createElement('select');
    chSelect.style.touchAction = 'none';
    for (let i = 1; i <= 16; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(i);
      chSelect.appendChild(opt);
    }
    chSelect.value = String(this.track.midiChannel);
    chSelect.addEventListener('change', () => {
      this.track.midiChannel = parseInt(chSelect.value, 10);
      this.onChange();
    });
    header.appendChild(chSelect);

    // Length selector (8 / 16 / 32)
    const lengthGroup = document.createElement('div');
    lengthGroup.className = 'length-group';
    for (const len of [8, 16, 32] as const) {
      const btn = document.createElement('button');
      btn.className = 'btn-len' + (len === this.track.length ? ' active' : '');
      btn.textContent = String(len);
      btn.title = `${len} steps`;
      btn.style.touchAction = 'none';
      btn.addEventListener('pointerdown', () => {
        lengthGroup.querySelectorAll('.btn-len').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setLength(len);
        this.onChange();
      });
      lengthGroup.appendChild(btn);
    }
    header.appendChild(lengthGroup);

    // Gate-length knob (10–95 % of the step duration)
    header.appendChild(this.buildGateControl());

    // Scale selector (root + type) — drives Randomize only
    header.appendChild(this.buildScaleControl());

    // Randomize button
    const randBtn = document.createElement('button');
    randBtn.className = 'btn-randomize';
    randBtn.textContent = 'RANDOMIZE';
    randBtn.title = 'Randomize notes (scale-quantized) and PLAY/MUTE pattern';
    randBtn.style.touchAction = 'none';
    randBtn.addEventListener('pointerdown', () => {
      randomizeTrack(this.track);
      this.renderSteps();
      this.onChange();
    });
    header.appendChild(randBtn);

    // Remove-track button (pushed to the far right)
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-track';
    removeBtn.title = 'Remove this track';
    removeBtn.textContent = '✕';
    removeBtn.style.touchAction = 'none';
    removeBtn.addEventListener('pointerdown', onRemove);
    header.appendChild(removeBtn);

    panel.appendChild(header);

    // ── Steps ───────────────────────────────────────────────────────────
    this.stepsContainer = document.createElement('div');
    this.stepsContainer.className = 'steps-container';
    panel.appendChild(this.stepsContainer);
    this.renderSteps();

    return panel;
  }

  private buildGateControl(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'gate-group';
    group.appendChild(this.label('Gate'));

    const valueEl = document.createElement('span');
    valueEl.className = 'gate-value';
    valueEl.textContent = Math.round(this.track.gateLength * 100) + '%';

    const knob = new Knob({
      min: GATE_MIN, max: GATE_MAX, value: this.track.gateLength, default: GATE_DEFAULT,
      step: 0.01, pxPerUnit: 200, size: 56,
      title: v => `Gate ${Math.round(v * 100)}%`,
      onChange: (v) => {
        this.track.gateLength = v;
        valueEl.textContent = Math.round(v * 100) + '%';
        this.onChange();
      },
    });
    group.appendChild(knob.svgEl);
    group.appendChild(valueEl);
    return group;
  }

  private buildScaleControl(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'scale-group';
    group.appendChild(this.label('Scale'));

    const rootSelect = document.createElement('select');
    rootSelect.style.touchAction = 'none';
    PITCH_CLASS_NAMES.forEach((name, pc) => {
      const opt = document.createElement('option');
      opt.value = String(pc);
      opt.textContent = name;
      rootSelect.appendChild(opt);
    });
    rootSelect.value = String(this.track.scaleRoot);
    rootSelect.addEventListener('change', () => {
      this.track.scaleRoot = parseInt(rootSelect.value, 10);
      this.onChange();
    });
    group.appendChild(rootSelect);

    const typeSelect = document.createElement('select');
    typeSelect.style.touchAction = 'none';
    for (const t of SCALE_TYPES) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      typeSelect.appendChild(opt);
    }
    typeSelect.value = this.track.scaleType;
    typeSelect.addEventListener('change', () => {
      this.track.scaleType = typeSelect.value as ScaleType;
      this.onChange();
    });
    group.appendChild(typeSelect);
    return group;
  }

  private label(text: string): HTMLLabelElement {
    const l = document.createElement('label');
    l.textContent = text;
    return l;
  }
}
