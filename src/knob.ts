const ANGLE_MIN = -150; // degrees — fully counter-clockwise (min value)
const ANGLE_MAX = 150;  // degrees — fully clockwise (max value)

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Configuration for a reusable rotary knob. The step knob (chromatic MIDI note)
// and the gate-length knob are both instances of this — only the numeric range,
// granularity and label formatting differ.
export interface KnobConfig {
  min: number;
  max: number;
  value: number;          // initial value
  default: number;        // value restored on double-tap / double-click
  step: number;           // rounding granularity (1 = integer semitones)
  pxPerUnit: number;      // vertical drag pixels per 1 unit of value
  size?: number;          // rendered diameter in px (default 64)
  title?: (v: number) => string; // tooltip text for the current value
  onChange: (v: number) => void;
}

export class Knob {
  readonly svgEl: SVGSVGElement;
  private pointerLine: SVGLineElement;
  private value: number;
  private readonly cfg: Required<Pick<KnobConfig, 'min' | 'max' | 'default' | 'step' | 'pxPerUnit'>>
    & Pick<KnobConfig, 'title' | 'onChange'>;

  // Per-pointer drag state for multi-touch
  private ptrs = new Map<number, { startY: number; startValue: number }>();
  private lastTapMs = 0;

  constructor(config: KnobConfig) {
    this.cfg = config;
    this.value = clamp(config.value, config.min, config.max);

    const { svg, line } = this.buildSvg(config.size ?? 64);
    this.svgEl = svg;
    this.pointerLine = line;
    this.applyRotation();
    this.attachEvents();
  }

  getValue(): number { return this.value; }

  setValue(value: number, emit = false): void {
    this.value = this.quantize(value);
    this.applyRotation();
    if (emit) this.cfg.onChange(this.value);
  }

  private quantize(v: number): number {
    const clamped = clamp(v, this.cfg.min, this.cfg.max);
    const snapped = Math.round(clamped / this.cfg.step) * this.cfg.step;
    return clamp(snapped, this.cfg.min, this.cfg.max);
  }

  private valueToAngle(v: number): number {
    const t = (v - this.cfg.min) / (this.cfg.max - this.cfg.min);
    return ANGLE_MIN + t * (ANGLE_MAX - ANGLE_MIN);
  }

  private applyRotation(): void {
    const angle = this.valueToAngle(this.value);
    this.pointerLine.setAttribute('transform', `rotate(${angle}, 32, 32)`);
    if (this.cfg.title) this.svgEl.setAttribute('title', this.cfg.title(this.value));
  }

  private buildSvg(size: number): { svg: SVGSVGElement; line: SVGLineElement } {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
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
        this.setValue(this.cfg.default, true);
        this.lastTapMs = 0;
        return;
      }
      this.lastTapMs = now;

      this.ptrs.set(e.pointerId, { startY: e.clientY, startValue: this.value });
    });

    el.addEventListener('pointermove', (e: PointerEvent) => {
      const state = this.ptrs.get(e.pointerId);
      if (!state) return;
      e.preventDefault();

      const dy = state.startY - e.clientY; // up = positive = higher value
      const delta = dy / this.cfg.pxPerUnit;
      const newValue = this.quantize(state.startValue + delta);
      if (newValue !== this.value) {
        this.value = newValue;
        this.applyRotation();
        this.cfg.onChange(newValue);
      }
    });

    const releasePtr = (e: PointerEvent) => { this.ptrs.delete(e.pointerId); };
    el.addEventListener('pointerup', releasePtr);
    el.addEventListener('pointercancel', releasePtr);
  }
}
