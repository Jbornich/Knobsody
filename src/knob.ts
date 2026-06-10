import { NOTE_MIN, NOTE_MAX, NOTE_DEFAULT, midiToNoteName } from './types';

const ANGLE_MIN = -150; // degrees — fully counter-clockwise (C1)
const ANGLE_MAX = 150;  // degrees — fully clockwise (C6)
const PX_PER_SEMITONE = 2; // vertical pixels per semitone change

function noteToAngle(note: number): number {
  const t = (note - NOTE_MIN) / (NOTE_MAX - NOTE_MIN);
  return ANGLE_MIN + t * (ANGLE_MAX - ANGLE_MIN);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Knob {
  readonly svgEl: SVGSVGElement;
  private pointerLine: SVGLineElement;
  private note: number;
  private onChange: (note: number) => void;

  // Per-pointer drag state for multi-touch
  private ptrs = new Map<number, { startY: number; startNote: number }>();
  private lastTapMs = 0;

  constructor(initialNote = NOTE_DEFAULT, onChange: (note: number) => void) {
    this.note = clamp(initialNote, NOTE_MIN, NOTE_MAX);
    this.onChange = onChange;

    const { svg, line } = this.buildSvg();
    this.svgEl = svg;
    this.pointerLine = line;
    this.applyRotation();
    this.attachEvents();
  }

  getNote(): number { return this.note; }

  setNote(note: number, emit = false): void {
    this.note = clamp(Math.round(note), NOTE_MIN, NOTE_MAX);
    this.applyRotation();
    if (emit) this.onChange(this.note);
  }

  private applyRotation(): void {
    const angle = noteToAngle(this.note);
    this.pointerLine.setAttribute('transform', `rotate(${angle}, 32, 32)`);
    this.svgEl.setAttribute('title', midiToNoteName(this.note));
  }

  private buildSvg(): { svg: SVGSVGElement; line: SVGLineElement } {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '64');
    svg.setAttribute('height', '64');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.classList.add('knob-svg');

    // Outer decorative ring
    const outer = document.createElementNS(NS, 'circle');
    outer.setAttribute('cx', '32'); outer.setAttribute('cy', '32');
    outer.setAttribute('r', '31');
    outer.setAttribute('fill', '#1A1A18');
    outer.setAttribute('stroke', '#4A4A48');
    outer.setAttribute('stroke-width', '1');
    svg.appendChild(outer);

    // Knob body
    const body = document.createElementNS(NS, 'circle');
    body.setAttribute('cx', '32'); body.setAttribute('cy', '32');
    body.setAttribute('r', '26');
    body.setAttribute('fill', '#3A3A38');
    body.setAttribute('stroke', '#606058');
    body.setAttribute('stroke-width', '1.5');
    svg.appendChild(body);

    // Inner shadow ring
    const inner = document.createElementNS(NS, 'circle');
    inner.setAttribute('cx', '32'); inner.setAttribute('cy', '32');
    inner.setAttribute('r', '22');
    inner.setAttribute('fill', '#333331');
    inner.setAttribute('stroke', 'none');
    svg.appendChild(inner);

    // Pointer line: from center to top, rotation applied on top
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', '32'); line.setAttribute('y1', '32');
    line.setAttribute('x2', '32'); line.setAttribute('y2', '11');
    line.setAttribute('stroke', '#DDDDC8');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);

    // Small center dot
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', '32'); dot.setAttribute('cy', '32');
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', '#222220');
    svg.appendChild(dot);

    return { svg, line };
  }

  private attachEvents(): void {
    const el = this.svgEl;

    el.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);

      // Double-tap / double-click detection
      const now = Date.now();
      if (now - this.lastTapMs < 350 && this.ptrs.size === 0) {
        this.setNote(NOTE_DEFAULT, true);
        this.lastTapMs = 0;
        return;
      }
      this.lastTapMs = now;

      this.ptrs.set(e.pointerId, { startY: e.clientY, startNote: this.note });
    });

    el.addEventListener('pointermove', (e: PointerEvent) => {
      const state = this.ptrs.get(e.pointerId);
      if (!state) return;
      e.preventDefault();

      const dy = state.startY - e.clientY; // up = positive = higher note
      const delta = dy / PX_PER_SEMITONE;
      const newNote = clamp(Math.round(state.startNote + delta), NOTE_MIN, NOTE_MAX);
      if (newNote !== this.note) {
        this.note = newNote;
        this.applyRotation();
        this.onChange(newNote);
      }
    });

    const releasePtr = (e: PointerEvent) => { this.ptrs.delete(e.pointerId); };
    el.addEventListener('pointerup', releasePtr);
    el.addEventListener('pointercancel', releasePtr);
  }
}
