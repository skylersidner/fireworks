import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PRESETS } from '../../../../../engine/model/presets';
import type { QualitySettings, ShellDocument } from '../../../../../engine/model/shell';
import { FakeStageRenderers } from '../../../../testing/fake-stage-renderer';
import { FireworksStageComponent, STAGE_RENDERER_FACTORY } from './fireworks-stage';

/**
 * Reduce flashing is a render-only setting (Rosalina's 2c record): it may change how strobe,
 * flash and glitter are drawn, and the Auto show gap, but never the simulation. With the same
 * launches and frames, a stage with it on and a stage with it off hold the same particles.
 * Owner: Toad. Negative control (recorded in toad history, 2026-11-12): a stage that halves
 * `sim.starBudget` when Reduce flashing is on fails this spec.
 */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve));

@Component({
  imports: [FireworksStageComponent],
  template: `<app-fireworks-stage [shell]="shell()" mode="manual" [quality]="quality()" />`,
})
class HostComponent {
  readonly shell = signal<ShellDocument>(structuredClone(PRESETS[0]));
  readonly quality = signal<QualitySettings>({
    persistence: 0.78,
    starBudget: 1,
    reduceFlashing: false,
  });
  readonly stage = viewChild.required(FireworksStageComponent);
}

/** Integer state plus position sums and spread, every 30 frames. */
type Trace = number[][];

describe('Reduce flashing leaves the simulation unchanged', () => {
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory }],
    });
  });

  async function run(reduceFlashing: boolean): Promise<{ trace: Trace; flagSeen: boolean | null }> {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.quality.set({ persistence: 0.78, starBudget: 1, reduceFlashing });
    await fixture.whenStable();
    const renderer = fakes.starts[fakes.starts.length - 1].resolve();
    await flushMicrotasks();
    await fixture.whenStable();
    const stage = fixture.componentInstance.stage();
    const P = stage.sim.particles;
    const trace: Trace = [];
    // Every preset, one launch every 40 frames, with the effects Reduce flashing touches
    // (Strobe, flashes on every burst, Willow glitter, crackle) all in the window.
    for (let f = 0; f < 1200; f++) {
      if (f % 40 === 0 && f / 40 < PRESETS.length) {
        fixture.componentInstance.shell.set(structuredClone(PRESETS[f / 40]));
        await fixture.whenStable();
        stage.launch();
      }
      renderer.frame(1000 / 60);
      if (f % 30 === 0) {
        let sx = 0;
        let sy = 0;
        for (let i = 0; i < P.n; i++) {
          sx += P.x[i];
          sy += P.y[i];
        }
        trace.push([P.n, ...P.countByKind(), stage.sim.shellCount, sx, sy]);
      }
    }
    const flagSeen = renderer.lastReduceFlashing;
    fixture.destroy();
    return { trace, flagSeen };
  }

  it('same launches and frames give the same particles with it on and off', async () => {
    const off = await run(false);
    const on = await run(true);
    // Not vacuous: the setting reached the renderer, and the sky was busy.
    expect(off.flagSeen).toBe(false);
    expect(on.flagSeen).toBe(true);
    expect(Math.max(...off.trace.map((row) => row[0]))).toBeGreaterThan(5000);
    expect(on.trace).toEqual(off.trace);
  });
});
