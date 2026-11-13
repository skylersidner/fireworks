// @vitest-environment node
import { PLAYBACK_MODES } from '../model/enums';
import { PRESETS } from '../model/presets';
import { newShell } from '../model/shell';
import { GROUND, STEP } from '../sim/constants';
import { FireworksSim } from '../sim/simulation';
import { createDriver, ManualDriver, PreviewLoopDriver, RandomShowDriver } from './drivers';
import { EngineLoop, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from './engine-loop';
import { TimelineDriver } from './timeline-driver';

function makeLoop(options: ConstructorParameters<typeof EngineLoop>[2] = {}) {
  const sim = new FireworksSim();
  const loop = new EngineLoop(sim, structuredClone(PRESETS[0]), {
    worldWidth: () => 1280,
    ...options,
  });
  return { sim, loop };
}

/** Counts sim.step calls. */
function stepSpy(sim: FireworksSim) {
  return vi.spyOn(sim, 'step');
}

describe('EngineLoop timing (2a.14)', () => {
  it('(a) clamps a frame to 0.1 s: a 10 s frame runs 12 steps, not 1200', () => {
    const { sim, loop } = makeLoop();
    const spy = stepSpy(sim);
    expect(MAX_FRAME_DT).toBe(0.1);
    expect(loop.frame(10_000)).toBe(12);
    expect(spy).toHaveBeenCalledTimes(12);
    expect(spy).toHaveBeenCalledWith(STEP);
  });

  it('a 60 fps frame runs 2 steps; the remainder carries over', () => {
    const { loop } = makeLoop();
    const steps = Array.from({ length: 60 }, () => loop.frame(1000 / 60));
    expect(steps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(119);
    expect(Math.max(...steps)).toBe(2);
  });

  it('(b) caps a frame at 24 steps and drops the accumulator (clamp raised to reach the cap)', () => {
    // With the default 0.1 s clamp a frame can only reach 12 steps, so the cap would be
    // untestable (acceptance F2). Raising the clamp makes the cap the binding limit.
    expect(MAX_STEPS_PER_FRAME).toBe(24);
    const { sim, loop } = makeLoop({ maxFrameDt: 1 });
    const spy = stepSpy(sim);
    expect(loop.frame(1000)).toBe(24);
    expect(spy).toHaveBeenCalledTimes(24);
    // The accumulator was dropped: a tiny next frame takes no step (it would take 24 otherwise).
    expect(loop.frame(1)).toBe(0);
  });

  it('(c) the fps average is the 0.95/0.05 EMA of 1/dt, starting at 60', () => {
    const { loop } = makeLoop();
    expect(loop.fpsAvg).toBe(60);
    loop.frame(1000 / 30);
    expect(loop.fpsAvg).toBeCloseTo(60 * 0.95 + 30 * 0.05, 9);
    loop.frame(0);
    expect(loop.fpsAvg).toBeCloseTo((60 * 0.95 + 30 * 0.05) * 0.95 + 1000 * 0.05, 9);
  });
});

describe('seeds and replay (2a.15)', () => {
  it('launch n uses (20261112 + n*7919) | 0 from n = 0', () => {
    const { sim, loop } = makeLoop();
    const spy = vi.spyOn(sim, 'launch');
    expect([loop.launch(), loop.launch(), loop.fireAt(100, 100)]).toEqual([
      20261112,
      20261112 + 7919,
      20261112 + 2 * 7919,
    ]);
    expect(spy.mock.calls.map((c) => c[3])).toEqual([20261112, 20261112 + 7919, 20261112 + 15838]);
    expect(loop.launchCount).toBe(3);
  });

  it('launch fires the current shell at the default target', () => {
    const { sim, loop } = makeLoop();
    const spy = vi.spyOn(sim, 'launch');
    loop.launch();
    expect(spy).toHaveBeenCalledWith(loop.shell, 640, GROUND - 0.65 * GROUND, 20261112);
  });

  it('replay re-fires the snapshot with the same seed and does not advance n', () => {
    const { sim, loop } = makeLoop();
    expect(loop.replay()).toBe(false);
    loop.launch();
    loop.shell.breaks[0].color1 = 'blue';
    const spy = vi.spyOn(sim, 'launch');
    expect(loop.replay()).toBe(true);
    const [def, tx, ty, seed] = spy.mock.calls[0];
    expect(def.breaks[0].color1).toBe('red');
    expect([tx, ty, seed]).toEqual([640, GROUND - 0.65 * GROUND, 20261112]);
    expect(loop.launchCount).toBe(1);
    expect(loop.launch()).toBe(20261112 + 7919);
  });
});

describe('drivers (2a.16)', () => {
  it('PreviewLoopDriver fires only once the timer expired AND nothing is in flight', () => {
    const { sim, loop } = makeLoop({ driver: new PreviewLoopDriver() });
    const spy = vi.spyOn(sim, 'launch');
    loop.frame(16);
    expect(spy).toHaveBeenCalledTimes(1);
    const driver = loop.driver as PreviewLoopDriver;
    expect(driver.remaining).toBeCloseTo(sim.shellDuration(loop.shell), 9);

    // Timer expired while a shell is still rising: no fire.
    const held = makeLoop({ driver: new PreviewLoopDriver() });
    const heldSpy = vi.spyOn(held.sim, 'launch');
    held.loop.launch();
    heldSpy.mockClear();
    held.loop.frame(16);
    expect(heldSpy).not.toHaveBeenCalled();
  });

  it('PreviewLoopDriver re-fires after shellDuration, and a click resets its timer', () => {
    const { sim, loop } = makeLoop({ driver: new PreviewLoopDriver() });
    const spy = vi.spyOn(sim, 'launch');
    const dur = sim.shellDuration(loop.shell);
    let frames = 0;
    while (spy.mock.calls.length < 2 && frames < 2000) {
      loop.frame(1000 / 60);
      frames++;
    }
    expect(spy).toHaveBeenCalledTimes(2);
    expect(frames / 60).toBeGreaterThanOrEqual(dur - 0.05);

    loop.fireAt(300, 200);
    expect((loop.driver as PreviewLoopDriver).remaining).toBeCloseTo(dur, 9);
  });

  it('ManualDriver never fires on its own', () => {
    const { sim, loop } = makeLoop({ driver: new ManualDriver() });
    const spy = vi.spyOn(sim, 'launch');
    for (let f = 0; f < 600; f++) loop.frame(1000 / 60);
    expect(spy).not.toHaveBeenCalled();
  });

  it('RandomShowDriver: current shell 1 in 4, else a preset, x 15-85%, height 45-80%, every 0.35-1.75 s', () => {
    // Scripted draws. Fire 1: pick 0.1 (< 0.25: current shell, no preset draw), x, height,
    // interval. Fire 2: pick 0.9, preset index 0.95 (-> 9), x, height, interval.
    const draws = [0.1, 0, 0, 0, 0.9, 0.95, 0.999, 0.999, 0.999];
    let k = 0;
    const random = () => draws[k++];
    const { sim, loop } = makeLoop({ driver: new RandomShowDriver(random) });
    const spy = vi.spyOn(sim, 'launch');

    loop.frame(1);
    expect(spy.mock.calls[0][0]).toBe(loop.shell);
    expect(spy.mock.calls[0][1]).toBeCloseTo(1280 * 0.15, 9);
    expect(spy.mock.calls[0][2]).toBeCloseTo(GROUND - 0.45 * GROUND, 9);
    const driver = loop.driver as RandomShowDriver;
    expect(driver.remaining).toBeCloseTo(0.35, 9);

    driver.hold(0);
    loop.frame(1);
    expect(spy.mock.calls[1][0].name).toBe(PRESETS[9].name);
    expect(spy.mock.calls[1][1]).toBeCloseTo(1280 * (0.15 + 0.999 * 0.7), 9);
    expect(spy.mock.calls[1][2]).toBeCloseTo(GROUND - (0.45 + 0.999 * 0.35) * GROUND, 9);
    expect(driver.remaining).toBeCloseTo(0.35 + 0.999 * 1.4, 9);
  });

  it('RandomShowDriver with Reduce flashing waits 0.8-1.75 s, from the same draws', () => {
    for (const [draw, gap] of [
      [0, 0.8],
      [0.999, 0.8 + 0.999 * 0.95],
    ] as const) {
      const draws = [0.1, 0, 0, draw];
      let k = 0;
      const { loop } = makeLoop({ driver: new RandomShowDriver(() => draws[k++], true) });
      loop.frame(1);
      expect(k).toBe(4);
      expect((loop.driver as RandomShowDriver).remaining).toBeCloseTo(gap, 9);
    }
    const d = createDriver('show', () => 0, { reduceFlashing: true }) as RandomShowDriver;
    expect(d.reduceFlashing).toBe(true);
    expect((createDriver('show') as RandomShowDriver).reduceFlashing).toBe(false);
  });

  it('RandomShowDriver defaults to Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { loop } = makeLoop({ driver: new RandomShowDriver() });
    loop.frame(1);
    expect(spy).toHaveBeenCalled();
  });

  it('a new driver starts with its timer at 0, so switching mode fires immediately', () => {
    for (const mode of PLAYBACK_MODES) expect(createDriver(mode).mode).toBe(mode);
    const { sim, loop } = makeLoop({ driver: new ManualDriver() });
    const spy = vi.spyOn(sim, 'launch');
    loop.frame(16);
    loop.setDriver(createDriver('loop'));
    loop.frame(16);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('holdAutoFire waits one shellDuration (preset load)', () => {
    const { sim, loop } = makeLoop({ driver: new PreviewLoopDriver() });
    loop.holdAutoFire();
    const spy = vi.spyOn(sim, 'launch');
    loop.frame(16);
    expect(spy).not.toHaveBeenCalled();
    expect((loop.driver as PreviewLoopDriver).remaining).toBeCloseTo(
      sim.shellDuration(loop.shell) - 0.016,
      9,
    );
  });

  it('TimelineDriver is a stub that never fires', () => {
    const { sim, loop } = makeLoop({ driver: new TimelineDriver() });
    const spy = vi.spyOn(sim, 'launch');
    for (let f = 0; f < 60; f++) loop.frame(16);
    expect(spy).not.toHaveBeenCalled();
    expect(loop.driver.mode).toBe('timeline');
  });

  it('clear empties the sky but keeps the seed counter', () => {
    const { sim, loop } = makeLoop();
    loop.launch();
    for (let f = 0; f < 30; f++) loop.frame(16);
    loop.clear();
    expect([sim.particles.n, sim.shellCount]).toEqual([0, 0]);
    expect(loop.launch()).toBe(20261112 + 7919);
  });

  it('the shell the loop fires is whatever is current at fire time', () => {
    const { sim, loop } = makeLoop({ driver: new PreviewLoopDriver() });
    const spy = vi.spyOn(sim, 'launch');
    loop.shell = newShell('Edited', { breaks: [{ color1: 'purple' }] });
    loop.frame(16);
    expect(spy.mock.calls[0][0].name).toBe('Edited');
  });
});
