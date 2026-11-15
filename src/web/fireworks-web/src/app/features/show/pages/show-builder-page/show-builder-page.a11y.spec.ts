import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../../app.routes';
import { K_FLASH } from '../../../../../engine/sim/kinds';
import { ParticleStore } from '../../../../../engine/sim/particle-store';
import { FlashSpacing } from '../../../../../engine/render/visual-rules';
import { ApiStatusService } from '../../../../core/api-status';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import { FLASH_NOTICE_KEY, REDUCE_FLASHING_KEY } from '../../../../core/device-preferences';
import {
  FireworksStageComponent,
  STAGE_RENDERER_FACTORY,
} from '../../../../shared/fireworks-stage/fireworks-stage';
import { ME_TEST_WINDOW, settleSession } from '../../../../testing/creation-fixtures';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { FakeStageRenderers } from '../../../../testing/fake-stage-renderer';
import { MemoryStorage } from '../../../../testing/memory-storage';
import {
  API_BANNER_DESIGNER,
  ApiBannerComponent,
} from '../../../designer/shared/api-banner/api-banner';
import { ShowBuilderStore } from './show-builder.store';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const LIST = '/api/me/creations?page=1&pageSize=24&kind=shell';
const BUILDER_BANNER =
  "Can't reach the server right now. You can keep building; your show is kept in this browser.";
const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();

/**
 * Phase 6 review fixes (phase-6.md §19.2): B1 the API banner, B2 Undo/Redo keep focus, B3 the
 * notice takes focus from body. Each was checked against a mutant (bowser history, 2026-11-14).
 */
describe('Show Builder review fixes (phase-6.md §19.2)', () => {
  let storage: MemoryStorage;
  let http: HttpTestingController;
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage = new MemoryStorage();
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: MATCH_MEDIA, useValue: new FakeMatchMedia().fn },
        { provide: BROWSER_STORAGE, useValue: storage },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      (document.activeElement as HTMLElement | null)?.blur?.();
      vi.restoreAllMocks();
      TestBed.resetTestingModule();
    }
  });

  async function open(me: Parameters<typeof settleSession>[1] = ME_TEST_WINDOW) {
    settleSession(http, me);
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl('/show');
    const stable = async () => {
      await tick();
      await harness.fixture.whenStable();
      await tick();
      await harness.fixture.whenStable();
    };
    await stable();
    http.match(LIST).forEach((r) => r.flush({ items: [], page: 1, pageSize: 24, totalCount: 0 }));
    await stable();
    if (fakes.starts.length) fakes.starts[0].resolve('webgl');
    await stable();
    const root = harness.fixture.nativeElement as HTMLElement;
    const byTest = <T extends HTMLElement = HTMLElement>(id: string) =>
      root.querySelector<T>(`[data-testid="${id}"]`);
    const stage = harness.fixture.debugElement.query(
      (d) => d.componentInstance instanceof FireworksStageComponent,
    )?.componentInstance as FireworksStageComponent | undefined;
    const store = () =>
      harness.fixture.debugElement
        .query((d) => d.providerTokens.includes(ShowBuilderStore))!
        .injector.get(ShowBuilderStore);
    return { root, byTest, stable, stage, store };
  }

  describe('B1: the API banner', () => {
    it('shows the builder copy after the panel banners when the probe fails, and goes on recovery', async () => {
      storage.setItem(FLASH_NOTICE_KEY, '1');
      const { byTest, stable } = await open();
      expect(byTest('api-banner')).toBeNull();
      TestBed.inject(ApiStatusService).check();
      http.expectOne('/health/live').flush('x', { status: 503, statusText: 'Down' });
      await stable();
      const banner = byTest('api-banner');
      expect(banner?.getAttribute('role')).toBe('status');
      expect(text(banner!.querySelector('p'))).toBe(BUILDER_BANNER);
      expect(byTest('api-retry')?.textContent?.trim()).toBe('Try again');
      // The §3.1 slot: inside the panel, before the save bar.
      expect(byTest('builder-panel')!.contains(banner)).toBe(true);
      expect(banner!.compareDocumentPosition(byTest('save-bar')!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );

      byTest('api-retry')!.click();
      await stable();
      expect(byTest('api-retry')?.textContent?.trim()).toBe('Checking…');
      http.expectOne('/health/live').flush('Healthy');
      // Try again also reloads the session (Skyler, 2026-11-14).
      http.expectOne('/api/me').flush(ME_TEST_WINDOW);
      await stable();
      http.match(LIST).forEach((r) => r.flush({ items: [], page: 1, pageSize: 24, totalCount: 0 }));
      await stable();
      expect(byTest('api-banner')).toBeNull();
    });

    // Skyler, 2026-11-14 (Phase 6 gate): a failed api/me with a healthy server explains the hidden
    // save bar, and Try again reloads the session so the save bar comes back.
    it('shows the builder copy when api/me fails with health fine; Try again brings the save bar back', async () => {
      storage.setItem(FLASH_NOTICE_KEY, '1');
      const { byTest, stable } = await open('error');
      TestBed.inject(ApiStatusService).check();
      http.expectOne('/health/live').flush('Healthy');
      await stable();
      expect(text(byTest('api-banner')!.querySelector('p'))).toBe(BUILDER_BANNER);
      expect(byTest('save-save')).toBeNull();

      byTest('api-retry')!.click();
      await stable();
      expect(byTest('api-retry')?.textContent?.trim()).toBe('Checking…');
      http.expectOne('/health/live').flush('Healthy');
      await stable();
      // Health is back but api/me is still in flight: still checking.
      expect(byTest('api-retry')?.textContent?.trim()).toBe('Checking…');
      http.expectOne('/api/me').flush(ME_TEST_WINDOW);
      await stable();
      http.match(LIST).forEach((r) => r.flush({ items: [], page: 1, pageSize: 24, totalCount: 0 }));
      await stable();
      expect(byTest('api-banner')).toBeNull();
      expect(byTest('save-save')).not.toBeNull();
    });

    it('the first check, before any failure, shows no banner', async () => {
      storage.setItem(FLASH_NOTICE_KEY, '1');
      const { byTest, stable } = await open();
      TestBed.inject(ApiStatusService).check();
      await stable();
      expect(byTest('api-banner')).toBeNull();
      http.expectOne('/health/live').flush('Healthy');
    });

    it("the designer's copy is the banner's default, unchanged", async () => {
      expect(API_BANNER_DESIGNER).toBe(
        "Can't reach the server right now. You can keep designing; your shell is kept in this browser.",
      );
      const fixture = TestBed.createComponent(ApiBannerComponent);
      await fixture.whenStable();
      expect(text(fixture.nativeElement.querySelector('p'))).toBe(API_BANNER_DESIGNER);
    });
  });

  describe('B2: Undo and Redo keep focus', () => {
    it('Undo emptying the history keeps focus, reads aria-disabled and ignores presses', async () => {
      storage.setItem(FLASH_NOTICE_KEY, '1');
      const { byTest, stable, stage, store } = await open();
      const undo = byTest<HTMLButtonElement>('undo')!;
      const redo = byTest<HTMLButtonElement>('redo')!;
      expect(undo.getAttribute('aria-disabled')).toBe('true');
      expect(redo.getAttribute('aria-disabled')).toBe('true');
      expect(undo.disabled || redo.disabled).toBe(false);

      stage!['onPointerDown'](new PointerEvent('pointerdown'));
      await stable();
      expect(store().show().cues).toHaveLength(1);
      expect(undo.hasAttribute('aria-disabled')).toBe(false);

      undo.focus();
      undo.click();
      await stable();
      expect(store().show().cues).toHaveLength(0);
      expect(undo.getAttribute('aria-disabled')).toBe('true');
      expect(undo.disabled).toBe(false);
      expect(document.activeElement).toBe(undo);
      expect(redo.hasAttribute('aria-disabled')).toBe(false);

      // A press while aria-disabled does nothing.
      const undoSpy = vi.spyOn(store(), 'undo');
      undo.click();
      await stable();
      expect(undoSpy).not.toHaveBeenCalled();

      redo.focus();
      redo.click();
      await stable();
      expect(store().show().cues).toHaveLength(1);
      expect(redo.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(redo);
      const redoSpy = vi.spyOn(store(), 'redo');
      redo.click();
      await stable();
      expect(redoSpy).not.toHaveBeenCalled();
      expect(store().show().cues).toHaveLength(1);
    });
  });

  describe('B3: the notice takes focus from body', () => {
    it('focus on body moves to Turn on Reduce flashing (notice off copy)', async () => {
      const { byTest } = await open();
      expect(byTest('flash-notice')).not.toBeNull();
      expect(document.activeElement).toBe(byTest('flash-turn-on'));
    });

    it('with Reduce flashing on, to Continue (its only button)', async () => {
      storage.setItem(REDUCE_FLASHING_KEY, 'on');
      const { byTest } = await open();
      expect(byTest('flash-turn-on')).toBeNull();
      expect(document.activeElement).toBe(byTest('flash-continue'));
    });

    it('does not take focus from an element that has it', async () => {
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      try {
        const { byTest } = await open();
        expect(byTest('flash-notice')).not.toBeNull();
        expect(document.activeElement).toBe(outside);
      } finally {
        outside.remove();
      }
    });
  });
});

describe('Reduce flashing flash spacing: 41 steps (phase-6.md §14.2)', () => {
  it('flash starts at steps 0, 40, 80 and 120 draw at most three', () => {
    const gate = new FlashSpacing();
    const drawn = new Set<number>();
    // Render every step, each flash living 0.16 s, so each start is decided as it appears.
    for (let step = 0; step <= 140; step++) {
      const P = new ParticleStore(8);
      for (const s of [0, 40, 80, 120]) {
        if (s <= step && step - s < 0.16 * 120)
          P.spawn(K_FLASH, 0, 0, 0, 0, 1, { age: (step - s) / 120 });
      }
      const simTime = step / 120;
      gate.update(P, simTime);
      for (let i = 0; i < P.n; i++) {
        if (gate.drawn(P, i, simTime)) drawn.add(Math.round((simTime - P.age[i]) * 120));
      }
    }
    expect(drawn.size).toBeLessThanOrEqual(3);
    expect([...drawn].sort((a, b) => a - b)).toEqual([0, 80]);
  });
});
