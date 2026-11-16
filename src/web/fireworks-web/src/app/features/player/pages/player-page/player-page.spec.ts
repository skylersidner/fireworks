import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../../app.routes';
import { PRESETS } from '../../../../../engine/model/presets';
import { BROWSER_STORAGE, MATCH_MEDIA, REDUCED_MOTION_QUERY } from '../../../../core/browser';
import {
  FLASH_NOTICE_KEY,
  MOTION_BLUR_KEY,
  REDUCE_FLASHING_KEY,
} from '../../../../core/device-preferences';
import type { MeResponse } from '../../../../core/models';
import {
  FireworksStageComponent,
  STAGE_RENDERER_FACTORY,
} from '../../../../shared/fireworks-stage/fireworks-stage';
import {
  CODE_A,
  CODE_C,
  ME_READ_ONLY,
  ME_SIGNED_IN,
  ME_TEST_WINDOW,
  creationResponse,
  recorder,
  settleSession,
} from '../../../../testing/creation-fixtures';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { FakeStageRenderers } from '../../../../testing/fake-stage-renderer';
import { provideStepClock } from '../../../../testing/stage-clock';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { DRAFT_KEY, editableFrom, serializeDraft } from '../../../designer/shared/designer-draft';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The player at `/s/:code` (plan Phase 5; phase-5.md §8, §9; acceptance 5f; Boo C1, C3, C5, C10,
 * C12, C17, C19).
 */
describe('Player /s/:code', () => {
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
        provideStepClock(),
        { provide: MATCH_MEDIA, useValue: media.fn },
        { provide: BROWSER_STORAGE, useValue: storage },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // A leftover request fails this test only: mocks and the module are reset regardless (Toad F3).
    try {
      http.verify();
    } finally {
      vi.restoreAllMocks();
      TestBed.resetTestingModule();
    }
  });

  async function play(
    response: object | null = creationResponse(),
    opts: { url?: string; me?: MeResponse; status?: number } = {},
  ) {
    settleSession(http, opts.me ?? ME_TEST_WINDOW);
    ledger.length = 0;
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(opts.url ?? `/s/${CODE_A}`);
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
    if (response !== undefined && (opts.url === undefined || opts.url.startsWith(`/s/${CODE_A}`))) {
      const req = http.expectOne(`/api/creations/${CODE_A}`);
      if (opts.status === 0) req.error(new ProgressEvent('error'), { status: 0, statusText: '' });
      else req.flush(response, { status: opts.status ?? 200, statusText: 'x' });
    }
    await stable();
    const fake = fakes.starts.length ? fakes.starts[0].resolve('webgl') : null;
    await stable();
    const stageDebug = harness.fixture.debugElement.query(
      (d) => d.componentInstance instanceof FireworksStageComponent,
    );
    const stage = stageDebug?.componentInstance as FireworksStageComponent | undefined;
    return { harness, root, byTest, stable, fake, stage };
  }

  describe('flashing safety before the first burst (§8.3; Boo C19; 5f.3)', () => {
    it('the notice holds playback: no launch until Play, then the loop fires', async () => {
      const { byTest, fake, stage, stable } = await play();
      expect(byTest('flash-notice')).not.toBeNull();
      fake!.frame(16, 300);
      expect(stage!.loop.launchCount).toBe(0);
      expect(byTest<HTMLButtonElement>('player-pause')!.disabled).toBe(true);
      expect(byTest<HTMLButtonElement>('player-replay')!.disabled).toBe(true);
      byTest('flash-play')!.click();
      await stable();
      expect(storage.getItem(FLASH_NOTICE_KEY)).toBe('1');
      expect(document.activeElement).toBe(byTest('player-pause'));
      fake!.frame(16, 2);
      expect(stage!.loop.launchCount).toBe(1);
    });

    it('copy: the strobe sentence follows the shell; Play replaces Continue', async () => {
      const strobe = editableFrom(
        PRESETS.find((p) => p.breaks.some((b) => b.effect === 'strobe'))!,
      );
      const { byTest } = await play(creationResponse({ document: strobe }));
      expect(byTest('flash-notice-text')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        `Flashing lights. “${strobe.name}” starts when you close this notice. It has bright bursts and strobe effects. If flashing affects you, turn on Reduce flashing first. You can pause at any time.`,
      );
      expect(byTest('flash-turn-on')?.textContent?.trim()).toBe('Turn on Reduce flashing');
      expect(byTest('flash-play')?.textContent?.trim()).toBe('Play');
    });

    it('a shell without strobe says its bursts flash brightly', async () => {
      const plain = editableFrom(PRESETS[0]);
      expect(plain.breaks.some((b) => b.effect === 'strobe')).toBe(false);
      const { byTest } = await play(creationResponse({ document: plain }));
      expect(byTest('flash-notice-text')?.textContent).toContain('Its bursts flash brightly.');
    });

    it('Turn on Reduce flashing is a device-wide choice; the draft is byte-identical (5f.7)', async () => {
      storage.setItem(
        DRAFT_KEY,
        serializeDraft({
          shell: editableFrom(PRESETS[1]),
          activeBreak: 0,
          display: { mode: 'loop', persistence: 0.78, starBudget: 1, reduceFlashing: null },
          shellDirty: true,
          skyDirty: false,
          saved: false,
          source: null,
        }),
      );
      const before = storage.getItem(DRAFT_KEY);
      const { byTest, fake, stable } = await play();
      byTest('flash-turn-on')!.click();
      await stable();
      expect(storage.getItem(REDUCE_FLASHING_KEY)).toBe('on');
      fake!.frame(16, 2);
      expect(fake!.lastReduceFlashing).toBe(true);
      expect(byTest('player-reduce-flashing-value')?.textContent?.trim()).toBe('On');
      await tick(400);
      expect(storage.getItem(DRAFT_KEY)).toBe(before);
    });

    it('a notice dismissed on this device (designer or player) does not show again', async () => {
      storage.setItem(FLASH_NOTICE_KEY, '1');
      const { byTest, fake, stage } = await play();
      expect(byTest('flash-notice')).toBeNull();
      fake!.frame(16, 2);
      expect(stage!.loop.launchCount).toBe(1);
    });

    it('with Reduce flashing on, the notice says so and offers only Play', async () => {
      storage.setItem(REDUCE_FLASHING_KEY, 'on');
      const { byTest } = await play();
      expect(byTest('flash-notice-text')?.textContent).toContain(
        'Reduce flashing is on, so strobe is off and burst flashes are dimmed.',
      );
      expect(byTest('flash-turn-on')).toBeNull();
    });

    it('under reduced motion it opens paused with a centered Play, even after the notice', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      storage.setItem(FLASH_NOTICE_KEY, '1');
      const { byTest, fake, stage, stable } = await play();
      expect(byTest('flash-notice')).toBeNull();
      expect(byTest('player-center-play')?.textContent?.trim()).toBe('Play');
      expect(byTest('player')?.textContent).toContain(
        'Reduce flashing is on. Press Play to start.',
      );
      fake!.frame(16, 300);
      expect(stage!.loop.launchCount).toBe(0);
      byTest('player-center-play')!.click();
      await stable();
      fake!.frame(16, 2);
      expect(stage!.loop.launchCount).toBe(1);
      expect(fake!.lastReduceFlashing).toBe(true);
    });

    it('under reduced motion the centered line follows Reduce flashing (S1, §8.2)', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      storage.setItem(FLASH_NOTICE_KEY, '1');
      storage.setItem(REDUCE_FLASHING_KEY, 'off');
      const { byTest, stable } = await play();
      expect(byTest('player-center-line')?.textContent?.trim()).toBe('Press Play to start.');
      byTest('player-reduce-flashing')!.click();
      await stable();
      expect(byTest('player-center-line')?.textContent?.trim()).toBe(
        'Reduce flashing is on. Press Play to start.',
      );
    });

    it('under reduced motion with no stored choice, the line says Reduce flashing is on', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      storage.setItem(FLASH_NOTICE_KEY, '1');
      const { byTest } = await play();
      expect(byTest('player-center-line')?.textContent?.trim()).toBe(
        'Reduce flashing is on. Press Play to start.',
      );
    });

    it('under reduced motion the notice Play is the explicit start', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { byTest, fake, stage, stable } = await play();
      fake!.frame(16, 100);
      expect(stage!.loop.launchCount).toBe(0);
      byTest('flash-play')!.click();
      await stable();
      expect(byTest('player-center-play')).toBeNull();
      fake!.frame(16, 2);
      expect(stage!.loop.launchCount).toBe(1);
    });
  });

  describe('Motion blur is the device preference (Skyler, 2026-11-14)', () => {
    it('renders with the default when this device has none', async () => {
      storage.setItem(FLASH_NOTICE_KEY, '1');
      const { fake } = await play();
      fake!.frame(16, 2);
      expect(fake!.lastPersistence).toBe(0.78);
    });

    it('renders with the stored value, and never writes it', async () => {
      storage.setItem(FLASH_NOTICE_KEY, '1');
      storage.setItem(MOTION_BLUR_KEY, '0.3');
      const { fake } = await play();
      fake!.frame(16, 2);
      expect(fake!.lastPersistence).toBe(0.3);
      expect(storage.getItem(MOTION_BLUR_KEY)).toBe('0.3');
    });
  });

  describe('controls (§8.1, §8.2)', () => {
    beforeEach(() => storage.setItem(FLASH_NOTICE_KEY, '1'));

    it('Pause freezes the loop; Play resumes; Space toggles off a control', async () => {
      const { byTest, fake, stage, stable } = await play();
      fake!.frame(16, 2);
      expect(stage!.loop.launchCount).toBe(1);
      byTest('player-pause')!.click();
      await stable();
      expect(byTest('player-pause')?.textContent?.trim()).toBe('Play');
      expect(byTest<HTMLButtonElement>('player-replay')!.disabled).toBe(true);
      const particles = stage!.sim.particles.n;
      fake!.frame(16, 600);
      expect(stage!.loop.launchCount).toBe(1);
      expect(stage!.sim.particles.n).toBe(particles);
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
      );
      await stable();
      expect(byTest('player-pause')?.textContent?.trim()).toBe('Pause');
    });

    it('Replay fires the shell again now', async () => {
      const { byTest, fake, stage } = await play();
      fake!.frame(16, 2);
      byTest('player-replay')!.click();
      expect(stage!.loop.launchCount).toBe(2);
    });

    it('a click in the sky fires nothing (a viewer, not a sandbox)', async () => {
      const { root, fake, stage } = await play();
      fake!.nextWorldPoint = { x: 400, y: 200 };
      root
        .querySelector('.stage-host')!
        .dispatchEvent(
          new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }),
        );
      expect(stage!.loop.launchCount).toBe(0);
    });
  });

  describe('overlay and Remix (5f.4–5f.6; Boo C1, C3, C10)', () => {
    beforeEach(() => storage.setItem(FLASH_NOTICE_KEY, '1'));

    it('the name is the normalized document name, as text in a bdi; the title has no quotes', async () => {
      const doc = { ...editableFrom(PRESETS[2]), name: '<img src=x onerror=alert(1)>' };
      const { byTest, root } = await play(
        creationResponse({ name: 'envelope name', document: doc }),
      );
      const h1 = byTest('player-name')!;
      expect(h1.querySelector('bdi')?.textContent).toBe('<img src=x onerror=alert(1)>');
      expect(root.querySelector('img')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe(
        '\u2068<img src=x onerror=alert(1)>\u2069 · Fireworks Sandbox',
      );
    });

    it('remixedFrom is never rendered', async () => {
      const { root } = await play(creationResponse({ remixedFrom: CODE_C }));
      expect(root.textContent).not.toContain(CODE_C);
      expect(root.innerHTML).not.toContain(CODE_C);
    });

    it.each([
      ['writes on', ME_TEST_WINDOW],
      ['writes off', ME_READ_ONLY],
    ])('%s: Remix shows, writes nothing, and opens /c/{code} (one GET)', async (_n, me) => {
      const { byTest, stable, root } = await play(creationResponse(), { me });
      expect(root.textContent).not.toMatch(/\bSave\b/);
      byTest('player-remix')!.click();
      await stable();
      expect(TestBed.inject(Router).url).toBe(`/c/${CODE_A}`);
      http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse());
      await stable();
      expect(TestBed.inject(Router).url).toBe('/');
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`, `GET /api/creations/${CODE_A}`]);
    });

    it.each([
      ['writes on, not signed in', ME_TEST_WINDOW, true],
      ['writes off', ME_READ_ONLY, false],
      ['signed in', ME_SIGNED_IN, false],
    ])('test-mode banner, %s → %s (Boo C17)', async (_n, me, shown) => {
      const { byTest } = await play(creationResponse(), { me });
      expect(!!byTest('test-mode-banner')).toBe(shown);
    });
  });

  describe('not found and failures (5f.8, 5f.9, 5f.11; Boo C5, C12)', () => {
    it('a bad-format code: the not-found page, no request, no stage', async () => {
      const { byTest } = await play(null, { url: '/s/abcdefg0' });
      expect(ledger).toEqual([]);
      expect(byTest('message-heading')?.textContent?.trim()).toBe('Nothing plays at this link');
      expect(byTest('message-home')?.textContent?.trim()).toBe('Make your own');
      expect(byTest('message-page')?.textContent).not.toContain("hasn't changed");
      expect(fakes.starts).toHaveLength(0);
      expect(TestBed.inject(Title).getTitle()).toBe('Link not found · Fireworks Sandbox');
    });

    it('a 404 renders the same page as a bad code, after one GET', async () => {
      const { byTest } = await play({ message: 'Creation not found.' }, { status: 404 });
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`]);
      expect(byTest('message-heading')?.textContent?.trim()).toBe('Nothing plays at this link');
      expect(fakes.starts).toHaveLength(0);
    });

    it('version 2: the newer-version copy and nothing plays', async () => {
      const { byTest } = await play(
        creationResponse({ document: { ...editableFrom(PRESETS[2]), version: 2 } }),
      );
      expect(byTest('message-heading')?.textContent?.trim()).toBe(
        'This creation needs a newer version of the app.',
      );
      expect(fakes.starts).toHaveLength(0);
    });

    it("a show whose document fails normalizeShow: the can't-be-played copy (Phase 6)", async () => {
      const show = await play(creationResponse({ kind: 'show' }));
      expect(show.byTest('message-heading')?.textContent?.trim()).toBe(
        "This creation can't be played.",
      );
    });

    it('kind "Shell" is not a shell', async () => {
      const { byTest } = await play(creationResponse({ kind: 'Shell' as never }));
      expect(byTest('message-heading')?.textContent?.trim()).toBe('Nothing plays at this link');
      expect(fakes.starts).toHaveLength(0);
    });

    it('stars: 9999 reaches the engine as 400, with one warning', async () => {
      storage.setItem(FLASH_NOTICE_KEY, '1');
      const doc = editableFrom(PRESETS[2]);
      doc.breaks[0].stars = 9999;
      const { stage } = await play(creationResponse({ document: doc }));
      expect(stage!.shell().breaks[0].stars).toBe(400);
      expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it('status 0: can\'t reach the server, never "doesn\'t exist"; Try again refetches', async () => {
      const { byTest, stable } = await play(null, { status: 0 });
      expect(byTest('message-heading')?.textContent?.trim()).toBe("Can't reach the server.");
      byTest('message-retry')!.click();
      await stable();
      http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse());
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`, `GET /api/creations/${CODE_A}`]);
    });
  });
});
