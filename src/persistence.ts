import type { StepData, TrackState, ScaleType } from './types';

// Full app state serialized for localStorage + JSON export. MIDI ports are
// stored by NAME (ids are not stable across sessions or replugs); they are
// re-resolved on load with graceful fallback to "no output".
const STORAGE_KEY = 'knobsody-state-v1';
const VERSION = 1;

export interface SerializedTrack {
  name: string;
  steps: StepData[];
  length: 8 | 16 | 32;
  portName: string | null;
  channel: number;
  gateLength: number;
  scaleRoot: number;
  scaleType: ScaleType;
  muted: boolean;
  enabled: boolean;
}

export interface SerializedState {
  version: number;
  bpm: number;
  clockPortNames: string[];
  tracks: SerializedTrack[];
}

export function serialize(
  tracks: TrackState[],
  bpm: number,
  clockPortNames: string[],
): SerializedState {
  return {
    version: VERSION,
    bpm,
    clockPortNames,
    tracks: tracks.map(t => ({
      name: t.name,
      steps: t.steps.map(s => ({ note: s.note, mode: s.mode })),
      length: t.length,
      portName: t.midiOutput ? (t.midiOutput.name ?? null) : (t.desiredPortName ?? null),
      channel: t.midiChannel,
      gateLength: t.gateLength,
      scaleRoot: t.scaleRoot,
      scaleType: t.scaleType,
      muted: t.muted,
      enabled: t.enabled,
    })),
  };
}

export function save(state: SerializedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable (e.g. some file:// contexts) — non-fatal.
  }
}

export function load(): SerializedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Validate + coerce arbitrary parsed JSON (localStorage or imported file) into a
// safe SerializedState, or null if it is unusable. Defensive so a corrupt or
// hand-edited file can never crash startup.
export function sanitize(data: unknown): SerializedState | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.tracks)) return null;

  const validLengths = [8, 16, 32];
  const validModes = ['play', 'mute', 'reset'];
  const validScales: ScaleType[] = ['chromatic', 'major', 'minor', 'pentatonic'];

  const tracks: SerializedTrack[] = [];
  for (const t of d.tracks as Record<string, unknown>[]) {
    if (typeof t !== 'object' || t === null) continue;
    const length = validLengths.includes(t.length as number) ? (t.length as 8 | 16 | 32) : 8;
    const rawSteps = Array.isArray(t.steps) ? (t.steps as Record<string, unknown>[]) : [];
    const steps: StepData[] = rawSteps.map(s => ({
      note: clampInt(s?.note, 36, 96, 60),
      mode: validModes.includes(s?.mode as string) ? (s.mode as StepData['mode']) : 'play',
    }));
    // Ensure the step array is at least `length` long.
    while (steps.length < length) steps.push({ note: 60, mode: 'play' });

    tracks.push({
      name: typeof t.name === 'string' ? t.name : 'Track',
      steps,
      length,
      portName: typeof t.portName === 'string' ? t.portName : null,
      channel: clampInt(t.channel, 1, 16, 1),
      gateLength: clampNum(t.gateLength, 0.1, 0.95, 0.5),
      scaleRoot: clampInt(t.scaleRoot, 0, 11, 0),
      scaleType: validScales.includes(t.scaleType as ScaleType) ? (t.scaleType as ScaleType) : 'chromatic',
      muted: t.muted === true,
      enabled: t.enabled !== false, // default true for older saves
    });
  }

  return {
    version: VERSION,
    bpm: clampInt(d.bpm, 40, 240, 120),
    clockPortNames: Array.isArray(d.clockPortNames)
      ? (d.clockPortNames as unknown[]).filter((n): n is string => typeof n === 'string')
      : [],
    tracks,
  };
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}
