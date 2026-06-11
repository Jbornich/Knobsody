export interface StepData {
  note: number;   // MIDI 36 (C1) – 96 (C6)
  mode: 'play' | 'mute' | 'reset';
}

// Scale used by Randomize to constrain generated pitches. 'chromatic' = no
// constraint. The knobs themselves stay chromatic; only Randomize uses this.
export type ScaleType = 'chromatic' | 'major' | 'minor' | 'pentatonic';

export interface TrackState {
  id: string;
  name: string;
  steps: StepData[];
  length: 8 | 16 | 32;
  midiOutput: MIDIOutput | null;
  midiChannel: number;   // 1–16
  gateLength: number;    // 0.10–0.95
  scaleRoot: number;     // pitch class 0–11 (0 = C)
  scaleType: ScaleType;
  // Transient: the saved port name to reselect once MIDI ports enumerate.
  // Not part of the live MIDI binding (that is midiOutput).
  desiredPortName?: string | null;
}

export const NOTE_MIN = 36;   // C1  (Yamaha convention: C3=60, middle C)
export const NOTE_MAX = 96;   // C6
export const NOTE_DEFAULT = 60; // C3

export function midiToNoteName(note: number): string {
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 2; // Yamaha: MIDI 60 = C3
  return NAMES[note % 12] + octave;
}

export function defaultStep(): StepData {
  return { note: NOTE_DEFAULT, mode: 'play' };
}

// Monotonic id source for tracks. Never reused, so removing a track can never
// collide with a later one — important for the scheduler's id-keyed cursors.
let trackIdCounter = 0;

// Create a fresh 8-step track with default-played C3 steps. `n` is the display
// number shown in the panel header ("Track n").
export function createTrack(n: number): TrackState {
  return {
    id: `track-${++trackIdCounter}`,
    name: `Track ${n}`,
    steps: Array.from({ length: 8 }, defaultStep),
    length: 8,
    midiOutput: null,
    midiChannel: ((n - 1) % 16) + 1, // spread new tracks across channels 1..16
    gateLength: 0.5,
    scaleRoot: 0,
    scaleType: 'chromatic',
  };
}

export const GATE_MIN = 0.1;
export const GATE_MAX = 0.95;
export const GATE_DEFAULT = 0.5;

export const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Semitone offsets from the root for each scale. Chromatic allows every note.
const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],       // natural minor
  pentatonic: [0, 2, 4, 7, 9],          // major pentatonic
};

// The set of allowed pitch classes (0–11) for a root + scale type.
function allowedPitchClasses(root: number, type: ScaleType): Set<number> {
  const pcs = new Set<number>();
  for (const i of SCALE_INTERVALS[type]) pcs.add(((root % 12) + i) % 12);
  return pcs;
}

// Snap a MIDI note to the nearest note in the scale, staying within C1–C6.
// Searches outward from the note so ties resolve to the lower neighbour.
export function quantizeToScale(note: number, root: number, type: ScaleType): number {
  const allowed = allowedPitchClasses(root, type);
  for (let d = 0; d <= 12; d++) {
    const down = note - d;
    if (down >= NOTE_MIN && down <= NOTE_MAX && allowed.has(((down % 12) + 12) % 12)) return down;
    const up = note + d;
    if (up >= NOTE_MIN && up <= NOTE_MAX && allowed.has(((up % 12) + 12) % 12)) return up;
  }
  return Math.max(NOTE_MIN, Math.min(NOTE_MAX, note));
}

// A random scale-quantized note within C1–C6.
export function randomNoteInScale(root: number, type: ScaleType): number {
  const raw = NOTE_MIN + Math.floor(Math.random() * (NOTE_MAX - NOTE_MIN + 1));
  return quantizeToScale(raw, root, type);
}

// Randomize a track's step data in place. Notes become fresh scale-quantized
// pitches; PLAY/MUTE is reshuffled per step. RESET steps are left untouched, so
// the effective loop length never changes silently.
export function randomizeTrack(track: TrackState): void {
  for (const step of track.steps) {
    step.note = randomNoteInScale(track.scaleRoot, track.scaleType);
    if (step.mode !== 'reset') {
      step.mode = Math.random() < 0.72 ? 'play' : 'mute';
    }
  }
}

// Effective loop length: a RESET step ends the loop, so the counter cycles
// steps 0..(firstReset-1) and the RESET step itself never plays nor consumes
// clock time. This is the polyrhythm mechanism. A RESET on the very first step
// is ignored (no usable loop), falling back to the full length.
export function effectiveLength(track: TrackState): number {
  for (let i = 0; i < track.length; i++) {
    if (track.steps[i].mode === 'reset') return i > 0 ? i : track.length;
  }
  return track.length;
}
