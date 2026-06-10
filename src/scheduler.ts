import type { TrackState } from './types';

// Chris Wilson lookahead scheduler pattern.
// AudioContext.currentTime is the time source; MIDI events are stamped
// with future performance.now() values so the browser dispatches them
// with sub-millisecond accuracy regardless of main-thread jank.
const LOOKAHEAD_S = 0.1;  // schedule 100 ms ahead
const TICK_MS = 25;        // check every 25 ms

interface DisplayEvent {
  trackIndex: number;
  stepIndex: number;
  audioTime: number;
}

export class Scheduler {
  private audioCtx: AudioContext | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private _bpm = 120;

  // Per-track: next step index and the AudioContext time it should fire
  private nextStepTimes: number[] = [];
  private nextSteps: number[] = [];

  // Queue written by scheduler tick, drained by rAF loop
  private displayQueue: DisplayEvent[] = [];

  // Current display step per track; -1 = stopped / before first step
  readonly displaySteps: number[] = [];

  constructor(private getTracks: () => TrackState[]) {}

  get bpm(): number { return this._bpm; }
  set bpm(v: number) { this._bpm = Math.max(40, Math.min(240, v)); }
  get isRunning(): boolean { return this.running; }

  async start(): Promise<void> {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    const tracks = this.getTracks();
    const now = this.audioCtx.currentTime;
    this.nextStepTimes = tracks.map(() => now);
    this.nextSteps = tracks.map(() => 0);
    this.displayQueue = [];
    tracks.forEach((_, i) => { this.displaySteps[i] = -1; });

    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    // CC 123 = All Notes Off — sent immediately (no future timestamp)
    for (const track of this.getTracks()) {
      if (track.midiOutput) {
        const ch = (track.midiChannel - 1) & 0xF;
        try { track.midiOutput.send([0xB0 | ch, 123, 0]); } catch { /* port gone */ }
      }
    }

    const tracks = this.getTracks();
    tracks.forEach((_, i) => { this.displaySteps[i] = -1; });
    this.displayQueue = [];
  }

  // Called by the rAF loop to advance display step based on AudioContext time
  updateDisplay(): void {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    while (this.displayQueue.length > 0 && this.displayQueue[0].audioTime <= now) {
      const evt = this.displayQueue.shift()!;
      this.displaySteps[evt.trackIndex] = evt.stepIndex;
    }
  }

  private tick(): void {
    if (!this.running || !this.audioCtx) return;

    const stepDuration = 60 / this._bpm / 4; // one 16th note in seconds
    const lookaheadEnd = this.audioCtx.currentTime + LOOKAHEAD_S;
    const tracks = this.getTracks();

    for (let ti = 0; ti < tracks.length; ti++) {
      if (this.nextStepTimes[ti] === undefined) {
        // Track added after start
        this.nextStepTimes[ti] = this.audioCtx.currentTime;
        this.nextSteps[ti] = 0;
      }

      while (this.nextStepTimes[ti] < lookaheadEnd) {
        const stepIdx = this.nextSteps[ti];
        const stepTime = this.nextStepTimes[ti];

        this.scheduleStep(tracks[ti], ti, stepIdx, stepTime, stepDuration);

        this.nextSteps[ti] = (stepIdx + 1) % tracks[ti].length;
        this.nextStepTimes[ti] += stepDuration;
      }
    }

    this.timerId = setTimeout(() => this.tick(), TICK_MS);
  }

  private scheduleStep(
    track: TrackState,
    trackIndex: number,
    stepIndex: number,
    audioTime: number,
    stepDuration: number,
  ): void {
    // Always queue the display event so LEDs chase even with no MIDI output
    this.displayQueue.push({ trackIndex, stepIndex, audioTime });

    const step = track.steps[stepIndex];
    if (!track.midiOutput || step.mode !== 'play') return;

    const ch = (track.midiChannel - 1) & 0xF;
    const onTime = this.toMidiStamp(audioTime);
    // Gate length capped at 95 % so note-off always precedes next note-on
    const offTime = this.toMidiStamp(audioTime + stepDuration * Math.min(track.gateLength, 0.95));

    try {
      track.midiOutput.send([0x90 | ch, step.note, 100], onTime);
      track.midiOutput.send([0x80 | ch, step.note, 0], offTime);
    } catch { /* port disconnected between schedule and send */ }
  }

  // Convert an AudioContext time to a performance.now()-based MIDI timestamp (ms)
  private toMidiStamp(audioTime: number): number {
    return performance.now() + (audioTime - this.audioCtx!.currentTime) * 1000;
  }
}
