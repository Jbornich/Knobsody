import type { TrackState } from './types';
import { effectiveLength } from './types';

// Chris Wilson lookahead scheduler pattern.
// AudioContext.currentTime is the time source; MIDI events are stamped
// with future performance.now() values so the browser dispatches them
// with sub-millisecond accuracy regardless of main-thread jank.
const LOOKAHEAD_S = 0.1;  // schedule 100 ms ahead
const TICK_MS = 25;        // check every 25 ms
// EMA factor for the time-offset low-pass: tracks slow AudioContext/perf clock
// drift while averaging out per-tick currentTime-quantization noise.
const OFFSET_SMOOTHING = 0.1;

// MIDI System Real-Time messages
const CLOCK = 0xF8; // 24 pulses per quarter note
const START = 0xFA;
const STOP = 0xFC;
const CLOCK_PPQN = 24;

interface DisplayEvent {
  trackId: string;
  stepIndex: number;
  audioTime: number;
}

// Per-track running position. Keyed by track id (not array index) so that
// adding or removing tracks mid-run never shifts another track's state.
interface TrackCursor {
  nextStep: number;   // step index to fire next
  nextTime: number;   // AudioContext time it should fire at
}

export class Scheduler {
  private audioCtx: AudioContext | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private _bpm = 120;

  // Smoothed offset (ms) from AudioContext time to the performance.now() timebase.
  private offsetMs = 0;
  private offsetInit = false;

  // Per-track cursors, keyed by track id.
  private cursors = new Map<string, TrackCursor>();

  // Next MIDI-clock pulse time (AudioContext seconds). Advances independently
  // of the step grid so clock stays steady regardless of per-track lengths.
  private nextClockTime = 0;

  // Per-track position for manual single-stepping while stopped (-1 = before
  // the first step). Independent of the running cursors; reset when playback
  // starts so RUN always begins from step 1.
  private manualPos = new Map<string, number>();

  // Queue written by scheduler tick, drained by rAF loop
  private displayQueue: DisplayEvent[] = [];

  // Current display step per track id; missing / -1 = stopped or before first step
  private displaySteps = new Map<string, number>();

  constructor(
    private getTracks: () => TrackState[],
    private getClockPorts: () => MIDIOutput[],
  ) {}

  get bpm(): number { return this._bpm; }
  set bpm(v: number) { this._bpm = Math.max(40, Math.min(240, v)); }
  get isRunning(): boolean { return this.running; }

  // Eagerly create the AudioContext so its (one-time) audio-device init cost is
  // paid at app load, not on the first RUN press. The context starts 'suspended'
  // (autoplay policy) until resumeContext() is called from a user gesture.
  prewarm(): void {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
  }

  // Resume the AudioContext on a user gesture so it is already 'running' by the
  // time the user presses RUN. Safe to call repeatedly; no-op once running.
  async resumeContext(): Promise<void> {
    this.prewarm();
    if (this.audioCtx!.state === 'suspended') {
      try { await this.audioCtx!.resume(); } catch { /* gesture required / not ready */ }
    }
  }

  // Current display step for a track (-1 if none). Read by the rAF LED loop.
  displayStepFor(trackId: string): number {
    return this.displaySteps.get(trackId) ?? -1;
  }

  async start(): Promise<void> {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    const now = this.audioCtx.currentTime;
    const tracks = this.getTracks();

    // Reseed cursors for exactly the current track set.
    this.cursors.clear();
    this.displaySteps.clear();
    for (const t of tracks) {
      this.cursors.set(t.id, { nextStep: 0, nextTime: now });
      this.displaySteps.set(t.id, -1);
    }
    this.displayQueue = [];
    this.nextClockTime = now;
    this.manualPos.clear();

    // Re-seed the smoothed offset on each run
    this.offsetInit = false;

    this.running = true;

    // MIDI Start (0xFA) — System Real-Time, sent immediately to every clock port.
    for (const port of this.getClockPorts()) {
      try { port.send([START]); } catch { /* port gone */ }
    }

    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    // CC 123 = All Notes Off on every track's channel — sent immediately.
    for (const track of this.getTracks()) {
      this.silence(track);
    }

    // MIDI Stop (0xFC) to every clock port.
    for (const port of this.getClockPorts()) {
      try { port.send([STOP]); } catch { /* port gone */ }
    }

    this.displaySteps.clear();
    this.displayQueue = [];
  }

  // All-notes-off for one track (used on stop and when a track is removed).
  silence(track: TrackState): void {
    if (!track.midiOutput) return;
    const ch = (track.midiChannel - 1) & 0xF;
    try { track.midiOutput.send([0xB0 | ch, 123, 0]); } catch { /* port gone */ }
  }

  // Manually advance one track by a single step and play it immediately. Only
  // active while stopped. Respects the effective loop (never lands on a RESET
  // step) and MUTE (advances the position but sends no note). Lights the LED.
  manualStep(track: TrackState): void {
    if (this.running) return;
    const effLen = effectiveLength(track);
    let pos = (this.manualPos.get(track.id) ?? -1) + 1;
    if (pos >= effLen) pos = 0;
    this.manualPos.set(track.id, pos);
    this.playStepNow(track, pos);
    this.displaySteps.set(track.id, pos);
  }

  // Advance every track by one step (the global STEP button).
  manualStepAll(): void {
    if (this.running) return;
    for (const track of this.getTracks()) this.manualStep(track);
  }

  // Last note auditioned per track, so a new audition can cut the previous one.
  private auditionNotes = new Map<string, number>();

  // Audibly preview a note on a track's port — used when turning a step knob so
  // the user can hear (and "play") the pitch. Works in both stop and run mode,
  // ignores track mute (you want to hear what you dial), and no-ops with no port.
  auditionNote(track: TrackState, note: number): void {
    if (!track.midiOutput) return;
    const ch = (track.midiChannel - 1) & 0xF;
    const out = track.midiOutput;
    const now = performance.now();
    const stepDurationMs = (60 / this._bpm / 4) * 1000;
    const offDelay = Math.max(120, stepDurationMs * Math.min(track.gateLength, 0.95));
    const prev = this.auditionNotes.get(track.id);
    try {
      if (prev !== undefined) out.send([0x80 | ch, prev, 0], now); // cut previous
      out.send([0x90 | ch, note, 100], now);
      out.send([0x80 | ch, note, 0], now + offDelay);
    } catch { /* port disconnected */ }
    this.auditionNotes.set(track.id, note);
  }

  // Fire one step's note right now (note-on immediate, note-off after the gate),
  // independent of the lookahead timeline so it works while stopped.
  private playStepNow(track: TrackState, stepIndex: number): void {
    const step = track.steps[stepIndex];
    if (!track.midiOutput || track.muted || step.mode !== 'play') return;
    const ch = (track.midiChannel - 1) & 0xF;
    const stepDurationMs = (60 / this._bpm / 4) * 1000;
    const now = performance.now();
    const offTime = now + stepDurationMs * Math.min(track.gateLength, 0.95);
    try {
      track.midiOutput.send([0x90 | ch, step.note, 100], now);
      track.midiOutput.send([0x80 | ch, step.note, 0], offTime);
    } catch { /* port disconnected */ }
  }

  // Called by the rAF loop to advance display step based on AudioContext time
  updateDisplay(): void {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    while (this.displayQueue.length > 0 && this.displayQueue[0].audioTime <= now) {
      const evt = this.displayQueue.shift()!;
      this.displaySteps.set(evt.trackId, evt.stepIndex);
    }
  }

  private tick(): void {
    if (!this.running || !this.audioCtx) return;

    const tnow = performance.now();
    const stepDuration = 60 / this._bpm / 4; // one 16th note in seconds
    const ctNow = this.audioCtx.currentTime;

    // Update the smoothed AudioContext -> performance.now() offset. tnow and
    // ctNow are read adjacently to keep the measurement near-atomic.
    const measuredOffset = tnow - ctNow * 1000;
    if (!this.offsetInit) {
      this.offsetMs = measuredOffset;
      this.offsetInit = true;
    } else {
      this.offsetMs += OFFSET_SMOOTHING * (measuredOffset - this.offsetMs);
    }

    const lookaheadEnd = ctNow + LOOKAHEAD_S;
    const tracks = this.getTracks();

    // ── Step events, per track ───────────────────────────────────────────
    for (const track of tracks) {
      // Per-track Play/Stop: a disabled track is frozen. Drop its cursor so
      // that re-enabling reseeds it and it restarts from step 1.
      if (!track.enabled) {
        if (this.cursors.has(track.id)) {
          this.cursors.delete(track.id);
          this.displaySteps.set(track.id, -1);
        }
        continue;
      }

      let cur = this.cursors.get(track.id);
      if (!cur) {
        // New, re-enabled, or late-added track — begin at the current time.
        cur = { nextStep: 0, nextTime: this.audioCtx.currentTime };
        this.cursors.set(track.id, cur);
        this.displaySteps.set(track.id, -1);
      }

      const effLen = effectiveLength(track);
      while (cur.nextTime < lookaheadEnd) {
        // If the effective length shrank live (a RESET was just added past the
        // current position), wrap back to step 1 immediately.
        let stepIdx = cur.nextStep;
        if (stepIdx >= effLen) stepIdx = 0;

        this.scheduleStep(track, stepIdx, cur.nextTime, stepDuration);

        cur.nextStep = (stepIdx + 1) % effLen;
        cur.nextTime += stepDuration;
      }
    }

    // ── MIDI clock pulses ────────────────────────────────────────────────
    // Advance the clock timeline every tick regardless of whether any port is
    // selected, so enabling a clock port mid-run never causes a backlog burst.
    const clockPorts = this.getClockPorts();
    const clockInterval = 60 / this._bpm / CLOCK_PPQN;
    while (this.nextClockTime < lookaheadEnd) {
      if (clockPorts.length > 0) {
        const stamp = this.toMidiStamp(this.nextClockTime);
        for (const port of clockPorts) {
          try { port.send([CLOCK], stamp); } catch { /* port gone */ }
        }
      }
      this.nextClockTime += clockInterval;
    }

    this.timerId = setTimeout(() => this.tick(), TICK_MS);
  }

  private scheduleStep(
    track: TrackState,
    stepIndex: number,
    audioTime: number,
    stepDuration: number,
  ): void {
    // Always queue the display event so LEDs chase even with no MIDI output
    this.displayQueue.push({ trackId: track.id, stepIndex, audioTime });

    const step = track.steps[stepIndex];
    if (!track.midiOutput || track.muted || step.mode !== 'play') return;

    const ch = (track.midiChannel - 1) & 0xF;
    const onTime = this.toMidiStamp(audioTime);
    // Gate length capped at 95 % so note-off always precedes next note-on
    const offTime = this.toMidiStamp(audioTime + stepDuration * Math.min(track.gateLength, 0.95));

    try {
      track.midiOutput.send([0x90 | ch, step.note, 100], onTime);
      track.midiOutput.send([0x80 | ch, step.note, 0], offTime);
    } catch { /* port disconnected between schedule and send */ }
  }

  // Convert an AudioContext time to a performance.now()-based MIDI timestamp (ms),
  // using the smoothed offset so stamps track drift but carry no per-tick noise.
  private toMidiStamp(audioTime: number): number {
    return this.offsetMs + audioTime * 1000;
  }
}
