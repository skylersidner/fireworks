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
import { CANVAS_RESOLUTION } from '../../../../core/browser';
import type { ShowCue, ShowDocument } from '../../../../../engine/model/show';
import { STEPS_PER_SECOND } from '../../../../../engine/model/show';
import { EMPTY_LANE, TIMELINE_HELP, formatClock, formatTime } from '../show-copy';
import { clamp, emptyShow, snapTenth } from '../show-edit';
import { FIT_VIEW, type TimelineView } from '../show-draft';
import {
  BADGE_BASELINE,
  FOOT_LABEL_H,
  HIT_PX,
  MAX_PX_PER_SECOND,
  ROW_HEIGHT,
  RULER_HEIGHT,
  RULER_LABEL_H,
  RULER_LABEL_TOP,
  TOUCH_HIT_PX,
  ZOOM_STEP,
  badgeAt,
  clampScroll,
  effectivePxPerSecond,
  fitPxPerSecond,
  hitTest,
  labelPlacement,
  layoutLane,
  tickSeconds,
  viewRangeEnd,
  type Box,
  type LaneBadge,
  type LaneLayout,
} from './timeline-layout';

export type ZoomCommand = 'in' | 'out' | 'fit';

/** Scrub seeks wait for the pointer to pause this long, and again on release (§5.3). */
export const SCRUB_PAUSE_MS = 150;
/** A touch that moves less than this is a tap (phase-7.md §5.5). */
export const TAP_SLOP_PX = 8;
/** Trackpad and wheel zoom: `exp(-deltaY × this)` per event (phase-7.md §6). */
export const WHEEL_ZOOM_RATE = 0.01;
/** `deltaMode` 1 (lines) in px. */
export const WHEEL_LINE_PX = 16;

/** The lane's visible window, for the scrub overview (phase-7.md §7.3). */
export interface VisibleWindow {
  readonly start: number;
  readonly end: number;
  readonly atFit: boolean;
}

/** One-finger action in progress, cancelled by a second finger (phase-7.md §6). */
interface Gesture {
  cancel(): void;
}

/** Safari's trackpad pinch (`GestureEvent`, not in lib.dom). */
interface SafariGestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
}

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
      (pointermove)="onBoxMove($event)"
      (pointerup)="onBoxUp($event)"
      (pointercancel)="onBoxUp($event)"
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
        [class.cursor-pointer]="hoverBadge() !== null"
        [style.top.px]="rulerHeight"
        aria-hidden="true"
        data-testid="timeline-lane"
        (pointerdown)="onLaneDown($event)"
        (pointermove)="onLaneHover($event)"
        (pointerleave)="hoverBadge.set(null)"
      ></canvas>
      @if (dropGuide(); as g) {
        <div
          class="pointer-events-none absolute top-0 bottom-0 w-px bg-accent"
          [style.left.px]="g"
          aria-hidden="true"
          data-testid="drop-guide"
        ></div>
      }
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
  /**
   * A view change the visitor made with a gesture (pinch, pan, wheel scroll, trackpad zoom, a badge): the page
   * stops Follow, as any manual zoom does (phase-7.md §6, §7.2). Never an Undo step.
   */
  readonly manualView = output<TimelineView>();
  readonly focusInspector = output<void>();
  /** Arrow/Home/End selection, for the live region. */
  readonly keyboardSelected = output<string>();

  protected readonly rulerHeight = RULER_HEIGHT;
  protected readonly emptyText = EMPTY_LANE;
  protected readonly help = TIMELINE_HELP;
  protected readonly helpId = `timeline-help-${nextId++}`;
  protected readonly dragLabel = signal<{ x: number; text: string } | null>(null);
  /** The library drag's guide x, px in the box (phase-7.md §7.1). */
  protected readonly dropGuide = signal<number | null>(null);
  /** The badge under a hovering mouse, for its cursor and color (§7.2). */
  protected readonly hoverBadge = signal<number | null>(null);

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private readonly resolution = inject(CANVAS_RESOLUTION);
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
    layoutLane(
      this.show(),
      this.ordered(),
      this.pps(),
      this.scroll(),
      this.rows(),
      this.drag(),
      Math.max(1, this.size().h - RULER_HEIGHT),
    ),
  );
  /** For the scrub overview's view box (phase-7.md §7.3). */
  readonly visibleWindow = computed<VisibleWindow>(() => {
    const start = this.scroll();
    return {
      start,
      end: start + Math.max(1, this.size().w) / this.pps(),
      atFit: this.atFit(),
    };
  });
  /** Where the end label went on the last draw (phase-7.md §8), for specs. */
  lastLabelPlacement: ReturnType<typeof labelPlacement> | null = null;
  /** Draw count (phase-7.md §7.3's "never per frame" check reads the overview's; this is the lane's). */
  draws = 0;

  private frame = 0;
  private playheadSeconds = 0;
  /**
   * The selection this component last emitted, until the input catches up. Keys can arrive faster
   * than change detection (End then Left in one task), and must act on the latest selection.
   */
  private emittedSelection: { readonly id: string | null } | null = null;
  private scrubTimer: ReturnType<typeof setTimeout> | null = null;
  /** A view emitted in this task, ahead of the `view` input (cleared when the input catches up). */
  private viewAhead: TimelineView | null = null;
  /** Fingers on the timeline box, by pointer id (phase-7.md §5.5, §6). */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private pinch: { dist: number; pps: number; midTime: number } | null = null;
  /** After a pinch, nothing counts until every finger is up (no tap, no seek). */
  private touchSuppressed = false;
  private safariScale = 1;

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
      // A 2D canvas can lose its backing store under memory pressure (phase-7.md §11): redraw.
      const redraw = () => this.schedule();
      const canvases = [this.rulerCanvas().nativeElement, this.laneCanvas().nativeElement];
      for (const c of canvases) c.addEventListener('contextrestored', redraw);
      // Safari's trackpad pinch (phase-7.md §6): not a wheel event, and the page must not zoom.
      const start = (e: Event) => this.onSafariGesture(e as SafariGestureEvent, 'start');
      const change = (e: Event) => this.onSafariGesture(e as SafariGestureEvent, 'change');
      const end = (e: Event) => e.preventDefault();
      el.addEventListener('gesturestart', start);
      el.addEventListener('gesturechange', change);
      el.addEventListener('gestureend', end);
      destroyRef.onDestroy(() => {
        for (const c of canvases) c.removeEventListener('contextrestored', redraw);
        el.removeEventListener('gesturestart', start);
        el.removeEventListener('gesturechange', change);
        el.removeEventListener('gestureend', end);
      });
    });
    effect(() => {
      this.selectedId();
      untracked(() => (this.emittedSelection = null));
    });
    effect(() => {
      this.view();
      untracked(() => (this.viewAhead = null));
    });
    effect(() => {
      // Everything the draw reads; then one redraw on the next animation frame.
      this.layout();
      this.selectedId();
      this.endKnown();
      this.hoverBadge();
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
    current: TimelineView = this.currentView(),
  ): TimelineView {
    if (command === 'fit') return { pxPerSecond: null, scroll: 0 };
    return this.zoomBy(command === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP, around, current);
  }

  /**
   * px/s × `factor` around a time (the time under it stays put), clamped between Fit and 200 px/s.
   * The one zoom rule for the buttons, keys, wheel, trackpad and Safari gestures. Instant, no easing.
   */
  zoomBy(
    factor: number,
    around: number | null,
    current: TimelineView = this.currentView(),
  ): TimelineView {
    const w = Math.max(1, this.size().w);
    const pps = effectivePxPerSecond(current.pxPerSecond, w, this.rangeEnd());
    const scroll = clampScroll(current.scroll, w, pps, this.rangeEnd());
    return this.viewAt(
      pps * factor,
      around ?? this.playheadSeconds,
      (around ?? this.playheadSeconds) - scroll,
      pps,
    );
  }

  /** The view at `nextPps` with time `at` drawn `offsetSeconds × pps` px from the left edge. */
  private viewAt(nextPps: number, at: number, offsetSeconds: number, pps: number): TimelineView {
    const w = Math.max(1, this.size().w);
    const clampedNext = effectivePxPerSecond(nextPps, w, this.rangeEnd());
    const nextScroll = at - (offsetSeconds * pps) / clampedNext;
    const isFit = clampedNext <= fitPxPerSecond(w, this.rangeEnd()) + 1e-9;
    return {
      pxPerSecond: isFit ? null : clampedNext,
      scroll: isFit ? 0 : clampScroll(nextScroll, w, clampedNext, this.rangeEnd()),
    };
  }

  /**
   * The seek-scroll rule (phase-7.md §7.3): a time outside the visible window gives the view that
   * puts it 10% from the left (the Follow position); inside it, null.
   */
  revealView(t: number): TimelineView | null {
    const { start, end } = this.visibleWindow();
    if (t >= start && t <= end) return null;
    const w = Math.max(1, this.size().w);
    const pps = this.pps();
    return {
      pxPerSecond: this.view().pxPerSecond,
      scroll: clampScroll(t - (w * 0.1) / pps, w, pps, this.rangeEnd()),
    };
  }

  /**
   * A library drop at a viewport point (phase-7.md §7.1): the snapped, clamped time when the point
   * is over the lane or ruler, else null. Snaps to 0.1 s, or to one step with Alt/Option.
   */
  dropAt(clientX: number, clientY: number, alt: boolean): { t: number; atEnd: boolean } | null {
    const rect = this.box().nativeElement.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)
      return null;
    const raw = this.scroll() + (clientX - rect.left) / this.pps();
    const duration = this.show().duration;
    const t = clamp(
      alt ? Math.round(raw * STEPS_PER_SECOND) / STEPS_PER_SECOND : snapTenth(raw),
      0,
      duration,
    );
    return { t, atEnd: t >= duration };
  }

  /** Shows (or clears) the drop guide and its label (phase-7.md §7.1). */
  showDrop(drop: { t: number; label: string } | null): void {
    if (!drop) {
      this.dropGuide.set(null);
      this.dragLabel.set(null);
      return;
    }
    const x = (drop.t - this.scroll()) * this.pps();
    this.dropGuide.set(x);
    this.dragLabel.set({ x, text: drop.label });
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
      // Trackpad pinch arrives as Ctrl+wheel: proportional, at most one ×1.5 step per event, so a
      // mouse notch (|deltaY| ≈ 100) is still about one step (phase-7.md §6).
      event.preventDefault();
      const rect = this.box().nativeElement.getBoundingClientRect();
      const around = this.scroll() + (event.clientX - rect.left) / pps;
      const px = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_PX : event.deltaY;
      const factor = clamp(Math.exp(-px * WHEEL_ZOOM_RATE), 1 / ZOOM_STEP, ZOOM_STEP);
      this.emitManual(this.zoomBy(factor, around));
      return;
    }
    const delta =
      event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX || event.deltaY
        : event.deltaY;
    if (!delta || this.atFit()) return;
    event.preventDefault();
    const w = Math.max(1, this.size().w);
    // A manual scroll stops Follow (phase-6.md §5.1; C2 ruling 3), so it goes out as a manual view.
    this.emitManual({
      pxPerSecond: this.view().pxPerSecond,
      scroll: clampScroll(this.scroll() + delta / pps, w, pps, this.rangeEnd()),
    });
  }

  private onSafariGesture(event: SafariGestureEvent, phase: 'start' | 'change'): void {
    event.preventDefault();
    if (phase === 'start') {
      this.safariScale = 1;
      return;
    }
    const scale = Number.isFinite(event.scale) && event.scale > 0 ? event.scale : 1;
    const factor = clamp(scale / this.safariScale, 1 / ZOOM_STEP, ZOOM_STEP);
    this.safariScale = scale;
    const rect = this.box().nativeElement.getBoundingClientRect();
    const x = Number.isFinite(event.clientX) ? event.clientX - rect.left : rect.width / 2;
    this.emitManual(this.zoomBy(factor, this.scroll() + x / this.pps()));
  }

  // ---- Pointers ------------------------------------------------------------------------------

  /**
   * Records a finger. A second finger cancels the one-finger action and starts a pinch; a third,
   * or any finger after a pinch until all are up, is ignored. True when the caller must ignore it.
   */
  private touchDown(event: PointerEvent): boolean {
    if (event.pointerType !== 'touch') return false;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touches.size === 2) {
      this.gesture?.cancel();
      this.gesture = null;
      this.startPinch();
      return true;
    }
    return this.touches.size > 2 || this.touchSuppressed;
  }

  private startPinch(): void {
    const [a, b] = [...this.touches.values()];
    const rect = this.box().nativeElement.getBoundingClientRect();
    const mid = (a.x + b.x) / 2 - rect.left;
    const pps = this.pps();
    this.pinch = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      pps,
      midTime: this.scroll() + mid / pps,
    };
    this.touchSuppressed = true;
  }

  protected onBoxMove(event: PointerEvent): void {
    if (event.pointerType !== 'touch' || !this.touches.has(event.pointerId)) return;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = this.pinch;
    if (!pinch || this.touches.size < 2) return;
    const [a, b] = [...this.touches.values()];
    const rect = this.box().nativeElement.getBoundingClientRect();
    const mid = (a.x + b.x) / 2 - rect.left;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    // The time under the starting midpoint stays under the midpoint; moving both fingers pans.
    this.emitManual(this.viewAt(pinch.pps * (dist / pinch.dist), pinch.midTime, mid, 1));
  }

  protected onBoxUp(event: PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    this.touches.delete(event.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (this.touches.size === 0) this.touchSuppressed = false;
  }

  protected onRulerDown(event: PointerEvent): void {
    if (this.touchDown(event)) return;
    this.box().nativeElement.focus();
    const canvas = this.rulerCanvas().nativeElement;
    this.scrubFrom(event, canvas);
  }

  protected onLaneDown(event: PointerEvent): void {
    if (this.touchDown(event)) return;
    this.box().nativeElement.focus();
    const canvas = this.laneCanvas().nativeElement;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const layout = this.layout();
    const badge = badgeAt(layout, px, py);
    const touch = event.pointerType === 'touch';
    if (touch) {
      this.touchLane(event, canvas, layout, px, py, badge);
      return;
    }
    if (badge) {
      this.badgeClick(badge);
      return;
    }
    const hit = hitTest(layout, px, py, this.currentSelection(), HIT_PX);
    if (!hit) {
      this.emitSelection(null);
      this.scrubFrom(event, canvas);
      return;
    }
    this.emitSelection(hit.id);
    this.dragCue(event, canvas, hit, 3);
  }

  /**
   * A finger on the lane (phase-7.md §5.5): a tap selects, or seeks and deselects, or zooms at a
   * badge; a drag on the selected cue moves it; any other drag pans (nothing at Fit).
   */
  private touchLane(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    layout: LaneLayout,
    px: number,
    py: number,
    badge: LaneBadge | null,
  ): void {
    const hit = badge ? null : hitTest(layout, px, py, this.currentSelection(), TOUCH_HIT_PX);
    if (hit && hit.id === this.currentSelection()) {
      this.dragCue(event, canvas, hit, TAP_SLOP_PX);
      return;
    }
    const startX = event.clientX;
    const startScroll = this.scroll();
    const pps = this.pps();
    let moved = false;
    canvas.setPointerCapture?.(event.pointerId);
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < TAP_SLOP_PX) return;
      moved = true;
      if (this.atFit()) return;
      const w = Math.max(1, this.size().w);
      this.emitManual({
        pxPerSecond: this.view().pxPerSecond,
        scroll: clampScroll(startScroll - dx / pps, w, pps, this.rangeEnd()),
      });
    };
    const stop = () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', cancel);
      if (this.gesture === gesture) this.gesture = null;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      stop();
      if (moved) return;
      if (badge) this.badgeClick(badge);
      else if (hit) this.emitSelection(hit.id);
      else {
        this.emitSelection(null);
        const t = Math.max(0, startScroll + px / pps);
        this.setPlayhead(t);
        this.scrub.emit(t);
        this.seek.emit(t);
      }
    };
    const cancel = () => stop();
    const gesture: Gesture = { cancel: stop };
    this.gesture = gesture;
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', cancel);
  }

  /** Drags a cue (snap 0.1 s, Alt one step, clamped to the window). A second finger reverts it. */
  private dragCue(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    hit: ShowCue,
    slop: number,
  ): void {
    const startX = event.clientX;
    const t0 = hit.t;
    const duration = this.show().duration;
    const pps = this.pps();
    let moved = false;
    canvas.setPointerCapture?.(event.pointerId);
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < slop) return;
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
    const stop = () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      if (this.gesture === gesture) this.gesture = null;
      const d = this.drag();
      this.drag.set(null);
      this.dragLabel.set(null);
      return d;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const d = stop();
      if (moved && d && d.t !== t0) this.moved.emit({ id: d.id, t: d.t });
    };
    // Cancel reverts: no `moved`, so the document doesn't change (phase-7.md §6).
    const gesture: Gesture = { cancel: () => void stop() };
    this.gesture = gesture;
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
      if (e.pointerId !== event.pointerId) return;
      last = timeAt(e.clientX);
      fire(last);
    };
    // A release, or a second finger: the scrub ends where it was (phase-7.md §6).
    const end = () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      if (this.gesture === gesture) this.gesture = null;
      if (this.scrubTimer) clearTimeout(this.scrubTimer);
      this.scrubTimer = null;
      this.seek.emit(last);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) end();
    };
    const gesture: Gesture = { cancel: end };
    this.gesture = gesture;
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  }

  protected onLaneHover(event: PointerEvent): void {
    if (event.pointerType === 'touch' || event.buttons) return;
    const rect = this.laneCanvas().nativeElement.getBoundingClientRect();
    const badge = badgeAt(this.layout(), event.clientX - rect.left, event.clientY - rect.top);
    const index = badge ? this.layout().badges.indexOf(badge) : null;
    if (index !== this.hoverBadge()) this.hoverBadge.set(index);
  }

  /**
   * A `+k` badge (phase-7.md §7.2): zoom to the cluster's span, centered, by at least one step; at
   * 200 px/s, select its first hidden cue and announce it like a keyboard selection.
   */
  private badgeClick(badge: LaneBadge): void {
    if (this.atMax()) {
      this.emitSelection(badge.firstHiddenId);
      this.keyboardSelected.emit(badge.firstHiddenId);
      return;
    }
    const w = Math.max(1, this.size().w);
    const span = Math.max(badge.t1 - badge.t0, 0.05);
    const pps = Math.min(MAX_PX_PER_SECOND, Math.max((0.8 * w) / span, this.pps() * ZOOM_STEP));
    const center = (badge.t0 + badge.t1) / 2;
    this.emitManual({
      pxPerSecond: pps,
      scroll: clampScroll(center - w / (2 * pps), w, pps, this.rangeEnd()),
    });
  }

  private emitManual(view: TimelineView): void {
    this.viewAhead = view;
    this.manualView.emit(view);
  }

  private currentView(): TimelineView {
    return this.viewAhead ?? this.view();
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
    this.draws++;
    const dpr = this.resolution(); // phase-7.md §5.1: one rule with the stage
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
    const label = (text: string, at: number): Box => {
      lane.font = `11px ${css.font}`;
      const tw = lane.measureText(text).width;
      lane.fillStyle = css.sunken;
      lane.fillRect(at + 3, 2, tw + 6, 14);
      lane.fillStyle = css.muted;
      lane.fillText(text, at + 6, 13);
      return { x0: at + 3, y0: 2, x1: at + tw + 9, y1: 16 };
    };
    const pad =
      end > 0 && end < show.duration
        ? label('Nothing launches here', x(end))
        : label('Tail', x(show.duration));
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
    const hover = this.hoverBadge();
    layout.badges.forEach((b, k) => {
      lane.font = `11px ${css.font}`;
      lane.fillStyle = k === hover ? css.primary : css.muted;
      lane.fillText(`+${b.count}`, b.x, laneH - BADGE_BASELINE);
    });

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
    this.lastLabelPlacement = null;
    if (end > 0) {
      // Ruler right, ruler left, lane foot right, lane foot left, else not drawn: badges always
      // win (phase-7.md §8, R8). The dashed line, the transport and the overview still show it.
      const placed = labelPlacement({
        width: w,
        laneHeight: laneH,
        xEnd: xe,
        labelWidth: ew,
        windowBox: {
          x0: windowAt,
          y0: RULER_LABEL_TOP,
          x1: windowAt + ww,
          y1: RULER_LABEL_TOP + RULER_LABEL_H,
        },
        badges: layout.badges.map((b) => b.box),
        pad,
      });
      this.lastLabelPlacement = placed;
      if (placed.box && placed.step <= 2) rulerLabel(ruler, endLabel, placed.box.x0, css);
      else if (placed.box) {
        lane.font = `11px ${css.font}`;
        lane.fillStyle = css.sunken;
        lane.fillRect(placed.box.x0 + 2, laneH - FOOT_LABEL_H - 2, ew - 2, FOOT_LABEL_H);
        lane.fillStyle = css.muted;
        lane.fillText(endLabel, placed.box.x0 + 5, laneH - 5);
      }
    }
    this.setPlayhead(this.playheadSeconds);
  }
}

interface Tokens {
  primary: string;
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
    primary: v('--color-text-primary', '#e6e9f2'),
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
