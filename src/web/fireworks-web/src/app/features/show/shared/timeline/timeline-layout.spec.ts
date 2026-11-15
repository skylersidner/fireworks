// @vitest-environment node
import { doneWhenShow } from '../../../../testing/show-fixtures';
import { firingOrder } from '../show-edit';
import {
  DETAIL_PX_PER_SECOND,
  MAX_PX_PER_SECOND,
  ROW_HEIGHT,
  effectivePxPerSecond,
  hitTest,
  layoutLane,
  tickSeconds,
  viewRangeEnd,
} from './timeline-layout';

describe('timeline layout (phase-6.md §5.1, §6)', () => {
  it('view range, Fit and the 200 px/s ceiling', () => {
    expect(viewRangeEnd(60, 67)).toBeCloseTo(68.34, 6);
    expect(effectivePxPerSecond(null, 680, 68)).toBe(10);
    expect(effectivePxPerSecond(1, 680, 68)).toBe(10);
    expect(effectivePxPerSecond(1e6, 680, 68)).toBe(MAX_PX_PER_SECOND);
  });

  it('ticks keep labels at least 60 px apart', () => {
    expect(tickSeconds(200)).toBe(0.5);
    expect(tickSeconds(10)).toBe(10);
    expect(tickSeconds(1)).toBe(60);
  });

  it('1000 cues lay out in rows within the lane, compact under 20 px/s', () => {
    const show = doneWhenShow();
    const many = Array.from({ length: 1000 }, (_, i) => ({
      ...show.cues[i % 50],
      id: `k${i}`,
      t: (i % 600) / 10,
    }));
    const lane = layoutLane({ ...show, cues: many }, firingOrder({ cues: many }), 10, 0, 7);
    expect(lane.detailed).toBe(10 >= DETAIL_PX_PER_SECOND);
    expect(lane.cues).toHaveLength(1000);
    expect(Math.max(...lane.cues.map((c) => c.row))).toBeLessThanOrEqual(6);
    expect(lane.badges.reduce((n, b) => n + b.count, 0)).toBeGreaterThan(0);
  });

  it('hit testing picks the cue under the pointer, the selected one first', () => {
    const show = doneWhenShow();
    const lane = layoutLane(show, firingOrder(show), 40, 0, 7);
    const target = lane.cues[5];
    expect(hitTest(lane, target.xBurst, target.row * ROW_HEIGHT + 9, null)?.id).toBe(target.cue.id);
    expect(hitTest(lane, target.xBurst, (target.row + 3) * ROW_HEIGHT + 9, null)).toBeNull();
  });
});
