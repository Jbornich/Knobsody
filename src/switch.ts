import type { StepData } from './types';

// 3-position toggle laid out like a traffic light: RESET (top, red) /
// MUTE (middle, yellow) / PLAY (bottom, green). Default is PLAY; a tap toggles
// upward PLAY -> MUTE -> RESET and wraps back to PLAY. No dragging required.
type Mode = StepData['mode'];

// Cycle order on tap (visually upward, then wrap down to play).
const MODES: Mode[] = ['play', 'mute', 'reset'];

interface PosStyle { y: number; bright: string; dim: string; }

// Vertical detent positions and colour codes, top to bottom (traffic light).
const POS: Record<Mode, PosStyle> = {
  reset: { y: 16, bright: '#E05858', dim: '#4A2A2A' },
  mute:  { y: 32, bright: '#E0B020', dim: '#4A3A10' },
  play:  { y: 48, bright: '#58D058', dim: '#2A4A2A' },
};

export class Switch {
  readonly svgEl: SVGSVGElement;
  private mode: Mode;
  private onChange: (mode: Mode) => void;
  private cap!: SVGRectElement;
  private capDot!: SVGCircleElement;
  private detents = {} as Record<Mode, SVGCircleElement>;

  constructor(initial: Mode, onChange: (mode: Mode) => void) {
    this.mode = initial;
    this.onChange = onChange;
    this.svgEl = this.buildSvg();
    this.applyState();
    this.attachEvents();
  }

  getMode(): Mode { return this.mode; }

  setMode(mode: Mode, emit = false): void {
    this.mode = mode;
    this.applyState();
    if (emit) this.onChange(mode);
  }

  private cycle(): void {
    const idx = MODES.indexOf(this.mode);
    this.setMode(MODES[(idx + 1) % MODES.length], true);
  }

  // Move the lever cap to the active detent and colour-code it; keep the other
  // two detents visible (dimmed) so every state is readable without interaction.
  private applyState(): void {
    const p = POS[this.mode];
    this.cap.setAttribute('y', String(p.y - 8));
    this.capDot.setAttribute('cy', String(p.y));
    this.capDot.setAttribute('fill', p.bright);
    (Object.keys(POS) as Mode[]).forEach(m => {
      this.detents[m].setAttribute('fill', m === this.mode ? POS[m].bright : POS[m].dim);
    });
    this.svgEl.setAttribute('title', this.mode.toUpperCase());
  }

  private buildSvg(): SVGSVGElement {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '48');
    svg.setAttribute('height', '64');
    svg.setAttribute('viewBox', '0 0 48 64');
    svg.classList.add('switch-svg');

    // Slot / body
    const body = document.createElementNS(NS, 'rect');
    body.setAttribute('x', '15'); body.setAttribute('y', '6');
    body.setAttribute('width', '18'); body.setAttribute('height', '52');
    body.setAttribute('rx', '9');
    body.setAttribute('fill', '#1A1A18');
    body.setAttribute('stroke', '#4A4A48');
    body.setAttribute('stroke-width', '1');
    svg.appendChild(body);

    // Detent guide dots — show the three-position legend at all times
    (Object.keys(POS) as Mode[]).forEach(m => {
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', '24');
      dot.setAttribute('cy', String(POS[m].y));
      dot.setAttribute('r', '2.5');
      dot.setAttribute('fill', POS[m].dim);
      svg.appendChild(dot);
      this.detents[m] = dot;
    });

    // Lever cap (slides to the active detent)
    const cap = document.createElementNS(NS, 'rect');
    cap.setAttribute('x', '8');
    cap.setAttribute('width', '32'); cap.setAttribute('height', '16');
    cap.setAttribute('rx', '5');
    cap.setAttribute('fill', '#3A3A38');
    cap.setAttribute('stroke', '#606058');
    cap.setAttribute('stroke-width', '1.5');
    svg.appendChild(cap);
    this.cap = cap;

    // Colour-coded status dot on the cap
    const capDot = document.createElementNS(NS, 'circle');
    capDot.setAttribute('cx', '24');
    capDot.setAttribute('r', '4');
    svg.appendChild(capDot);
    this.capDot = capDot;

    return svg;
  }

  private attachEvents(): void {
    // Tap/click cycles. touch-action:none (CSS) keeps a tap from scrolling.
    this.svgEl.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      this.cycle();
    });
  }
}
