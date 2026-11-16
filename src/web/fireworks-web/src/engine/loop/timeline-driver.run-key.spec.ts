// @vitest-environment node
/**
 * TimelineDriver run key after a width change and back (Toad, T3 finding F1). Kept apart from the
 * T3 property file so the property file's mutant proof counts only its own kills.
 */
import type { ShowDocument } from '../model/show';
import { FireworksSim } from '../sim/simulation';
import { EngineLoop } from './engine-loop';
import { T3_SHELLS } from './testing/seek-properties';
import { snapshot } from './testing/timeline-spec-helpers';
import { TimelineDriver } from './timeline-driver';

/**
 * Finding F1 (Toad, T3; owner Yoshi/Luigi): the run key is compared only with the key at the last
 * reset or restore. A width change and back while the show plays leaves a run that fired cues at
 * two widths, but `seek` treats it as current and `takeCheckpoint` stores checkpoints of it under
 * the original key. Fixed: `beforeStep` clears the run key on any step under another key, so
 * no checkpoint is taken and the next seek re-runs. `CaseOptions.resizeBack` is on in both T3 files.
 */
describe('TimelineDriver run key after a resize and back (finding F1, fixed)', () => {
  const doc = (): ShowDocument => ({
    version: 1,
    name: 'F1',
    sky: { gravity: 160, wind: 0 },
    duration: 4,
    shells: { cross: T3_SHELLS['cross'] },
    cues: [{ id: 'a', t: 0.5, shell: 'cross', x: 0.3, seed: 7 }],
  });
  const at = (width: number, step: number) => {
    const sim = new FireworksSim({ capacity: 2500 });
    const d = new TimelineDriver(doc(), { checkpointSteps: 0 });
    d.advance(new EngineLoop(sim, undefined, { worldWidth: () => width, driver: d }), step);
    return snapshot(sim);
  };
  const played = (cp: number) => {
    let width = 1280;
    const sim = new FireworksSim({ capacity: 2500 });
    const driver = new TimelineDriver(doc(), { checkpointSteps: cp });
    const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
    driver.seek(loop, 30);
    width = 1000;
    for (let f = 0; f < 30; f++) loop.frame(1000 / 60); // the cue at step 60 fires at width 1000
    width = 1280;
    return { sim, driver, loop };
  };

  it('a forward seek after the width comes back re-runs instead of running on', () => {
    const p = played(0);
    p.driver.seek(p.loop, 200);
    expect(snapshot(p.sim)).toEqual(at(1280, 200));
  });

  it('no checkpoint is taken of a run that fired at another width', () => {
    const p = played(120);
    for (let f = 0; f < 40; f++) p.loop.frame(1000 / 60); // past step 120 at width 1280
    expect(p.driver.checkpointSteps).toEqual([]);
    p.driver.seek(p.loop, 0);
    p.driver.seek(p.loop, 125);
    expect(snapshot(p.sim)).toEqual(at(1280, 125));
  });

  it('control: without the detour the same seeks are exact', () => {
    let width = 1280;
    const sim = new FireworksSim({ capacity: 2500 });
    const driver = new TimelineDriver(doc(), { checkpointSteps: 120 });
    const loop = new EngineLoop(sim, undefined, { worldWidth: () => width, driver });
    driver.seek(loop, 30);
    for (let f = 0; f < 70; f++) loop.frame(1000 / 60);
    expect(driver.checkpointSteps).toEqual([120]);
    driver.seek(loop, 0);
    driver.seek(loop, 125);
    expect(snapshot(sim)).toEqual(at(1280, 125));
    width = 1000; // and the mixed run is caught when the width stays changed
    driver.seek(loop, 200);
    expect(snapshot(sim)).toEqual(at(1000, 200));
  });
});
