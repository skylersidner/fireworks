import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../../app.routes';
import { EngineLoop } from '../../../../../engine/loop/engine-loop';
import { TimelineDriver } from '../../../../../engine/loop/timeline-driver';
import { ClientConfigStore, DEFAULT_PLAYBACK } from '../../../../core/client-config';
import type { ShowDocument } from '../../../../../engine/model/show';
import { estimateShowEnd } from '../../../../../engine/sim/lifetime';
import { FireworksSim } from '../../../../../engine/sim/simulation';
import { BROWSER_STORAGE, MATCH_MEDIA, REDUCED_MOTION_QUERY } from '../../../../core/browser';
import { FLASH_NOTICE_KEY } from '../../../../core/device-preferences';
import {
  FireworksStageComponent,
  STAGE_RENDERER_FACTORY,
} from '../../../../shared/fireworks-stage/fireworks-stage';
import {
  CODE_A,
  ME_READ_ONLY,
  ME_TEST_WINDOW,
  creationResponse,
  recorder,
  settleSession,
} from '../../../../testing/creation-fixtures';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { FakeStageRenderers } from '../../../../testing/fake-stage-renderer';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { doneWhenShow } from '../../../../testing/show-fixtures';
import { DRAFT_KEY } from '../../../designer/shared/designer-draft';
import { SHOW_DRAFT_KEY } from '../../../show/shared/show-draft';
import { showLengthText } from './player-page';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function shortShow(): ShowDocument {
  const show = doneWhenShow();
  show.name = '<b>x</b>';
  show.duration = 2;
  show.cues = show.cues.slice(0, 6).map((c, i) => ({ ...c, t: [0, 0.3, 0.3, 1, 1.5, 2][i] }));
  return show;
}

/** The show player at `/s/:code` (plan Phase 6; phase-6.md §11; acceptance 6h, 6a.7, 6f.10). */
describe('Player /s/:code with a show', () => {
  let storage: MemoryStorage;
  let media: FakeMatchMedia;
  let http: HttpTestingController;
  let ledger: string[];
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage = new MemoryStorage();
    media = new FakeMatchMedia();
    ledger = [];
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([recorder(ledger)])),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: MATCH_MEDIA, useValue: media.fn },
        { provide: BROWSER_STORAGE, useValue: storage },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      vi.restoreAllMocks();
      TestBed.resetTestingModule();
    }
  });

  async function play(show: ShowDocument = shortShow(), me = ME_TEST_WINDOW) {
    settleSession(http, me);
    ledger.length = 0;
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(`/s/${CODE_A}`);
    await tick();
    await harness.fixture.whenStable();
    const root = harness.fixture.nativeElement as HTMLElement;
    const byTest = <T extends HTMLElement = HTMLElement>(id: string) =>
      root.querySelector<T>(`[data-testid="${id}"]`);
    const stable = async () => {
      await tick();
      await harness.fixture.whenStable();
      await tick();
      await harness.fixture.whenStable();
    };
    http
      .expectOne(`/api/creations/${CODE_A}`)
      .flush(creationResponse({ kind: 'show', document: show, name: show.name }));
    await stable();
    const fake = fakes.starts[0].resolve('webgl');
    await stable();
    const stage = harness.fixture.debugElement.query(
      (d) => d.componentInstance instanceof FireworksStageComponent,
    ).componentInstance as FireworksStageComponent;
    return { harness, root, byTest, stable, fake, stage };
  }

  function offlineLedger(show: ShowDocument) {
    const driver = new TimelineDriver(show);
    driver.runToEnd(
      new EngineLoop(new FireworksSim(), undefined, { worldWidth: () => 1280, driver }),
    );
    return { ledger: driver.ledger, end: driver.endStep };
  }

  it('the player driver takes the configured checkpoint settings (api/client-config)', async () => {
    TestBed.inject(ClientConfigStore).setPlayback({
      ...DEFAULT_PLAYBACK,
      checkpointIntervalSeconds: 30,
      checkpointMemoryMiB: 256,
    });
    const { stage } = await play();
    const driver = stage.loop.driver as TimelineDriver;
    expect([driver['cpSteps'], driver['cpBytesMax']]).toEqual([3600, 256 * 1024 * 1024]);
  });

  it('a config that lands mid-play does not replace the playing driver (read untracked; Toad)', async () => {
    const { stage, stable } = await play();
    const driver = stage.loop.driver as TimelineDriver;
    expect(driver).toBeInstanceOf(TimelineDriver);
    TestBed.inject(ClientConfigStore).setPlayback({
      ...DEFAULT_PLAYBACK,
      checkpointIntervalSeconds: 30,
      checkpointMemoryMiB: 256,
    });
    await stable();
    expect(stage.loop.driver).toBe(driver);
    expect([driver['cpSteps'], driver['cpBytesMax']]).toEqual([1200, 64 * 1024 * 1024]);
  });

  it('plays with TimelineDriver at starBudget 1; one GET; no draft written (6h.1)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const { stage, fake, stable, byTest } = await play();
    expect(ledger).toEqual([`GET /api/creations/${CODE_A}`]);
    expect(stage.sim.starBudget).toBe(1);
    expect(stage.loop.driver).toBeInstanceOf(TimelineDriver);
    fake.frame(16, 10);
    await stable();
    expect((stage.loop.driver as TimelineDriver).step).toBeGreaterThan(0);
    expect(storage.getItem(DRAFT_KEY)).toBeNull();
    expect(storage.getItem(SHOW_DRAFT_KEY)).toBeNull();
    expect(byTest('player-name')!.textContent!.trim()).toBe('<b>x</b>');
    expect(byTest('player-name')!.querySelector('b')).toBeNull();
    expect(byTest('player-remix')!.getAttribute('title')).toBe(
      'Open a copy in the Show Builder to change and play',
    );
  });

  it('the notice holds step 0 and names the length and strobe; Play starts with no backlog (6h.2)', async () => {
    const { stage, fake, byTest, stable } = await play();
    fake.frame(16, 200);
    const driver = stage.loop.driver as TimelineDriver;
    expect([driver.step, driver.ledger.length]).toEqual([0, 0]);
    const length = showLengthText(estimateShowEnd(shortShow()));
    expect(byTest('flash-notice-text')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      `Flashing lights. “<b>x</b>” starts when you close this notice and runs about ${length}. It has bright bursts and strobe effects. If flashing affects you, turn on Reduce flashing first. You can pause at any time.`,
    );
    byTest('flash-play')!.click();
    await stable();
    fake.frame(16);
    expect(driver.ledger[0]).toEqual(expect.objectContaining({ step: 0, id: 'c1' }));
    expect(driver.ledger).toHaveLength(1);
  });

  // Toad, Phase 6 review-fix (Peach 6h.2; p6-spec §11.3): only a shell a cue uses can strobe.
  it('an embedded strobe shell that no cue uses is not named (6h.2)', async () => {
    const unused = shortShow();
    unused.cues = unused.cues.map((c) => (c.shell === 's4' ? { ...c, shell: 's3' } : c));
    expect(unused.shells['s4'].breaks.some((b) => b.effect === 'strobe')).toBe(true);
    const strobeShells = Object.entries(unused.shells)
      .filter(([, s]) => s.breaks.some((b) => b.effect === 'strobe'))
      .map(([k]) => k);
    expect(strobeShells).toEqual(['s4']);
    expect(unused.cues.some((c) => c.shell === 's4')).toBe(false);
    const { byTest } = await play(unused);
    const quiet = byTest('flash-notice-text')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(quiet).toContain('Its bursts flash brightly.');
    expect(quiet).not.toMatch(/strobe/i);
  });

  it('positive control: the same show with one cue on the strobe shell names strobe (6h.2)', async () => {
    const used = shortShow();
    used.cues = used.cues.map((c, i) =>
      c.shell === 's4' ? { ...c, shell: 's3' } : i === 0 ? { ...c, shell: 's4' } : c,
    );
    expect(used.cues.filter((c) => c.shell === 's4').map((c) => c.id)).toEqual(['c1']);
    const { byTest } = await play(used);
    expect(byTest('flash-notice-text')!.textContent!.replace(/\s+/g, ' ').trim()).toContain(
      'It has bright bursts and strobe effects.',
    );
  });

  it('a sky click and Space fire nothing; Space pauses (6a.7)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const { stage, fake, stable, byTest, root } = await play();
    const driver = stage.loop.driver as TimelineDriver;
    stage['onPointerDown'](new PointerEvent('pointerdown'));
    fake.frame(16, 5);
    const before = driver.ledger;
    root.ownerDocument.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
    );
    await stable();
    expect(byTest('player-pause')!.textContent!.trim()).toBe('Play');
    fake.frame(16, 5);
    expect(driver.ledger).toEqual(before);
    expect(stage.loop.launchCount).toBe(0);
  });

  it('ends at E with the ended state; Replay reproduces the same ledger (6h.4)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const oracle = offlineLedger(shortShow());
    const { stage, fake, stable, byTest } = await play();
    const driver = stage.loop.driver as TimelineDriver;
    for (let i = 0; i < 5000 && !driver.done; i++) fake.frame(1000 / 60);
    await stable();
    expect(driver.endStep).toBe(oracle.end);
    expect(driver.ledger).toEqual(oracle.ledger);
    expect(byTest('player-ended')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Replay “<b>x</b>” has ended.',
    );
    expect(byTest('player-announcer')!.textContent!.trim()).toBe('The show has ended.');
    expect(byTest('player-pause')!.textContent!.trim()).toBe('Play');
    byTest('player-ended-replay')!.click();
    await stable();
    for (let i = 0; i < 5000 && !(driver.done && driver.step > 10); i++) fake.frame(1000 / 60);
    expect(driver.ledger).toEqual(oracle.ledger);
    expect(driver.endStep).toBe(oracle.end);
  });

  // Toad, Phase 6 review: the 6h.4 test above passes with a Replay that never seeks (the driver
  // stays done, so its loop exits at once and the old ledger still equals the oracle).
  it('Replay really starts again from step 0: the sky empties, the clock restarts, and it ends again (6h.4)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const show = shortShow();
    const oracle = offlineLedger(show);
    const { stage, fake, stable, byTest } = await play(show);
    const driver = stage.loop.driver as TimelineDriver;
    for (let i = 0; i < 5000 && !driver.done; i++) fake.frame(1000 / 60);
    await stable();
    expect(byTest('player-ended')).not.toBeNull();
    // Ended: frames do nothing and the stage is empty (nothing stops at `duration`).
    // The frame that reaches the end finishes its own fixed steps (at most one frame past E).
    const endedAt = driver.step;
    expect(endedAt - oracle.end!).toBeLessThanOrEqual(2);
    fake.frame(1000 / 60, 30);
    expect([driver.step, stage.sim.particles.n, stage.sim.shellCount]).toEqual([endedAt, 0, 0]);

    byTest('player-ended-replay')!.click();
    await stable();
    expect(byTest('player-ended')).toBeNull();
    expect(byTest('player-pause')!.textContent!.trim()).toBe('Pause');
    fake.frame(1000 / 60);
    expect(driver.done).toBe(false);
    expect(driver.step).toBeLessThan(10);
    expect(driver.ledger).toEqual(oracle.ledger.filter((r) => r.step < driver.step));
    expect(stage.loop.launchCount).toBe(0);
    for (let i = 0; i < 5000 && !driver.done; i++) fake.frame(1000 / 60);
    await stable();
    expect([driver.endStep, driver.ledger]).toEqual([oracle.end, oracle.ledger]);
    expect(byTest('player-ended')).not.toBeNull();
    expect(byTest('player-announcer')!.textContent!.trim()).toBe('The show has ended.');
    // It never loops: more frames leave it ended.
    const again = driver.step;
    fake.frame(1000 / 60, 120);
    expect(driver.step).toBe(again);
  });

  it('reduced motion: opens paused at step 0 with the centered Play (6h.3)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    media.set(REDUCED_MOTION_QUERY, true);
    const { stage, fake, byTest } = await play();
    fake.frame(16, 50);
    expect((stage.loop.driver as TimelineDriver).step).toBe(0);
    expect(byTest('player-center-play')).not.toBeNull();
  });

  it('Remix goes to /c/{code} with no write, writes off too (6f.10)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const { byTest, stable } = await play(shortShow(), ME_READ_ONLY);
    byTest('player-remix')!.click();
    await stable();
    http
      .expectOne(`/api/creations/${CODE_A}`)
      .flush(creationResponse({ kind: 'show', document: shortShow() }));
    await stable();
    expect(ledger).toEqual([`GET /api/creations/${CODE_A}`, `GET /api/creations/${CODE_A}`]);
    expect(TestBed.inject(Router).url).toBe('/show');
  });

  it('length copy: seconds under a minute, whole minutes after', () => {
    expect(showLengthText(41.2)).toBe('41 seconds');
    expect(showLengthText(66)).toBe('1 minute');
    expect(showLengthText(150)).toBe('3 minutes');
  });
});
