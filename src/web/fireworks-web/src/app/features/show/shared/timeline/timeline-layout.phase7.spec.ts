// @vitest-environment node
import { doneWhenShow } from '../../../../testing/show-fixtures';
import { firingOrder } from '../show-edit';
import {
  BADGE_MIN_HIT,
  ROW_HEIGHT,
  badgeAt,
  hitTest,
  intersects,
  labelPlacement,
  layoutLane,
  type Box,
  type LabelPlacementInput,
} from './timeline-layout';

/** phase-7.md §5.2 item 9, §7.2, §8; acceptance 7i.8, 7j.10, 7j.15. */
describe('timeline layout, Phase 7', () => {
  const crowded = () => {
    const show = doneWhenShow();
    const cues = Array.from({ length: 12 }, (_, i) => ({
      ...show.cues[0],
      id: `k${i + 1}`,
      t: 10 + i * 0.01,
    }));
    return { ...show, cues };
  };

  it('each badge carries t0, t1, the first hidden cue (firing order) and a ≥24x24 hit box', () => {
    const show = crowded();
    const order = firingOrder(show);
    const lane = layoutLane(show, order, 10, 0, 2, null, 40);
    expect(lane.badges).toHaveLength(1);
    const b = lane.badges[0];
    const hidden = lane.cues.filter((c, i) => i >= 2).map((c) => c.cue);
    expect(b.count).toBe(hidden.length);
    expect(b.firstHiddenId).toBe(order[2].id);
    expect(b.t0).toBeCloseTo(Math.min(...hidden.map((c) => c.t)), 9);
    expect(b.t1).toBeGreaterThan(b.t0);
    expect(b.box.x1 - b.box.x0).toBeGreaterThanOrEqual(BADGE_MIN_HIT);
    expect(b.box.y1 - b.box.y0).toBeGreaterThanOrEqual(BADGE_MIN_HIT);
    const cx = (b.box.x0 + b.box.x1) / 2;
    const cy = (b.box.y0 + b.box.y1) / 2;
    expect(badgeAt(lane, cx, cy)).toBe(b);
    expect(badgeAt(lane, cx, -50)).toBeNull();
  });

  it('touch hits within 12 px, mouse within 6 px (7i.8)', () => {
    const show = doneWhenShow();
    const lane = layoutLane(show, firingOrder(show), 40, 0, 7);
    const target = lane.cues.find((c) => c.row === 0)!;
    const y = ROW_HEIGHT / 2;
    // Off to the left of the launch tick, where no other point of this cue sits.
    const px = target.xLaunch - 10;
    const others = lane.cues.filter((c) => c !== target && c.row === 0);
    const clear = others.every((c) =>
      [c.xLaunch, c.xBurst, ...c.xBreaks].every((p) => Math.abs(p - px) > 12),
    );
    expect(clear).toBe(true);
    expect(hitTest(lane, px, y, null)).toBeNull();
    expect(hitTest(lane, px, y, null, 12)?.id).toBe(target.cue.id);
  });

  const input = (over: Partial<LabelPlacementInput> = {}): LabelPlacementInput => ({
    width: 400,
    laneHeight: 74,
    xEnd: 380,
    labelWidth: 90,
    windowBox: { x0: 290, y0: 1, x1: 400, y1: 15 },
    badges: [{ x0: 360, y0: 50, x1: 384, y1: 74 }],
    pad: { x0: 383, y0: 2, x1: 400, y1: 16 },
    ...over,
  });

  /** Today's placement (before Phase 7): ruler when clear of the window label, else the foot. */
  function legacy(i: LabelPlacementInput): Box {
    const endAt = i.xEnd + i.labelWidth > i.width ? i.xEnd - i.labelWidth : i.xEnd;
    const ruler = { x0: endAt, y0: 1, x1: endAt + i.labelWidth, y1: 15 };
    if (!intersects(ruler, i.windowBox)) return ruler;
    return { x0: endAt, y0: i.laneHeight - 16, x1: endAt + i.labelWidth, y1: i.laneHeight - 2 };
  }

  it('the end label never covers a badge: step 4 or 5 here, no box intersects (7j.15)', () => {
    const i = input();
    const placed = labelPlacement(i);
    expect([4, 5]).toContain(placed.step);
    if (placed.box) for (const b of i.badges) expect(intersects(placed.box, b)).toBe(false);
  });

  it('negative control: the pre-Phase-7 lane-foot placement covers the badge', () => {
    const i = input();
    expect(i.badges.some((b) => intersects(legacy(i), b))).toBe(true);
  });

  it('the order: ruler right, ruler left, foot right, foot left, then not drawn', () => {
    expect(
      labelPlacement(input({ windowBox: { x0: 0, y0: 1, x1: 50, y1: 15 }, xEnd: 100 })).step,
    ).toBe(1);
    expect(labelPlacement(input({ windowBox: { x0: 0, y0: 1, x1: 50, y1: 15 } })).step).toBe(2);
    expect(
      labelPlacement(input({ xEnd: 100, windowBox: { x0: 0, y0: 1, x1: 400, y1: 15 }, badges: [] }))
        .step,
    ).toBe(3);
    expect(
      labelPlacement(
        input({
          windowBox: { x0: 0, y0: 1, x1: 400, y1: 15 },
          badges: [{ x0: 0, y0: 50, x1: 24, y1: 74 }],
        }),
      ).step,
    ).toBe(4);
    expect(
      labelPlacement(
        input({
          windowBox: { x0: 0, y0: 1, x1: 400, y1: 15 },
          badges: [{ x0: 200, y0: 50, x1: 400, y1: 74 }],
        }),
      ),
    ).toEqual({ step: 5, box: null });
  });
});
