import { Knob } from './knob';
import { Switch } from './switch';
import { defaultStep, midiToNoteName } from './types';
import type { TrackState } from './types';
import type { MidiManager } from './midi';

// One sequencer panel bound to a single TrackState. Owns all of its DOM and
// per-step element arrays, so the app can hold many panels side by side and
// add/remove them independently.
export class TrackPanel {
  readonly el: HTMLElement;
  private readonly track: TrackState;
  private readonly midi: MidiManager;

  private stepsContainer!: HTMLElement;
  private portSelect!: HTMLSelectElement;

  // Per-step element arrays, rebuilt on every length change.
  private ledEls: HTMLDivElement[] = [];
  private cellEls: HTMLDivElement[] = [];
  private knobInstances: Knob[] = [];
  private noteNameEls: HTMLSpanElement[] = [];

  private lastLitStep = -1;

  constructor(track: TrackState, midi: MidiManager, onRemove: () => void) {
    this.track = track;
    this.midi = midi;
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
  // Restores the current selection by id, falling back to "no output".
  populatePorts(): void {
    const outputs = this.midi.getOutputs();
    const prev = this.portSelect.value;
    this.portSelect.innerHTML = '<option value="">— no output —</option>';
    for (const o of outputs) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.name ?? o.id;
      this.portSelect.appendChild(opt);
    }
    if (outputs.some(o => o.id === prev)) {
      this.portSelect.value = prev;
    }
    this.applyPortSelection();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private applyPortSelection(): void {
    const id = this.portSelect.value;
    this.track.midiOutput = id
      ? (this.midi.getOutputs().find(o => o.id === id) ?? null)
      : null;
  }

  // Change the track length, preserving existing step data. The data array only
  // ever grows, so shrinking then re-growing restores the previous steps.
  private setLength(newLen: 8 | 16 | 32): void {
    while (this.track.steps.length < newLen) this.track.steps.push(defaultStep());
    this.track.length = newLen;
    this.renderSteps();
  }

  // (Re)build the step cells into rows of 16 and reset the per-step element
  // arrays. Called on first build and on every length change.
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

    // Knob
    const knob = new Knob(this.track.steps[i].note, (note) => {
      this.track.steps[i].note = note;
      this.noteNameEls[i].textContent = midiToNoteName(note);
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
    const portLabel = document.createElement('label');
    portLabel.textContent = 'Port:';
    header.appendChild(portLabel);

    this.portSelect = document.createElement('select');
    this.portSelect.style.touchAction = 'none';
    this.portSelect.addEventListener('change', () => this.applyPortSelection());
    header.appendChild(this.portSelect);

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
    chSelect.value = String(this.track.midiChannel);
    chSelect.addEventListener('change', () => {
      this.track.midiChannel = parseInt(chSelect.value, 10);
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
      });
      lengthGroup.appendChild(btn);
    }
    header.appendChild(lengthGroup);

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
}
