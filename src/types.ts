export interface StepData {
  note: number;   // MIDI 36 (C1) – 96 (C6)
  mode: 'play' | 'mute' | 'reset';
}

export interface TrackState {
  id: string;
  name: string;
  steps: StepData[];
  length: 8 | 16 | 32;
  midiOutput: MIDIOutput | null;
  midiChannel: number;   // 1–16
  gateLength: number;    // 0.10–0.95
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
