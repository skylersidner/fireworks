import { ApplicationRef, Component, signal, viewChildren } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ManualDriver, PreviewLoopDriver, RandomShowDriver } from '../../../engine/loop/drivers';
import type { PlaybackMode } from '../../../engine/model/enums';
import { PRESETS } from '../../../engine/model/presets';
import {
  newShell,
  type QualitySettings,
  type ShellDocument,
  type SkySettings,
} from '../../../engine/model/shell';
import { GROUND } from '../../../engine/sim/constants';
import { FakeStageRenderers } from '../../testing/fake-stage-renderer';
import { provideStepClock } from '../../testing/stage-clock';
import {
  FireworksStageComponent,
  STAGE_RENDERER_FACTORY,
  type StageStats,
} from './fireworks-stage';

/** Lets pending promise callbacks (the component's `await`) run. */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve));

@Component({
  imports: [FireworksStageComponent],
  template: `
    <app-fireworks-stage
      [shell]="shell()"
      [mode]="mode()"
      [sky]="sky()"
      [quality]="quality()"
      [paused]="paused()"
      (stats)="stats.push($event)"
    />
    @if (two()) {
      <app-fireworks-stage [shell]="shell()" mode="manual" />
    }
  `,
})
class HostComponent {
  readonly shell = signal<ShellDocument>(structuredClone(PRESETS[0]));
  readonly mode = signal<PlaybackMode>('manual');
  readonly sky = signal<SkySettings | undefined>(undefined);
  readonly quality = signal<QualitySettings>({
    persistence: 0.78,
    starBudget: 1,
    reduceFlashing: false,
  });
  readonly two = signal(false);
  readonly paused = signal(false);
  readonly stats: StageStats[] = [];
  readonly stages = viewChildren(FireworksStageComponent);
}

describe('FireworksStageComponent', () => {
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory }, provideStepClock()],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function mount() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const host = fixture.componentInstance;
    const stageEl = () =>
      (fixture.nativeElement as HTMLElement).querySelector('app-fireworks-stage') as HTMLElement;
    return { fixture, host, stage: () => host.stages()[0], stageEl };
  }

  async function mountRunning(...args: Parameters<FakeStageRenderers['starts'][0]['resolve']>) {
    const m = await mount();
    const renderer = fakes.starts[fakes.starts.length - 1].resolve(...args);
    await flushMicrotasks();
    await m.fixture.whenStable();
    return { ...m, renderer };
  }

  describe('lifecycle (2b.2)', () => {
    it('starts the renderer once after render, mounts its canvas and starts frames', async () => {
      const { fixture, stageEl } = await mount();
      expect(fakes.starts.length).toBe(1);
      expect(stageEl().getAttribute('data-status')).toBe('starting');

      const renderer = fakes.starts[0].resolve();
      await flushMicrotasks();
      await fixture.whenStable();

      expect(stageEl().querySelector('.stage-host')!.contains(renderer.canvas)).toBe(true);
      expect(stageEl().getAttribute('data-status')).toBe('running');
      expect(renderer.started).toBe(true);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fakes.starts.length).toBe(1);
    });

    it('passes its host element to the renderer factory', async () => {
      const { stageEl } = await mount();
      expect(fakes.starts[0].host).toBe(stageEl().querySelector('.stage-host'));
    });

    it('destroys the renderer exactly once on destroy, removing the canvas', async () => {
      const { fixture, renderer } = await mountRunning();
      fixture.destroy();
      expect(renderer.destroyCalls).toBe(1);
      expect(renderer.canvas.isConnected).toBe(false);
    });

    it('destroyed while init is pending: destroys the renderer when init resolves, never mounts it', async () => {
      const { fixture, stageEl } = await mount();
      const hostEl = stageEl().querySelector('.stage-host')!;
      fixture.destroy();
      const renderer = fakes.starts[0].resolve();
      await flushMicrotasks();
      expect(renderer.destroyCalls).toBe(1);
      expect(hostEl.contains(renderer.canvas)).toBe(false);
      expect(renderer.started).toBe(false);
    });

    it('destroyed before first render: never calls the factory', async () => {
      const fixture = TestBed.createComponent(HostComponent);
      fixture.destroy();
      await flushMicrotasks();
      expect(fakes.starts.length).toBe(0);
    });

    it('mount/destroy cycles leave no live renderers behind', async () => {
      for (let i = 0; i < 5; i++) {
        const fixture = TestBed.createComponent(HostComponent);
        await fixture.whenStable();
        fakes.starts[i].resolve();
        await flushMicrotasks();
        fixture.destroy();
      }
      expect(fakes.renderers.map((r) => r.destroyCalls)).toEqual([1, 1, 1, 1, 1]);
      expect(fakes.renderers.some((r) => r.canvas.isConnected)).toBe(false);
    });
  });

  describe('renderer honesty (2b.5, 2b.6)', () => {
    it.each([
      ['webgl', 'rgba16float'],
      ['webgpu', 'rgba16float'],
      ['canvas', 'rgba8unorm'],
    ] as const)('reports renderer %s and trail format %s on the host', async (name, format) => {
      const { stageEl } = await mountRunning(name, format);
      expect(stageEl().getAttribute('data-renderer')).toBe(name);
      expect(stageEl().getAttribute('data-trail-format')).toBe(format);
    });

    it('shows the fallback message, with no renderer claimed, when init rejects', async () => {
      const { fixture, stageEl } = await mount();
      fakes.starts[0].reject(new Error('No available renderer for the current environment'));
      await flushMicrotasks();
      await fixture.whenStable();
      expect(stageEl().getAttribute('data-status')).toBe('failed');
      expect(stageEl().hasAttribute('data-renderer')).toBe(false);
      expect(
        stageEl()
          .querySelector('[data-testid="stage-error"]')!
          .textContent!.trim()
          .replace(/\s+/g, ' '),
      ).toBe(
        "Fireworks can't start in this browser: No available renderer for the current environment. " +
          'The controls still work, and your shell is kept in this browser.',
      );
    });

    it('renders the error as text, never as HTML', async () => {
      const { fixture, stageEl } = await mount();
      fakes.starts[0].reject(new Error('<img src=x onerror=alert(1)>'));
      await flushMicrotasks();
      await fixture.whenStable();
      expect(stageEl().querySelector('img')).toBeNull();
    });
  });

  describe('instances and inputs (2b.1, 2b.3)', () => {
    it('two stages have independent sims: launching on one leaves the other unchanged', async () => {
      const { fixture, host } = await mount();
      host.two.set(true);
      await fixture.whenStable();
      expect(fakes.starts.length).toBe(2);
      const [a, b] = fakes.starts.map((s) => s.resolve());
      await flushMicrotasks();
      const [stageA, stageB] = host.stages();
      expect(stageA.sim).not.toBe(stageB.sim);

      stageA.launch();
      a.frame(16, 30);
      b.frame(16, 30);
      expect(stageA.sim.particles.n).toBeGreaterThan(0);
      expect(stageB.sim.particles.n).toBe(0);
      expect(stageB.loop.launchCount).toBe(0);
    });

    it('changing shell, mode, sky and quality never recreates the renderer', async () => {
      const { fixture, host, stage, renderer } = await mountRunning();
      const canvas = renderer.canvas;

      host.shell.set(newShell('Edited', { breaks: [{ color1: 'purple' }] }));
      host.mode.set('loop');
      host.sky.set({ gravity: 300, wind: 20 });
      host.quality.set({ persistence: 0.2, starBudget: 0.5, reduceFlashing: false });
      await fixture.whenStable();

      expect(fakes.starts.length).toBe(1);
      expect(renderer.destroyCalls).toBe(0);
      expect(stage().loop.shell.name).toBe('Edited');
      expect(stage().loop.driver).toBeInstanceOf(PreviewLoopDriver);
      expect(stage().sim.sky).toEqual({ gravity: 300, wind: 20 });
      expect(stage().sim.starBudget).toBe(0.5);
      renderer.frame(16);
      expect(renderer.lastPersistence).toBe(0.2);
      expect((fixture.nativeElement as HTMLElement).querySelector('canvas')).toBe(canvas);
    });

    it('mode maps to the matching driver; manual never fires on its own', async () => {
      const { fixture, host, stage, renderer } = await mountRunning();
      expect(stage().loop.driver).toBeInstanceOf(ManualDriver);
      renderer.frame(16, 120);
      expect(stage().loop.launchCount).toBe(0);
      host.mode.set('show');
      await fixture.whenStable();
      expect(stage().loop.driver).toBeInstanceOf(RandomShowDriver);
    });

    it('preview loop mode fires the current shell on the first frame', async () => {
      const { fixture, host, stage, renderer } = await mountRunning();
      host.mode.set('loop');
      await fixture.whenStable();
      renderer.frame(16);
      expect(stage().loop.launchCount).toBe(1);
    });

    it('without a sky input the shell’s own sky applies, else the default', async () => {
      const { fixture, host, stage } = await mountRunning();
      expect(stage().sim.sky).toEqual({ gravity: 160, wind: 0 });
      host.shell.set({ ...newShell('S'), sky: { gravity: 250, wind: -10 } });
      await fixture.whenStable();
      expect(stage().sim.sky).toEqual({ gravity: 250, wind: -10 });
    });

    it('Reduce flashing reaches the renderer and the running Auto show driver, without a restart', async () => {
      const { fixture, host, stage, renderer } = await mountRunning();
      host.mode.set('show');
      await fixture.whenStable();
      const driver = stage().loop.driver as RandomShowDriver;
      expect(driver.reduceFlashing).toBe(false);
      renderer.frame(16);
      expect(renderer.lastReduceFlashing).toBe(false);

      host.quality.set({ persistence: 0.78, starBudget: 1, reduceFlashing: true });
      await fixture.whenStable();
      expect(stage().loop.driver).toBe(driver);
      expect(driver.reduceFlashing).toBe(true);
      renderer.frame(16);
      expect(renderer.lastReduceFlashing).toBe(true);

      // A driver created while the flag is on starts with it.
      host.mode.set('manual');
      await fixture.whenStable();
      host.mode.set('show');
      await fixture.whenStable();
      expect((stage().loop.driver as RandomShowDriver).reduceFlashing).toBe(true);
    });

    it('Reduce flashing never reaches the sim: the same launches give bit-identical particles', async () => {
      const run = async (reduceFlashing: boolean) => {
        const { fixture, host, stage, renderer } = await mountRunning();
        host.quality.set({ persistence: 0.78, starBudget: 1, reduceFlashing });
        await fixture.whenStable();
        stage().fireNow(structuredClone(PRESETS[7])); // Strobe
        stage().launch();
        renderer.frame(1000 / 60, 300);
        const P = stage().sim.particles;
        const snapshot = {
          n: P.n,
          x: Array.from(P.x.subarray(0, P.n)),
          y: Array.from(P.y.subarray(0, P.n)),
          kind: Array.from(P.kind.subarray(0, P.n)),
          age: Array.from(P.age.subarray(0, P.n)),
        };
        fixture.destroy();
        return snapshot;
      };
      const off = await run(false);
      const on = await run(true);
      expect(off.n).toBeGreaterThan(0);
      expect(on).toEqual(off);
    });

    it('fireNow fires the given shell and sky immediately, then holds the loop', async () => {
      const { fixture, host, stage } = await mountRunning();
      host.mode.set('loop');
      await fixture.whenStable();
      const willow = structuredClone(PRESETS[2]);
      const launch = vi.spyOn(stage().sim, 'launch');
      stage().fireNow(willow, { gravity: 300, wind: 5 });
      expect(launch.mock.calls[0][0]).toBe(willow);
      expect(stage().sim.sky).toEqual({ gravity: 300, wind: 5 });
      expect((stage().loop.driver as PreviewLoopDriver).remaining).toBeCloseTo(
        stage().sim.shellDuration(willow),
        9,
      );
    });

    it('clamps quality and sky through normalize', async () => {
      const { fixture, host, stage } = await mountRunning();
      host.sky.set({ gravity: 9999, wind: 0 });
      host.quality.set({ persistence: 0.5, starBudget: 0, reduceFlashing: false });
      await fixture.whenStable();
      expect(stage().sim.sky.gravity).toBe(400);
      expect(stage().sim.starBudget).toBe(0.25);
    });
  });

  describe('stats throttle (2b.4)', () => {
    it('emits at most ~4 times per second of frames, however many frames run', async () => {
      const { host, renderer } = await mountRunning();
      renderer.frame(1000 / 60, 600);
      expect(host.stats.length).toBeLessThanOrEqual(51);
      expect(host.stats.length).toBeGreaterThanOrEqual(35);
    });

    it('carries particles, fps, last seed and renderer', async () => {
      const { host, stage, renderer } = await mountRunning('webgpu');
      expect(host.stats).toEqual([]);
      renderer.frame(1000 / 60, 20);
      expect(host.stats.at(-1)).toMatchObject({ seed: null, renderer: 'webgpu' });
      stage().launch();
      // Frame one at a time until the next emission, so it reflects the sim right now.
      host.stats.length = 0;
      let frames = 0;
      while (host.stats.length === 0 && frames < 30) {
        renderer.frame(1000 / 60);
        frames++;
      }
      expect(frames).toBeLessThanOrEqual(15);
      const last = host.stats.at(-1)!;
      expect(last.seed).toBe(20261112);
      expect(last.particles).toBe(stage().sim.particles.n);
      expect(last.fps).toBeGreaterThan(50);
    });

    it('frames write no signal: a stats-free stretch of frames schedules no change detection', async () => {
      const { fixture, renderer } = await mountRunning();
      const appRef = fixture.componentRef.injector.get(ApplicationRef);
      const tick = vi.spyOn(appRef, 'tick');
      renderer.frame(1000 / 60, 10); // 167 ms: below one stats interval
      await flushMicrotasks();
      expect(tick).not.toHaveBeenCalled();
    });
  });

  describe('launch, replay, clear and click (2b.7, 2b.8)', () => {
    it('launch advances the seed; replay repeats it without advancing; clear empties the sky', async () => {
      const { stage, renderer } = await mountRunning();
      expect(stage().replay()).toBe(false);
      expect(stage().launch()).toBe(20261112);
      expect(stage().launch()).toBe(20261112 + 7919);
      expect(stage().replay()).toBe(true);
      expect(stage().loop.launchCount).toBe(2);
      renderer.frame(16, 60);
      expect(stage().sim.particles.n).toBeGreaterThan(0);
      stage().clear();
      expect([stage().sim.particles.n, stage().sim.shellCount]).toEqual([0, 0]);
    });

    it('a click in the sky fires at screenToWorld’s point; near the ground it is ignored', async () => {
      const { stage, stageEl, renderer } = await mountRunning();
      const launch = vi.spyOn(stage().sim, 'launch');
      const hostEl = stageEl().querySelector('.stage-host')!;
      const click = () =>
        hostEl.dispatchEvent(
          new MouseEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true }),
        );

      renderer.nextWorldPoint = { x: 420, y: 250 };
      click();
      expect(launch).toHaveBeenCalledTimes(1);
      expect(launch.mock.calls[0].slice(1, 3)).toEqual([420, 250]);

      renderer.nextWorldPoint = { x: 420, y: GROUND - 60 };
      click();
      renderer.nextWorldPoint = { x: 420, y: GROUND - 60.5 };
      click();
      expect(launch).toHaveBeenCalledTimes(2);
    });

    it('paused: nothing fires (loop, Launch, Replay, click, fireNow) until unpaused', async () => {
      const { fixture, host, stage, stageEl, renderer } = await mountRunning();
      host.mode.set('loop');
      await fixture.whenStable();
      expect(stage().launch()).not.toBeNull();
      stage().clear();
      host.paused.set(true);
      await fixture.whenStable();
      const launch = vi.spyOn(stage().sim, 'launch');

      renderer.frame(16, 600); // ten seconds: several loop periods
      expect(stage().launch()).toBeNull();
      expect(stage().replay()).toBe(false);
      renderer.nextWorldPoint = { x: 420, y: 250 };
      stageEl()
        .querySelector('.stage-host')!
        .dispatchEvent(new MouseEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true }));
      const willow = structuredClone(PRESETS[2]);
      expect(stage().fireNow(willow, { gravity: 90, wind: 5 })).toBeNull();
      expect(launch).not.toHaveBeenCalled();
      // fireNow still makes the shell and sky current, so the loop fires them once unpaused.
      expect(stage().loop.shell).toBe(willow);
      expect(stage().sim.sky).toEqual({ gravity: 90, wind: 5 });

      host.paused.set(false);
      await fixture.whenStable();
      renderer.frame(16, 600);
      expect(launch).toHaveBeenCalled();
    });

    it('a click in loop mode restarts the loop timer', async () => {
      const { fixture, host, stage } = await mountRunning();
      host.mode.set('loop');
      await fixture.whenStable();
      const stageEl = (fixture.nativeElement as HTMLElement).querySelector('.stage-host')!;
      stageEl.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      const driver = stage().loop.driver as PreviewLoopDriver;
      expect(driver.remaining).toBeCloseTo(stage().sim.shellDuration(stage().loop.shell), 9);
    });
  });
});
