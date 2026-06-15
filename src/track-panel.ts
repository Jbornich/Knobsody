import { Knob } from './knob';
import { Switch } from './switch';
import {
  defaultStep, midiToNoteName, randomizeTrack, quantizeToScale,
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
  private readonly onAudition: (note: number) => void;

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
  // onStep advances this track one step manually (used while stopped).
  constructor(
    track: TrackState,
    midi: MidiManager,
    onRemove: () => void,
    onChange: () => void,
    onStep: () => void,
    onDuplicate: () => void,
    onAudition: (note: number) => void,
  ) {
    this.track = track;
    this.midi = midi;
    this.onChange = onChange;
    this.onAudition = onAudition;
    this.el = this.build(onRemove, onStep, onDuplicate);
  }

  // ── Public API used by the app shell ─────────────────────────────────────

  // Light the LED for the current playhead step; clear the previous one. Cheap
  // enough to call every rAF frame — only touches classes when the step changes.
  updateLeds(currentStep: number): void {
    if (currentStep === this.lastLitStep) return;
    if (this.lastLitStep >= 0 && this.lastLitStep < this.ledEls.length) {
      this.ledEls[this.lastLitStep].classList.remove('active', 'muted');
    }
    if (currentStep >= 0 && currentStep < this.ledEls.length) {
      const led = this.ledEls[currentStep];
      led.classList.add('active');
      // Green for a playing step, red for a muted step.
      led.classList.toggle('muted', this.track.steps[currentStep].mode === 'mute');
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

    // Note popup, shown to the LEFT of the knob while it is being adjusted.
    const popup = document.createElement('div');
    popup.className = 'note-popup';

    // Knob — chromatic MIDI note, C1–C6, double-tap resets to C3. Turning it
    // auditions the pitch (so it can be heard / "played") and shows the popup.
    const knob = new Knob({
      min: NOTE_MIN, max: NOTE_MAX, value: this.track.steps[i].note, default: NOTE_DEFAULT,
      step: 1, pxPerUnit: 8, // ~8 px per semitone — less twitchy than before
      title: midiToNoteName,
      onChange: (note) => {
        this.track.steps[i].note = note;
        this.noteNameEls[i].textContent = midiToNoteName(note);
        popup.textContent = midiToNoteName(note);
        this.onAudition(note);
        this.onChange();
      },
      onPress: (note) => {
        popup.textContent = midiToNoteName(note);
        popup.classList.add('visible');
        this.onAudition(note);
      },
      onRelease: () => popup.classList.remove('visible'),
    });
    this.knobInstances.push(knob);

    const knobWrap = document.createElement('div');
    knobWrap.className = 'knob-wrap';
    knobWrap.appendChild(popup);
    knobWrap.appendChild(knob.svgEl);
    cell.appendChild(knobWrap);

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

  private build(onRemove: () => void, onStep: () => void, onDuplicate: () => void): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'track-panel';

    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'track-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'track-name';
    nameEl.textContent = this.track.name;
    header.appendChild(nameEl);

    // Per-track Play/Stop — freezes/resumes just this track (restarts at step 1).
    const playBtn = document.createElement('button');
    playBtn.className = 'btn-track-toggle';
    playBtn.style.touchAction = 'none';
    const renderPlay = () => {
      // Label/colour show the ACTION, like the global RUN/STOP button: a playing
      // track shows red STOP (tap to stop), a stopped track shows green PLAY.
      playBtn.textContent = this.track.enabled ? 'STOP' : 'PLAY';
      playBtn.classList.toggle('off', this.track.enabled);
      playBtn.classList.toggle('on-play', !this.track.enabled);
    };
    renderPlay();
    playBtn.title = 'Play / stop this track';
    playBtn.addEventListener('pointerdown', () => {
      this.track.enabled = !this.track.enabled;
      renderPlay();
      this.onChange();
    });
    header.appendChild(playBtn);

    // Per-track Mute — keeps running (LEDs chase) but sends no notes.
    const muteBtn = document.createElement('button');
    muteBtn.className = 'btn-track-toggle';
    muteBtn.textContent = 'MUTE';
    muteBtn.style.touchAction = 'none';
    muteBtn.title = 'Mute this track (keeps timing, sends no notes)';
    const renderMute = () => muteBtn.classList.toggle('on-mute', this.track.muted);
    renderMute();
    muteBtn.addEventListener('pointerdown', () => {
      this.track.muted = !this.track.muted;
      renderMute();
      this.onChange();
    });
    header.appendChild(muteBtn);

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

    // Manual STEP button — advances this track one step while stopped.
    const stepBtn = document.createElement('button');
    stepBtn.className = 'btn-step';
    stepBtn.textContent = 'STEP ▸';
    stepBtn.title = 'Advance this track one step (when stopped)';
    stepBtn.style.touchAction = 'none';
    stepBtn.addEventListener('pointerdown', onStep);
    header.appendChild(stepBtn);

    // Trailing actions (duplicate + remove), pushed to the far right.
    const actions = document.createElement('div');
    actions.className = 'track-actions';

    const dupBtn = document.createElement('button');
    dupBtn.className = 'btn-duplicate-track';
    dupBtn.title = 'Duplicate this track (copy appears just below)';
    dupBtn.textContent = 'DUPLICATE';
    dupBtn.style.touchAction = 'none';
    dupBtn.addEventListener('pointerdown', onDuplicate);
    actions.appendChild(dupBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-track';
    removeBtn.title = 'Remove this track';
    removeBtn.textContent = '✕';
    removeBtn.style.touchAction = 'none';
    removeBtn.addEventListener('pointerdown', onRemove);
    actions.appendChild(removeBtn);

    header.appendChild(actions);

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
      this.requantizeToScale();
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
      this.requantizeToScale();
      this.onChange();
    });
    group.appendChild(typeSelect);
    return group;
  }

  // Snap every step's note to the nearest note in the current scale, updating
  // the knobs + note labels live. Lets the user audition keys/scales instantly.
  // 'chromatic' allows all notes, so it leaves the sequence unchanged.
  private requantizeToScale(): void {
    for (let i = 0; i < this.track.steps.length; i++) {
      const q = quantizeToScale(this.track.steps[i].note, this.track.scaleRoot, this.track.scaleType);
      this.track.steps[i].note = q;
      // Only the rendered steps (0..length-1) have a knob + label.
      this.knobInstances[i]?.setValue(q);
      if (this.noteNameEls[i]) this.noteNameEls[i].textContent = midiToNoteName(q);
    }
  }

  private label(text: string): HTMLLabelElement {
    const l = document.createElement('label');
    l.textContent = text;
    return l;
  }
}
