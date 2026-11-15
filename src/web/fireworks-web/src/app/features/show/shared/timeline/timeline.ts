import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { ShowCue, ShowDocument } from '../../../../../engine/model/show';
import { STEPS_PER_SECOND } from '../../../../../engine/model/show';
import { EMPTY_LANE, TIMELINE_HELP, formatClock, formatTime } from '../show-copy';
import { clamp, emptyShow, snapTenth } from '../show-edit';
import { FIT_VIEW, type TimelineView } from '../show-draft';
import {
  MAX_PX_PER_SECOND,
  ROW_HEIGHT,
  RULER_HEIGHT,
  ZOOM_STEP,
  clampScroll,
  effectivePxPerSecond,
  fitPxPerSecond,
  hitTest,
  layoutLane,
  tickSeconds,
  viewRangeEnd,
  type LaneLayout,
} from './timeline-layout';

export type ZoomCommand = 'in' | 'out' | 'fit';

/** Scrub seeks wait for the pointer to pause this long, and again on release (§5.3). */
export const SCRUB_PAUSE_MS = 150;

let nextId = 0;

/**
 * The cue timeline (phase-6.md §5–§7, §16.2): one focusable group holding a ruler canvas and one
 * cue-lane canvas, redrawn on change at most once per animation frame and never per playback
 * frame. The playhead is a DOM line the page moves through `setPlayhead` (no signal per frame).
 * Presentational: it takes the document and view and emits commands; the page owns the store.
 */
@Component({
  selector: 'app-show-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block min-h-0 flex-1' },
  template: `
    <div
      #box
      class="relative h-full overflow-hidden outline-offset-[-2px]"
      tabindex="0"
      role="group"
      aria-roledescription="timeline"
      aria-label="Cues"
      [attr.aria-describedby]="helpId"
      data-testid="timeline"
      (keydown)="onKey($event)"
      (wheel)="onWheel($event)"
    >
      <canvas
        #ruler
        class="absolute inset-x-0 top-0 block cursor-pointer touch-none"
        [style.height.px]="rulerHeight"
        aria-hidden="true"
        data-testid="timeline-ruler"
        (pointerdown)="onRulerDown($event)"
      ></canvas>
      <canvas
        #lane
        class="absolute inset-x-0 bottom-0 block touch-none"
        [style.top.px]="rulerHeight"
        aria-hidden="true"
        data-testid="timeline-lane"
        (pointerdown)="onLaneDown($event)"
      ></canvas>
      <div
        #playhead
        class="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-accent"
        style="left: 0"
        aria-hidden="true"
        data-testid="timeline-playhead"
      ></div>
      @if (dragLabel(); as d) {
        <div
          class="pointer-events-none absolute top-0 rounded-sm bg-surface-raised px-1 font-mono text-caption text-primary"
          [style.left.px]="d.x"
          aria-hidden="true"
          data-testid="drag-label"
        >
          {{ d.text }}
        </div>
      }
      @if (show().cues.length === 0) {
        <p
          class="pointer-events-none absolute inset-x-3 top-1/2 m-0 text-center text-small text-muted"
          data-testid="empty-lane"
        >
          {{ emptyText }}
        </p>
      }
    </div>
    <p class="sr-only" [id]="helpId">{{ help }}</p>
  `,
})
export class ShowTimelineComponent {
  // Not `required`: the page reads `atFit`/`atMax` for its zoom buttons, which can run before the
  // inputs are bound on the first pass (NG0950).
  readonly show = input<ShowDocument>(emptyShow());
  readonly ordered = input<readonly ShowCue[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly view = input<TimelineView>(FIT_VIEW);
  readonly end = input(0);
  readonly endKnown = input(false);

  readonly selected = output<string | null>();
  readonly seek = output<number>();
  /** The pointer is scrubbing (time label follows at once); `seek` follows on pause/release. */
  readonly scrub = output<number>();
  readonly moved = output<{ id: string; t: number }>();
  readonly nudge = output<number>();
  readonly add = output<void>();
  readonly duplicate = output<void>();
  readonly remove = output<void>();
  readonly zoom = output<{ command: ZoomCommand; around: number | null }>();
  readonly viewChange = output<TimelineView>();
  readonly focusInspector = output<void>();
  /** Arrow/Home/End selection, for the live region. */
  readonly keyboardSelected = output<string>();

  protected readonly rulerHeight = RULER_HEIGHT;
  protected readonly emptyText = EMPTY_LANE;
  protected readonly help = TIMELINE_HELP;
  protected readonly helpId = `timeline-help-${nextId++}`;
  protected readonly dragLabel = signal<{ x: number; text: string } | null>(null);

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private readonly rulerCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('ruler');
  private readonly laneCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('lane');
  private readonly playheadEl = viewChild.required<ElementRef<HTMLElement>>('playhead');

  private readonly size = signal({ w: 0, h: 0 });
  private readonly drag = signal<{ id: string; t: number } | null>(null);

  readonly rangeEnd = computed(() => viewRangeEnd(this.show().duration, this.end()));
  readonly pps = computed(() =>
    effectivePxPerSecond(this.view().pxPerSecond, Math.max(1, this.size().w), this.rangeEnd()),
  );
  readonly scroll = computed(() =>
    clampScroll(this.view().scroll, Math.max(1, this.size().w), this.pps(), this.rangeEnd()),
  );
  readonly atFit = computed(
    () => this.pps() <= fitPxPerSecond(Math.max(1, this.size().w), this.rangeEnd()) + 1e-9,
  );
  readonly atMax = computed(() => this.pps() >= MAX_PX_PER_SECOND - 1e-9);
  private readonly rows = computed(() =>
    Math.max(1, Math.floor((this.size().h - RULER_HEIGHT) / ROW_HEIGHT)),
  );
  private readonly layout = computed<LaneLayout>(() =>
    layoutLane(this.show(), this.ordered(), this.pps(), this.scroll(), this.rows(), this.drag()),
  );

  private frame = 0;
  private playheadSeconds = 0;
  /**
   * The selection this component last emitted, until the input catches up. Keys can arrive faster
   * than change detection (End then Left in one task), and must act on the latest selection.
   */
  private emittedSelection: { readonly id: string | null } | null = null;
  private scrubTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.box().nativeElement;
      const measure = () => this.size.set({ w: el.clientWidth, h: el.clientHeight });
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        destroyRef.onDestroy(() => ro.disconnect());
      }
    });
    effect(() => {
      this.selectedId();
      untracked(() => (this.emittedSelection = null));
    });
    effect(() => {
      // Everything the draw reads; then one redraw on the next animation frame.
      this.layout();
      this.selectedId();
      this.endKnown();
      untracked(() => this.schedule());
    });
    destroyRef.onDestroy(() => {
      if (this.frame && typeof cancelAnimationFrame !== 'undefined')
        cancelAnimationFrame(this.frame);
      if (this.scrubTimer) clearTimeout(this.scrubTimer);
    });
  }

  /** Moves the playhead line (called per frame by the page, outside change detection). */
  setPlayhead(seconds: number, follow = false): void {
    this.playheadSeconds = seconds;
    const el = this.playheadEl().nativeElement;
    const x = (seconds - this.scroll()) * this.pps();
    el.style.transform = `translateX(${x}px)`;
    const w = this.size().w;
    if (follow && w > 0 && (x > w * 0.9 || x < 0)) {
      this.viewChange.emit({
        pxPerSecond: this.view().pxPerSecond,
        scroll: Math.max(0, seconds - (w * 0.1) / this.pps()),
      });
    }
  }

  /**
   * The zoom around a time (selected cue, else the playhead, else the pointer), from `current`: the
   * caller's latest view, which can be ahead of this component's `view` input within one task.
   */
  zoomView(
    command: ZoomCommand,
    around: number | null,
    current: TimelineView = this.view(),
  ): TimelineView {
    const w = Math.max(1, this.size().w);
    if (command === 'fit') return { pxPerSecond: null, scroll: 0 };
    const pps = effectivePxPerSecond(current.pxPerSecond, w, this.rangeEnd());
    const scroll = clampScroll(current.scroll, w, pps, this.rangeEnd());
    const next = command === 'in' ? pps * ZOOM_STEP : pps / ZOOM_STEP;
    const clampedNext = effectivePxPerSecond(next, w, this.rangeEnd());
    const at = around ?? this.playheadSeconds;
    const offset = (at - scroll) * pps;
    const nextScroll = at - offset / clampedNext;
    const isFit = clampedNext <= fitPxPerSecond(w, this.rangeEnd()) + 1e-9;
    return {
      pxPerSecond: isFit ? null : clampedNext,
      scroll: isFit ? 0 : clampScroll(nextScroll, w, clampedNext, this.rangeEnd()),
    };
  }

  focus(): void {
    this.box().nativeElement.focus();
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const order = this.ordered();
    const sel = this.currentSelection();
    const at = sel === null ? -1 : order.findIndex((c) => c.id === sel);
    const pick = (cue: ShowCue | undefined) => {
      if (!cue) return;
      this.emitSelection(cue.id);
      this.keyboardSelected.emit(cue.id);
      this.scrollIntoView(cue.t);
    };
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft':
        pick(at < 0 ? order.at(-1) : order[Math.max(0, at - 1)]);
        break;
      case 'ArrowRight':
        pick(at < 0 ? order[0] : order[Math.min(order.length - 1, at + 1)]);
        break;
      case 'Home':
        pick(order[0]);
        break;
      case 'End':
        pick(order.at(-1));
        break;
      case ',':
        if (sel) this.nudge.emit(-0.1);
        break;
      case '.':
        if (sel) this.nudge.emit(0.1);
        break;
      case '<':
        if (sel) this.nudge.emit(-1);
        break;
      case '>':
        if (sel) this.nudge.emit(1);
        break;
      case 'a':
      case 'A':
        this.add.emit();
        break;
      case 'd':
      case 'D':
        if (sel) this.duplicate.emit();
        break;
      case 'Delete':
      case 'Backspace':
        if (sel) this.remove.emit();
        break;
      case 'Enter':
        if (sel) this.focusInspector.emit();
        break;
      case 'Escape':
        this.emitSelection(null);
        break;
      case '+':
      case '=':
        this.zoom.emit({ command: 'in', around: this.selectedTime() });
        break;
      case '-':
        this.zoom.emit({ command: 'out', around: this.selectedTime() });
        break;
      case '0':
        this.zoom.emit({ command: 'fit', around: null });
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  protected onWheel(event: WheelEvent): void {
    const pps = this.pps();
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = this.box().nativeElement.getBoundingClientRect();
      const around = this.scroll() + (event.clientX - rect.left) / pps;
      this.zoom.emit({ command: event.deltaY < 0 ? 'in' : 'out', around });
      return;
    }
    const delta =
      event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX || event.deltaY
        : event.deltaY;
    if (!delta || this.atFit()) return;
    event.preventDefault();
    const w = Math.max(1, this.size().w);
    this.viewChange.emit({
      pxPerSecond: this.view().pxPerSecond,
      scroll: clampScroll(this.scroll() + delta / pps, w, pps, this.rangeEnd()),
    });
  }

  protected onRulerDown(event: PointerEvent): void {
    this.box().nativeElement.focus();
    const canvas = this.rulerCanvas().nativeElement;
    this.scrubFrom(event, canvas);
  }

  protected onLaneDown(event: PointerEvent): void {
    this.box().nativeElement.focus();
    const canvas = this.laneCanvas().nativeElement;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const hit = hitTest(this.layout(), px, py, this.currentSelection());
    if (!hit) {
      this.emitSelection(null);
      this.scrubFrom(event, canvas);
      return;
    }
    this.emitSelection(hit.id);
    const startX = event.clientX;
    const t0 = hit.t;
    const duration = this.show().duration;
    const pps = this.pps();
    let moved = false;
    canvas.setPointerCapture?.(event.pointerId);
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const raw = t0 + dx / pps;
      const t = clamp(
        e.altKey ? Math.round(raw * STEPS_PER_SECOND) / STEPS_PER_SECOND : snapTenth(raw),
        0,
        duration,
      );
      this.drag.set({ id: hit.id, t });
      const atEnd = t >= duration;
      this.dragLabel.set({
        x: e.clientX - this.box().nativeElement.getBoundingClientRect().left,
        text: atEnd ? `${formatTime(t)} · window end` : formatTime(t),
      });
    };
    const onUp = () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      const d = this.drag();
      this.drag.set(null);
      this.dragLabel.set(null);
      if (moved && d && d.t !== t0) this.moved.emit({ id: d.id, t: d.t });
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  }

  private scrubFrom(event: PointerEvent, canvas: HTMLCanvasElement): void {
    const timeAt = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      return Math.max(0, this.scroll() + (clientX - rect.left) / this.pps());
    };
    const fire = (t: number) => {
      this.setPlayhead(t);
      this.scrub.emit(t);
      if (this.scrubTimer) clearTimeout(this.scrubTimer);
      this.scrubTimer = setTimeout(() => this.seek.emit(t), SCRUB_PAUSE_MS);
    };
    let last = timeAt(event.clientX);
    fire(last);
    canvas.setPointerCapture?.(event.pointerId);
    const onMove = (e: PointerEvent) => {
      last = timeAt(e.clientX);
      fire(last);
    };
    const onUp = () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      if (this.scrubTimer) clearTimeout(this.scrubTimer);
      this.scrubTimer = null;
      this.seek.emit(last);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  }

  private currentSelection(): string | null {
    return this.emittedSelection ? this.emittedSelection.id : this.selectedId();
  }

  private emitSelection(id: string | null): void {
    this.emittedSelection = { id };
    this.selected.emit(id);
  }

  private selectedTime(): number | null {
    const id = this.currentSelection();
    return id === null ? null : (this.show().cues.find((c) => c.id === id)?.t ?? null);
  }

  private scrollIntoView(t: number): void {
    const w = this.size().w;
    const pps = this.pps();
    const x = (t - this.scroll()) * pps;
    if (x >= 0 && x <= w - 20) return;
    this.viewChange.emit({
      pxPerSecond: this.view().pxPerSecond,
      scroll: clampScroll(t - w / (3 * pps), w, pps, this.rangeEnd()),
    });
  }

  private schedule(): void {
    if (this.frame || typeof requestAnimationFrame === 'undefined') return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const { w, h } = this.size();
    if (w <= 0 || h <= 0) return;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const ruler = prepare(this.rulerCanvas().nativeElement, w, RULER_HEIGHT, dpr);
    const lane = prepare(this.laneCanvas().nativeElement, w, Math.max(1, h - RULER_HEIGHT), dpr);
    if (!ruler || !lane) return;
    const css = tokens(this.box().nativeElement);
    const show = this.show();
    const pps = this.pps();
    const scroll = this.scroll();
    const x = (t: number) => (t - scroll) * pps;
    const laneH = h - RULER_HEIGHT;
    const end = this.end();
    const known = this.endKnown();

    // Lane background: the launch window, then the hatched tail (from the end when it's earlier).
    lane.fillStyle = css.sunken;
    lane.fillRect(0, 0, w, laneH);
    const windowEnd = Math.min(show.duration, end > 0 && end < show.duration ? end : show.duration);
    lane.fillStyle = css.surface;
    lane.fillRect(x(0), 0, x(windowEnd) - x(0), laneH);
    const hatchFrom = x(windowEnd);
    lane.save();
    lane.beginPath();
    lane.rect(hatchFrom, 0, w - hatchFrom, laneH);
    lane.clip();
    lane.strokeStyle = css.border;
    lane.lineWidth = 1;
    for (let k = hatchFrom - laneH; k < w; k += 6) {
      lane.beginPath();
      lane.moveTo(k, laneH);
      lane.lineTo(k + laneH, 0);
      lane.stroke();
    }
    lane.restore();
    const label = (text: string, at: number) => {
      lane.font = `11px ${css.font}`;
      const tw = lane.measureText(text).width;
      lane.fillStyle = css.sunken;
      lane.fillRect(at + 3, 2, tw + 6, 14);
      lane.fillStyle = css.muted;
      lane.fillText(text, at + 6, 13);
    };
    if (end > 0 && end < show.duration) {
      label('Nothing launches here', x(end));
    } else {
      label('Tail', x(show.duration));
    }
    // The window line and the end marker.
    lane.fillStyle = css.accent2;
    lane.fillRect(Math.round(x(show.duration)), 0, 1, laneH);
    if (end > 0) {
      lane.strokeStyle = css.muted;
      lane.setLineDash([3, 3]);
      lane.beginPath();
      lane.moveTo(Math.round(x(end)) + 0.5, 0);
      lane.lineTo(Math.round(x(end)) + 0.5, laneH);
      lane.stroke();
      lane.setLineDash([]);
    }

    // Cues: the selected one last, on top.
    const layout = this.layout();
    const sel = this.selectedId();
    const drawCue = (c: LaneLayout['cues'][number], selected: boolean) => {
      const y = c.row * ROW_HEIGHT + ROW_HEIGHT / 2;
      const bottom = c.row * ROW_HEIGHT + ROW_HEIGHT - 2;
      lane.fillStyle = css.muted;
      lane.fillRect(Math.round(c.xLaunch), bottom - 8, 1, 8);
      if (layout.detailed) {
        lane.fillStyle = selected ? css.accent : css.control;
        lane.fillRect(c.xLaunch, y - 1, Math.max(0, c.xBurst - c.xLaunch), 2);
        let prev = c.xBurst;
        c.xBreaks.forEach((bx, k) => {
          lane.strokeStyle = css.control;
          lane.setLineDash([1, 2]);
          lane.beginPath();
          lane.moveTo(prev, y + 0.5);
          lane.lineTo(bx, y + 0.5);
          lane.stroke();
          lane.setLineDash([]);
          dot(lane, bx, y, 2, c.breakColors[k], css.control);
          prev = bx;
        });
      }
      const r = layout.detailed ? 4 : 3;
      dot(lane, c.xBurst, y, r, c.color, css.control);
      if (selected) {
        lane.strokeStyle = css.accent;
        lane.lineWidth = 2;
        lane.beginPath();
        lane.arc(c.xBurst, y, r + 2.5, 0, Math.PI * 2);
        lane.stroke();
        lane.lineWidth = 1;
      }
    };
    let selectedLayout: LaneLayout['cues'][number] | null = null;
    for (const c of layout.cues) {
      if (c.xBurst < -20 && c.xLaunch < -20) continue;
      if (c.xLaunch > w + 20) continue;
      if (c.cue.id === sel) selectedLayout = c;
      else drawCue(c, false);
    }
    if (selectedLayout) drawCue(selectedLayout, true);
    for (const b of layout.badges) {
      lane.font = `11px ${css.font}`;
      lane.fillStyle = css.muted;
      lane.fillText(`+${b.count}`, b.x, laneH - 3);
    }

    // Ruler.
    ruler.fillStyle = css.surface;
    ruler.fillRect(0, 0, w, RULER_HEIGHT);
    ruler.fillStyle = css.border;
    ruler.fillRect(0, RULER_HEIGHT - 1, w, 1);
    const step = tickSeconds(pps);
    ruler.font = `11px ${css.font}`;
    for (let t = Math.floor(scroll / step) * step; x(t) < w; t += step) {
      const px = Math.round(x(t));
      ruler.fillStyle = css.border;
      ruler.fillRect(px, RULER_HEIGHT - 6, 1, 6);
      ruler.fillStyle = css.muted;
      ruler.fillText(step < 1 ? formatTime(t).replace(/\.0$/, '') : formatClock(t), px + 3, 12);
    }
    ruler.fillStyle = css.accent2;
    ruler.fillRect(Math.round(x(show.duration)), 0, 1, RULER_HEIGHT);
    // Labels sit right of their line, or left of it when they'd run off the lane or into the next
    // label; the end label is dropped when it would cover the window label (the time shows it).
    const windowText = `Launch window ends ${formatClock(show.duration)}`;
    const endLabel = known ? `Ends ${formatTime(end)}` : `Ends about ${formatClock(end)}`;
    const xw = x(show.duration);
    const xe = x(end);
    const ww = ruler.measureText(windowText).width + 8;
    const ew = ruler.measureText(endLabel).width + 8;
    const limit = end > 0 && xe > xw ? xe : w;
    const windowAt = xw + ww > limit ? xw - ww : xw;
    rulerLabel(ruler, windowText, windowAt, css);
    if (end > 0) {
      const endAt = xe + ew > w ? xe - ew : xe;
      if (endAt + ew <= windowAt || endAt >= windowAt + ww) {
        rulerLabel(ruler, endLabel, endAt, css);
      } else {
        // No room in the ruler: the marker's label goes at the foot of the lane (§7.2).
        lane.font = `11px ${css.font}`;
        const at = xe + ew > w ? xe - ew : xe;
        lane.fillStyle = css.sunken;
        lane.fillRect(at + 2, laneH - 16, ew - 2, 14);
        lane.fillStyle = css.muted;
        lane.fillText(endLabel, at + 5, laneH - 5);
      }
    }
    this.setPlayhead(this.playheadSeconds);
  }
}

interface Tokens {
  surface: string;
  sunken: string;
  raised: string;
  border: string;
  control: string;
  muted: string;
  accent: string;
  accent2: string;
  font: string;
}

function tokens(el: HTMLElement): Tokens {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    surface: v('--color-surface', '#0d111c'),
    sunken: v('--color-surface-sunken', '#04060c'),
    raised: v('--color-surface-raised', '#141a29'),
    border: v('--color-border', '#232b40'),
    control: v('--color-border-control', '#56627f'),
    muted: v('--color-text-muted', '#8b93a8'),
    accent: v('--color-accent', '#ffb347'),
    accent2: v('--color-accent-secondary', '#ff7a59'),
    font: v('--font-sans', 'system-ui, sans-serif'),
  };
}

function prepare(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  dpr: number,
): CanvasRenderingContext2D | null {
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

const RAINBOW_WEDGES = ['#ff0000', '#ffd700', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'];

function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  edge: string,
): void {
  if (color === 'rainbow') {
    RAINBOW_WEDGES.forEach((c, k) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, (k / 6) * Math.PI * 2, ((k + 1) / 6) * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    });
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function rulerLabel(ctx: CanvasRenderingContext2D, text: string, at: number, css: Tokens): void {
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = css.surface;
  ctx.fillRect(at + 2, 1, tw + 6, 14);
  ctx.fillStyle = css.muted;
  ctx.fillText(text, at + 5, 12);
}
