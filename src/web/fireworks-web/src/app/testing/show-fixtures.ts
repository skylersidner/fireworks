import { PRESETS } from '../../engine/model/presets';
import type { EmbeddedShell, ShowCue, ShowDocument } from '../../engine/model/show';
import { embeddable } from '../features/show/shared/show-edit';

/**
 * A local stand-in for Toad's `schema/fixtures/valid/show/done-when-60s-50.json` (acceptance
 * 6b.1), until that shared fixture lands: 60 s, 50 cues, a cue at t = 0 and at t = duration, two
 * same-step pairs whose array order is the reverse of ordinal id order (c2/c10, c3/c20), x at 0 and
 * 1, cues with and without `burstHeight`, non-zero wind, crossette, crackle, glitter, strobe and a
 * 4-break shell, plus one unused shell. Deterministic.
 */
export function doneWhenShow(): ShowDocument {
  const shell = (i: number): EmbeddedShell => embeddable(PRESETS[i])!;
  const fourBreak = shell(9);
  fourBreak.name = 'Four Break';
  fourBreak.breaks.push({ ...fourBreak.breaks[0], color1: 'purple', delay: 0.9 });
  const shells: Record<string, EmbeddedShell> = {
    s1: shell(5), // Crossette
    s2: shell(6), // Crackling Heart (crackle)
    s3: shell(2), // Willow (glitter)
    s4: shell(7), // Strobe
    s5: fourBreak,
    s6: shell(0), // Peony, unused
  };
  return {
    version: 1,
    name: 'Done-when 60s',
    sky: { gravity: 160, wind: 12 },
    duration: 60,
    shells,
    cues: doneWhenCues(),
  };
}

export function doneWhenCues(): ShowCue[] {
  const keys = ['s1', 's2', 's3', 's4', 's5'];
  const cues: ShowCue[] = [];
  for (let i = 1; i <= 50; i++) {
    const cue: ShowCue = {
      id: `c${i}`,
      t: Math.round(((i - 1) * 60 * 10) / 49) / 10,
      shell: keys[(i - 1) % keys.length],
      x: i === 1 ? 0 : i === 50 ? 1 : ((i * 37) % 101) / 100,
      seed: Math.imul(i, 2654435761 | 0),
    };
    if (i % 7 === 0) cue.burstHeight = [0.5, 0.6, 0.7][i % 3];
    cues.push(cue);
  }
  cues[1].t = cues[9].t; // c2 with c10
  cues[2].t = cues[19].t; // c3 with c20
  return cues;
}
