import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CANVAS_RESOLUTION } from '../../../../core/browser';
import type { ShowDocument } from '../../../../../engine/model/show';
import { emptyShow } from '../show-edit';
import type { VisibleWindow } from './timeline';

/** The overview strip's height in CSS px (phase-7.md §7.3). */
export const OVERVIEW_HEIGHT = 12;

/**
 * The scrub bar's overview (phase-7.md §7.3, R7): an `aria-hidden` 2D canvas behind the native
 * Playhead range, across the whole view range `0 … viewEnd` whatever the lane's zoom. It draws the
 * launch window, the tail hatch, one tick per cue, the selected cue in accent, the end line and the
 * lane's visible window (hidden at Fit). The view box isn't draggable (D1): the range on top keeps
 * every pointer and key. Redrawn on a document, view, size or selection change, at most once per
 * animation frame, never per playback frame.
 */
@Component({
  selector: 'app-scrub-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pointer-events-none absolute inset-x-0 top-1/2 block -translate-y-1/2' },
  template: `<canvas
    #canvas
    class="block w-full"
    [style.height.px]="height"
    aria-hidden="true"
    data-testid="scrub-overview"
  ></canvas>`,
})
export class ScrubOverviewComponent {
  readonly show = input<ShowDocument>(emptyShow());
  readonly selectedId = input<string | null>(null);
  /** The show's end (estimate or known), seconds. */
  readonly end = input(0);
  /** The view range's right edge, seconds (the range input's max). */
  readonly viewEnd = input(1);
  /** The lane's visible window, or null before the timeline has measured. */
  readonly window = input<VisibleWindow | null>(null);

  protected readonly height = OVERVIEW_HEIGHT;
  /** Draw count, for the "never per frame" check (acceptance 7j.13). */
  draws = 0;

  private readonly resolution = inject(CANVAS_RESOLUTION);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly width = signal(0);
  private frame = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.canvas().nativeElement;
      const measure = () => this.width.set(el.clientWidth);
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        destroyRef.onDestroy(() => ro.disconnect());
      }
      const redraw = () => this.schedule();
      el.addEventListener('contextrestored', redraw);
      destroyRef.onDestroy(() => el.removeEventListener('contextrestored', redraw));
    });
    effect(() => {
      this.show();
      this.selectedId();
      this.end();
      this.viewEnd();
      this.window();
      this.width();
      untracked(() => this.schedule());
    });
    destroyRef.onDestroy(() => {
      if (this.frame && typeof cancelAnimationFrame !== 'undefined')
        cancelAnimationFrame(this.frame);
    });
  }

  private schedule(): void {
    if (this.frame || typeof requestAnimationFrame === 'undefined') return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Draws now (the frame callback; specs call it directly). */
  draw(): void {
    const w = this.width();
    if (w <= 0) return;
    this.draws++;
    const canvas = this.canvas().nativeElement;
    const dpr = this.resolution(); // phase-7.md §5.1: one rule with the stage and the lane
    const h = OVERVIEW_HEIGHT;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(canvas);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const raised = v('--color-surface-raised', '#141a29');
    const sunken = v('--color-surface-sunken', '#04060c');
    const border = v('--color-border', '#232b40');
    const muted = v('--color-text-muted', '#8b93a8');
    const accent = v('--color-accent', '#ffb347');

    const show = this.show();
    const end = this.end();
    const range = Math.max(1e-6, this.viewEnd());
    const x = (t: number) => (t / range) * w;
    const windowEnd = end > 0 && end < show.duration ? end : show.duration;

    // Launch window, then the hatched tail.
    ctx.fillStyle = raised;
    ctx.fillRect(0, 0, x(windowEnd), h);
    const tail = x(windowEnd);
    ctx.fillStyle = sunken;
    ctx.fillRect(tail, 0, w - tail, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(tail, 0, w - tail, h);
    ctx.clip();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    for (let k = tail - h; k < w; k += 6) {
      ctx.beginPath();
      ctx.moveTo(k, h);
      ctx.lineTo(k + h, 0);
      ctx.stroke();
    }
    ctx.restore();

    // One tick per cue; dense shows merge into blocks, which is the truth about density.
    const top = (h - 8) / 2;
    ctx.fillStyle = muted;
    const sel = this.selectedId();
    let selectedT: number | null = null;
    for (const cue of show.cues) {
      if (cue.id === sel) selectedT = cue.t;
      ctx.fillRect(Math.round(x(cue.t)), top, 1, 8);
    }
    if (selectedT !== null) {
      ctx.fillStyle = accent;
      ctx.fillRect(Math.round(x(selectedT)) - 0.5, top, 2, 8);
    }
    if (end > 0) {
      ctx.fillStyle = muted;
      ctx.fillRect(Math.round(x(end)), 0, 1, h);
    }

    // The lane's visible window (hidden at Fit: it would be the whole bar).
    const view = this.window();
    if (view && !view.atFit) {
      const x0 = Math.max(0, x(view.start));
      const x1 = Math.min(w, x(view.end));
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x0) + 0.5, 0.5, Math.max(1, Math.round(x1 - x0) - 1), h - 1);
    }
  }
}
