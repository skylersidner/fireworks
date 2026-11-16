import { TestBed } from '@angular/core/testing';
import { doneWhenShow } from '../../../../testing/show-fixtures';
import type { ShowDocument } from '../../../../../engine/model/show';
import { firingOrder } from '../show-edit';
import type { TimelineView } from '../show-draft';
import { ShowTimelineComponent } from './timeline';
import {
  MAX_PX_PER_SECOND,
  ROW_HEIGHT,
  RULER_HEIGHT,
  hitTest,
  type LaneLayout,
} from './timeline-layout';

interface Internals {
  size: { set(v: { w: number; h: number }): void };
  layout(): LaneLayout;
  pps(): number;
  scroll(): number;
}

/** phase-7.md §5.5, §6, §7.1–§7.3; acceptance 7i.7, 7j.1–7j.4, 7j.10–7j.12, 7j.14. */
describe('ShowTimelineComponent gestures (Phase 7)', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ShowTimelineComponent] }));
  const W = 400;
  const H = 96;

  async function make(
    show: ShowDocument = doneWhenShow(),
    view: TimelineView = { pxPerSecond: null, scroll: 0 },
  ) {
    const fixture = TestBed.createComponent(ShowTimelineComponent);
    fixture.componentRef.setInput('show', show);
    fixture.componentRef.setInput('ordered', firingOrder(show));
    fixture.componentRef.setInput('view', view);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    const i = c as unknown as Internals;
    i.size.set({ w: W, h: H });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const lane = el.querySelector<HTMLCanvasElement>('[data-testid="timeline-lane"]')!;
    const ruler = el.querySelector<HTMLCanvasElement>('[data-testid="timeline-ruler"]')!;
    const box = el.querySelector<HTMLElement>('[data-testid="timeline"]')!;
    // jsdom lays nothing out: the box and ruler sit at (0, 0), the lane under the ruler.
    lane.getBoundingClientRect = () =>
      ({
        left: 0,
        top: RULER_HEIGHT,
        right: W,
        bottom: H,
        width: W,
        height: H - RULER_HEIGHT,
        x: 0,
        y: RULER_HEIGHT,
        toJSON() {},
      }) as DOMRect;
    box.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: W,
        bottom: H,
        width: W,
        height: H,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    ruler.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: W,
        bottom: RULER_HEIGHT,
        width: W,
        height: RULER_HEIGHT,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    const out = {
      manual: [] as TimelineView[],
      selected: [] as (string | null)[],
      seek: [] as number[],
      moved: [] as { id: string; t: number }[],
      kb: [] as string[],
    };
    c.manualView.subscribe((v) => out.manual.push(v));
    c.selected.subscribe((v) => out.selected.push(v));
    c.seek.subscribe((v) => out.seek.push(v));
    c.moved.subscribe((v) => out.moved.push(v));
    c.keyboardSelected.subscribe((v) => out.kb.push(v));
    const p = (
      target: Element,
      type: string,
      x: number,
      y: number,
      id = 1,
      pointerType = 'touch',
      extra: PointerEventInit = {},
    ) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType,
          clientX: x,
          clientY: y,
          button: 0,
          ...extra,
        }),
      );
    return { fixture, c, i, lane, ruler, box, out, p };
  }

  it('Ctrl+wheel is proportional: deltaY −10 multiplies by exp(0.1); −100 by at most 1.5; lines ×16 (7j.3)', async () => {
    const { c, i, box, out } = await make();
    const fit = i.pps();
    const wheel = (deltaY: number, deltaMode = 0) => {
      const e = new WheelEvent('wheel', {
        deltaY,
        deltaMode,
        ctrlKey: true,
        clientX: 0,
        bubbles: true,
        cancelable: true,
      });
      box.dispatchEvent(e);
      return e;
    };
    expect(wheel(-10).defaultPrevented).toBe(true);
    expect(out.manual.at(-1)!.pxPerSecond! / fit).toBeCloseTo(Math.exp(0.1), 6);
    c.zoomBy(1, 0); // no-op read
    out.manual.length = 0;
    (c as unknown as { viewAhead: null }).viewAhead = null;
    wheel(-100);
    expect(out.manual[0].pxPerSecond! / fit).toBeCloseTo(1.5, 6);
    (c as unknown as { viewAhead: null }).viewAhead = null;
    wheel(-1, 1);
    expect(out.manual.at(-1)!.pxPerSecond! / fit).toBeCloseTo(Math.exp(0.16), 6);
  });

  it('a plain wheel scroll is a manual view, so it stops Follow (phase-6.md §5.1, C2 ruling 3)', async () => {
    const { c, box, out } = await make(doneWhenShow(), { pxPerSecond: 40, scroll: 0 });
    const plain: TimelineView[] = [];
    c.viewChange.subscribe((v) => plain.push(v));
    const e = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true });
    box.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(out.manual).toEqual([{ pxPerSecond: 40, scroll: 2 }]);
    // Negative control: the old path emitted viewChange, which the page treats as a non-manual view.
    expect(plain).toEqual([]);
  });

  it('Safari gesturechange zooms by the same rule and is preventDefaulted (7j.4)', async () => {
    const { i, box, out } = await make();
    const fit = i.pps();
    const g = (type: string, scale: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(e, { scale: { value: scale }, clientX: { value: 0 } });
      box.dispatchEvent(e);
      return e;
    };
    expect(g('gesturestart', 1).defaultPrevented).toBe(true);
    expect(g('gesturechange', 1.2).defaultPrevented).toBe(true);
    expect(out.manual.at(-1)!.pxPerSecond! / fit).toBeCloseTo(1.2, 6);
    // Per event at most one ×1.5 step.
    g('gesturechange', 5);
    expect(out.manual.at(-1)!.pxPerSecond! / (fit * 1.2)).toBeCloseTo(1.5, 6);
  });

  it('a two-finger spread zooms by the distance ratio; the time under the midpoint stays (7j.1)', async () => {
    const { i, lane, out, p } = await make();
    const fit = i.pps();
    const y = RULER_HEIGHT + 70;
    p(lane, 'pointerdown', 100, y, 1);
    p(lane, 'pointerdown', 140, y, 2);
    const midTime = 120 / fit;
    p(lane, 'pointermove', 180, y, 2); // distance 40 → 80
    const v = out.manual.at(-1)!;
    expect(v.pxPerSecond! / fit).toBeCloseTo(2, 6);
    const mid = 140;
    expect(v.scroll + mid / v.pxPerSecond!).toBeCloseTo(midTime, 6);
    // Clamped at 200 px/s.
    p(lane, 'pointermove', 4000, y, 2);
    expect(out.manual.at(-1)!.pxPerSecond).toBe(MAX_PX_PER_SECOND);
    // Lifting after a pinch selects nothing and seeks nowhere (7j.2).
    out.selected.length = 0;
    p(lane, 'pointerup', 4000, y, 2);
    p(lane, 'pointerup', 100, y, 1);
    expect([out.selected, out.seek]).toEqual([[], []]);
  });

  it('a second finger reverts a cue drag: no moved, no document change (7j.2)', async () => {
    const show = doneWhenShow();
    const { fixture, i, lane, out, p } = await make(show, { pxPerSecond: 40, scroll: 0 });
    const target = i.layout().cues.find((c) => c.row === 0)!;
    fixture.componentRef.setInput('selectedId', target.cue.id);
    await fixture.whenStable();
    const y = RULER_HEIGHT + ROW_HEIGHT / 2;
    p(lane, 'pointerdown', target.xBurst, y, 1);
    p(lane, 'pointermove', target.xBurst + 40, y, 1);
    expect((fixture.componentInstance as unknown as { drag(): unknown }).drag()).not.toBeNull();
    p(lane, 'pointerdown', target.xBurst + 200, y, 2);
    expect((fixture.componentInstance as unknown as { drag(): unknown }).drag()).toBeNull();
    p(lane, 'pointerup', target.xBurst + 40, y, 1);
    p(lane, 'pointerup', target.xBurst + 200, y, 2);
    expect(out.moved).toEqual([]);
  });

  it('a second finger ends a ruler scrub where it was, as a release does', async () => {
    const { ruler, lane, out, p } = await make();
    p(ruler, 'pointerdown', 100, 10, 1);
    p(ruler, 'pointermove', 120, 10, 1);
    const before = out.seek.length;
    p(lane, 'pointerdown', 300, RULER_HEIGHT + 60, 2);
    expect(out.seek.length).toBe(before + 1);
  });

  it('touch: tap selects a cue; tap on empty lane seeks and deselects (7i.7)', async () => {
    const { i, lane, out, p } = await make(doneWhenShow(), { pxPerSecond: 40, scroll: 0 });
    const target = i.layout().cues.find((c) => c.row === 0)!;
    const y = RULER_HEIGHT + ROW_HEIGHT / 2;
    p(lane, 'pointerdown', target.xBurst, y, 1);
    p(lane, 'pointerup', target.xBurst + 3, y, 1);
    expect(out.selected).toEqual([target.cue.id]);
    // Empty: the first x in the bottom row that no cue claims within the touch radius.
    const emptyY = RULER_HEIGHT + 3 * ROW_HEIGHT + 9;
    let ex = -1;
    for (let x = 399; x > 0 && ex < 0; x--)
      if (!hitTest(i.layout(), x, 3 * ROW_HEIGHT + 9, null, 12)) ex = x;
    expect(ex).toBeGreaterThan(0);
    p(lane, 'pointerdown', ex, emptyY, 2);
    expect(out.seek).toEqual([]); // nothing on down for touch
    p(lane, 'pointerup', ex + 1, emptyY, 2);
    expect(out.selected.at(-1)).toBeNull();
    expect(out.seek).toHaveLength(1);
    expect(out.seek[0]).toBeCloseTo(ex / 40, 6);
  });

  it('touch: a drag that starts off the selected cue pans (no Undo-able edit); nothing at Fit', async () => {
    const { i, lane, out, p } = await make(doneWhenShow(), { pxPerSecond: 40, scroll: 10 });
    const target = i.layout().cues.find((c) => c.row === 0)!;
    const y = RULER_HEIGHT + ROW_HEIGHT / 2;
    p(lane, 'pointerdown', target.xBurst, y, 1); // not selected
    p(lane, 'pointermove', target.xBurst + 80, y, 1);
    p(lane, 'pointerup', target.xBurst + 80, y, 1);
    expect(out.moved).toEqual([]);
    expect(out.selected).toEqual([]);
    expect(out.manual.at(-1)).toEqual({ pxPerSecond: 40, scroll: 8 });

    const fit = await make();
    fit.p(fit.lane, 'pointerdown', 200, RULER_HEIGHT + 70, 1);
    fit.p(fit.lane, 'pointermove', 300, RULER_HEIGHT + 70, 1);
    fit.p(fit.lane, 'pointerup', 300, RULER_HEIGHT + 70, 1);
    expect(fit.out.manual).toEqual([]);
  });

  it('touch: a drag on the selected cue moves it, snapped to 0.1 s', async () => {
    const show = doneWhenShow();
    const { fixture, i, lane, out, p } = await make(show, { pxPerSecond: 40, scroll: 0 });
    const target = i.layout().cues.find((c) => c.row === 0)!;
    fixture.componentRef.setInput('selectedId', target.cue.id);
    await fixture.whenStable();
    const y = RULER_HEIGHT + ROW_HEIGHT / 2;
    p(lane, 'pointerdown', target.xBurst, y, 1);
    p(lane, 'pointermove', target.xBurst + 41, y, 1);
    p(lane, 'pointerup', target.xBurst + 41, y, 1);
    expect(out.moved).toEqual([
      { id: target.cue.id, t: Math.round((target.cue.t + 41 / 40) * 10) / 10 },
    ]);
  });

  it('a badge click zooms to its span, at least one step; at 200 px/s it selects the first hidden cue (7j.11, 7j.12)', async () => {
    const base = doneWhenShow();
    const cues = Array.from({ length: 12 }, (_, k) => ({
      ...base.cues[0],
      id: `k${k + 1}`,
      t: 10 + k * 0.01,
    }));
    const show = { ...base, cues };
    const { i, lane, out, p } = await make(show);
    const fit = i.pps();
    const b = i.layout().badges[0];
    expect(b).toBeDefined();
    const cx = (b.box.x0 + b.box.x1) / 2;
    const cy = RULER_HEIGHT + (b.box.y0 + b.box.y1) / 2;
    p(lane, 'pointerdown', cx, cy, 1, 'mouse');
    p(lane, 'pointerup', cx, cy, 1, 'mouse');
    const want = Math.min(
      MAX_PX_PER_SECOND,
      Math.max((0.8 * W) / Math.max(b.t1 - b.t0, 0.05), fit * 1.5),
    );
    const v = out.manual.at(-1)!;
    expect(v.pxPerSecond).toBeCloseTo(want, 9);
    expect(v.scroll + W / 2 / v.pxPerSecond!).toBeCloseTo((b.t0 + b.t1) / 2, 6);
    expect(out.selected).toEqual([]);

    const max = await make(show, { pxPerSecond: MAX_PX_PER_SECOND, scroll: 9.9 });
    const mb = max.i.layout().badges[0];
    expect(mb).toBeDefined();
    max.p(
      max.lane,
      'pointerdown',
      (mb.box.x0 + mb.box.x1) / 2,
      RULER_HEIGHT + (mb.box.y0 + mb.box.y1) / 2,
      1,
      'mouse',
    );
    expect(max.out.manual).toEqual([]);
    expect(max.out.selected).toEqual([mb.firstHiddenId]);
    expect(max.out.kb).toEqual([mb.firstHiddenId]);
  });

  it('revealView: outside the window scrolls the time to 10% from the left; inside is null (7j.14)', async () => {
    const { c } = await make(doneWhenShow(), { pxPerSecond: 40, scroll: 0 });
    expect(c.revealView(5)).toBeNull();
    expect(c.revealView(30)).toEqual({ pxPerSecond: 40, scroll: 30 - (W * 0.1) / 40 });
  });

  it('dropAt: snapped to 0.1 s, clamped to the window, null off the box; Alt snaps to a step', async () => {
    const { c } = await make(doneWhenShow(), { pxPerSecond: 40, scroll: 0 });
    expect(c.dropAt(101, 50, false)).toEqual({ t: 2.5, atEnd: false });
    expect(c.dropAt(101, 50, true)!.t).toBeCloseTo(Math.round((101 / 40) * 120) / 120, 9);
    expect(c.dropAt(500, 50, false)).toBeNull();
    const far = await make(doneWhenShow(), { pxPerSecond: 40, scroll: 55 });
    expect(far.c.dropAt(399, 50, false)).toEqual({ t: 60, atEnd: true });
  });
});
