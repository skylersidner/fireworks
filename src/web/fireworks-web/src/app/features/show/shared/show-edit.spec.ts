import { MAX_SHOW_SHELLS } from '../../../../engine/model/limits';
import { PRESETS } from '../../../../engine/model/presets';
import { validateShow } from '../../../../engine/model/validate';
import { doneWhenShow } from '../../../testing/show-fixtures';
import {
  cueIdFor,
  deleteCue,
  embedShell,
  embeddable,
  emptyShow,
  nextCueIdAfter,
  removeShell,
  roundUpTenth,
  shellOptionLabels,
  updateCue,
  withCue,
} from './show-edit';

describe('show edits (phase-6.md §4; acceptance 6c, 6d)', () => {
  it('the local Done-when fixture is a valid 60 s, 50-cue show (6b.1 shape)', () => {
    const show = doneWhenShow();
    expect(validateShow(show).ok).toBe(true);
    expect(show.duration).toBe(60);
    expect(show.cues).toHaveLength(50);
    expect(show.cues.some((c) => c.t === 60) && show.cues.some((c) => c.t === 0)).toBe(true);
    expect(show.cues[1].t).toBe(show.cues[9].t);
    expect(Object.keys(show.shells).some((k) => !show.cues.some((c) => c.shell === k))).toBe(true);
  });

  it('rounds the playhead up to 0.1 s, keeping exact tenths', () => {
    expect(roundUpTenth(12.5)).toBe(12.5);
    expect(roundUpTenth(12.51)).toBe(12.6);
    expect(roundUpTenth(0)).toBe(0);
    expect(roundUpTenth(7 / 120)).toBe(0.1);
  });

  it('ids come from the counter and are never reused after a delete (Peach N4)', () => {
    let show = emptyShow();
    const embedded = embedShell(show, embeddable(PRESETS[0])!);
    if (!embedded.ok) throw new Error('embed');
    show = embedded.show;
    let n = 1;
    for (let i = 0; i < 3; i++) {
      const { id, next } = cueIdFor(show, n);
      n = next;
      show = withCue(show, { id, t: i, shell: embedded.key, x: 0.5, seed: i });
    }
    show = deleteCue(show, 'c3');
    expect(cueIdFor(show, n).id).toBe('c4');
    expect(nextCueIdAfter(show)).toBe(3);
    // A hand-made id in the way is skipped.
    expect(cueIdFor(withCue(show, { ...show.cues[0], id: 'c4' }), 4).id).toBe('c5');
  });

  it('copies a shell in without sky, reuses an identical one, and blocks a 33rd (6d.1, 6d.3)', () => {
    let show = emptyShow();
    const willow = embeddable({ ...PRESETS[2], sky: { gravity: 99, wind: 3 } })!;
    expect('sky' in willow).toBe(false);
    const first = embedShell(show, willow);
    if (!first.ok) throw new Error('embed');
    show = first.show;
    const again = embedShell(show, embeddable(PRESETS[2])!);
    expect(again.ok && again.key).toBe(first.key);
    expect(Object.keys(show.shells)).toEqual(['s1']);
    for (let i = 0; Object.keys(show.shells).length < MAX_SHOW_SHELLS; i++) {
      const r = embedShell(show, { ...willow, name: `W${i}` });
      if (!r.ok) throw new Error('cap too early');
      show = r.show;
    }
    expect(embedShell(show, { ...willow, name: 'one more' })).toEqual({
      ok: false,
      reason: 'shell-cap',
    });
    expect(embedShell(show, willow).ok).toBe(true);
  });

  it('updateCue clamps t and x, never stores null, and removes burstHeight on undefined (6c.3)', () => {
    const show = doneWhenShow();
    const id = show.cues[3].id;
    const moved = updateCue(show, id, { t: 99, x: -1, burstHeight: 0.5 });
    const cue = moved.cues[3];
    expect([cue.t, cue.x, cue.burstHeight, cue.id, cue.seed]).toEqual([
      60,
      0,
      0.5,
      id,
      show.cues[3].seed,
    ]);
    const off = updateCue(moved, id, { burstHeight: undefined }).cues[3];
    expect('burstHeight' in off).toBe(false);
    expect(show.cues[3].t).not.toBe(99); // never mutated
  });

  it('removing a shell deletes its cues only', () => {
    const show = doneWhenShow();
    const out = removeShell(show, 's1');
    expect(Object.hasOwn(out.shells, 's1')).toBe(false);
    expect(out.cues.every((c) => c.shell !== 's1')).toBe(true);
    expect(out.cues.length).toBe(show.cues.filter((c) => c.shell !== 's1').length);
  });

  it('duplicate shell names get " · 2" in key order', () => {
    const show = emptyShow();
    const p = embeddable(PRESETS[0])!;
    show.shells = { s1: p, s2: { ...p, angleJitter: 1 } };
    expect(shellOptionLabels(show).map((o) => o.label)).toEqual(['Peony', 'Peony · 2']);
  });
});
