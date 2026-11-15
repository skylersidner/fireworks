import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../../app.routes';
import { PRESETS } from '../../../../../engine/model/presets';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import { FLASH_NOTICE_KEY } from '../../../../core/device-preferences';
import { NotificationService } from '../../../../core/notifications';
import { STAGE_RENDERER_FACTORY } from '../../../../shared/fireworks-stage/fireworks-stage';
import {
  CODE_A,
  CODE_B,
  ME_READ_ONLY,
  ME_TEST_WINDOW,
  creationResponse,
  recorder,
  settleSession,
} from '../../../../testing/creation-fixtures';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { FakeStageRenderers } from '../../../../testing/fake-stage-renderer';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { DRAFT_KEY, editableFrom, serializeDraft } from '../../shared/designer-draft';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `/c/:code` (schema.md §11.1–11.3; phase-5.md §7, §9; acceptance 5d, 5e; Boo C4, C5, C12–C14),
 * through the real route table into the real designer.
 */
describe('/c/:code working copy', () => {
  let storage: MemoryStorage;
  let http: HttpTestingController;
  let ledger: string[];
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage = new MemoryStorage();
    storage.setItem(FLASH_NOTICE_KEY, '1');
    ledger = [];
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([recorder(ledger)])),
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
    // A leftover request fails this test only: mocks and the module are reset regardless (Toad F3).
    try {
      http.verify();
    } finally {
      vi.restoreAllMocks();
      TestBed.resetTestingModule();
    }
  });

  function seedDraft(opts: {
    shellDirty: boolean;
    skyDirty: boolean;
    sky?: { gravity: number; wind: number };
  }) {
    const shell = editableFrom(PRESETS[0]);
    if (opts.sky) shell.sky = opts.sky;
    storage.setItem(
      DRAFT_KEY,
      serializeDraft({
        shell,
        activeBreak: 1,
        display: { mode: 'manual', persistence: 0.5, starBudget: 0.6, reduceFlashing: true },
        shellDirty: opts.shellDirty,
        skyDirty: opts.skyDirty,
        saved: false,
        source: null,
      }),
    );
  }

  async function open(url: string, me = ME_TEST_WINDOW) {
    settleSession(http, me);
    ledger.length = 0;
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    void harness.navigateByUrl(url);
    await tick();
    await harness.fixture.whenStable();
    const el = () => harness.routeNativeElement ?? (harness.fixture.nativeElement as HTMLElement);
    const byTest = <T extends HTMLElement = HTMLElement>(id: string) =>
      (harness.fixture.nativeElement as HTMLElement).querySelector<T>(`[data-testid="${id}"]`);
    const stable = async () => {
      await tick();
      await harness.fixture.whenStable();
      await tick();
      await harness.fixture.whenStable();
    };
    return { harness, router, el, byTest, stable };
  }

  const draft = () => JSON.parse(storage.getItem(DRAFT_KEY) ?? 'null');
  const settleDraft = () => tick(350);

  it('clean draft: exactly one GET, then / with replaceUrl; the copy loads dirty with its source (5d.1–5d.3)', async () => {
    seedDraft({ shellDirty: false, skyDirty: false, sky: { gravity: 300, wind: 40 } });
    const { router, byTest, stable } = await open(`/c/${CODE_A}`);
    const doc = editableFrom(PRESETS[2]);
    const { sky: _sky, ...withoutSky } = doc;
    const navigate = vi.spyOn(router, 'navigateByUrl');
    http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse({ document: withoutSky }));
    await stable();
    await settleDraft();
    await stable();

    expect(ledger).toEqual([`GET /api/creations/${CODE_A}`]);
    expect(router.url).toBe('/');
    expect(navigate).toHaveBeenCalledWith('/', { replaceUrl: true });
    expect(byTest('confirm-dialog')).toBeNull();
    const d = draft();
    // Exactly the saved settings; no sky in the record → DEFAULT_SKY, never the visitor's (5d.2).
    expect(d.shell).toEqual({ ...withoutSky, sky: { gravity: 160, wind: 0 } });
    expect(d.activeBreak).toBe(0);
    expect(d).toMatchObject({ shellDirty: true, skyDirty: true, saved: false });
    expect(d.source).toEqual({
      shareCode: CODE_A,
      kind: 'shell',
      isOwner: true,
      updatedAt: '2026-11-14T10:00:00.123456+00:00',
      name: 'Willow',
    });
    // Display settings stay (Skyler, 2026-11-14; 5d.7).
    expect(d.display).toEqual({
      mode: 'manual',
      persistence: 0.5,
      starBudget: 0.6,
      reduceFlashing: true,
    });
    expect(byTest('save-indicator')?.textContent?.trim()).toBe('Not saved');
    expect(document.activeElement).toBe(byTest('panel-heading'));
  });

  it('a saved sky is kept exactly (5d.2)', async () => {
    const { stable } = await open(`/c/${CODE_A}`);
    const doc = { ...editableFrom(PRESETS[2]), sky: { gravity: 220, wind: -15 } };
    http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse({ document: doc }));
    await stable();
    await settleDraft();
    expect(draft().shell.sky).toEqual({ gravity: 220, wind: -15 });
  });

  it('?returnUrl is ignored: it always lands on / (Boo C14)', async () => {
    const { router, stable } = await open(`/c/${CODE_A}?returnUrl=https://evil.example`);
    http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse());
    await stable();
    expect(router.url).toBe('/');
  });

  describe('over shell or sky changes (5e; Done-when 5; Boo C13)', () => {
    it.each([
      ['shell dirty', { shellDirty: true, skyDirty: false }],
      ['sky dirty', { shellDirty: false, skyDirty: true }],
    ])(
      '%s: asks over the designer; Keep editing leaves the draft byte-identical',
      async (_n, flags) => {
        seedDraft(flags);
        const before = storage.getItem(DRAFT_KEY);
        const { router, byTest, stable } = await open(`/c/${CODE_A}`);
        http.expectOne(`/api/creations/${CODE_A}`).flush(
          creationResponse({
            name: 'Ring of Fire',
            document: { ...editableFrom(PRESETS[2]), name: 'Ring of Fire' },
          }),
        );
        await stable();
        expect(router.url).toBe('/');
        expect(byTest('designer-panel')).not.toBeNull();
        expect(byTest('confirm-dialog')?.querySelector('h2')?.textContent).toBe(
          'Open “\u2068Ring of Fire\u2069”?',
        );
        expect(byTest('confirm-dialog')?.querySelector('p')?.textContent).toBe(
          'This replaces your current shell, “\u2068Peony\u2069”, including its breaks and sky, with a copy of “\u2068Ring of Fire\u2069”. Display settings stay as they are.',
        );
        expect(byTest('confirm-cancel')?.textContent?.trim()).toBe('Keep editing');
        expect(byTest('confirm-accept')?.textContent?.trim()).toBe('Open copy');
        expect(document.activeElement).toBe(byTest('confirm-cancel'));

        byTest('confirm-cancel')!.click();
        await stable();
        await settleDraft();
        expect(storage.getItem(DRAFT_KEY)).toBe(before);
        expect(byTest('confirm-dialog')).toBeNull();
        expect(document.activeElement).toBe(byTest('panel-heading'));
        expect(ledger).toEqual([`GET /api/creations/${CODE_A}`]);
      },
    );

    it('Open copy replaces the draft with the working copy; the old shell is gone', async () => {
      seedDraft({ shellDirty: true, skyDirty: true });
      const { byTest, stable } = await open(`/c/${CODE_A}`);
      http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse());
      await stable();
      byTest('confirm-accept')!.click();
      await stable();
      await settleDraft();
      expect(draft().shell.name).toBe(PRESETS[2].name);
      expect(storage.getItem(DRAFT_KEY)).not.toContain('"Peony"');
      expect(draft()).toMatchObject({ shellDirty: true, skyDirty: true, activeBreak: 0 });
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`]);
    });

    it('display or tab changes alone never ask (5e.4)', async () => {
      seedDraft({ shellDirty: false, skyDirty: false });
      const { byTest, stable } = await open(`/c/${CODE_A}`);
      http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse());
      await stable();
      expect(byTest('confirm-dialog')).toBeNull();
    });
  });

  describe('a second link (5e.5; Toad, Phase 5 review)', () => {
    it('a link right after a link load asks: the loaded copy is dirty', async () => {
      seedDraft({ shellDirty: false, skyDirty: false });
      const { harness, router, byTest, stable } = await open(`/c/${CODE_A}`);
      http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse());
      await stable();
      await settleDraft();
      expect(router.url).toBe('/');
      expect(byTest('confirm-dialog')).toBeNull();
      const before = storage.getItem(DRAFT_KEY);

      void harness.navigateByUrl(`/c/${CODE_B}`);
      await stable();
      http.expectOne(`/api/creations/${CODE_B}`).flush(
        creationResponse({
          shareCode: CODE_B,
          name: 'Second',
          document: { ...editableFrom(PRESETS[4]), name: 'Second' },
        }),
      );
      await stable();
      expect(router.url).toBe('/');
      expect(byTest('confirm-dialog')?.querySelector('h2')?.textContent).toBe(
        'Open “\u2068Second\u2069”?',
      );
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`, `GET /api/creations/${CODE_B}`]);

      byTest('confirm-cancel')!.click();
      await stable();
      await settleDraft();
      expect(storage.getItem(DRAFT_KEY)).toBe(before);
      expect(draft().source.shareCode).toBe(CODE_A);
    });

    it('/c/a failing then /c/b succeeding: the reused page hands over b, not a', async () => {
      seedDraft({ shellDirty: false, skyDirty: false });
      const { harness, router, byTest, stable } = await open(`/c/${CODE_A}`);
      http
        .expectOne(`/api/creations/${CODE_A}`)
        .flush(null, { status: 404, statusText: 'Not Found' });
      await stable();
      expect(byTest('message-page')).not.toBeNull();

      void harness.navigateByUrl(`/c/${CODE_B}`);
      await stable();
      http.expectOne(`/api/creations/${CODE_B}`).flush(creationResponse({ shareCode: CODE_B }));
      await stable();
      await settleDraft();
      expect(router.url).toBe('/');
      expect(draft().source.shareCode).toBe(CODE_B);
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`, `GET /api/creations/${CODE_B}`]);
    });
  });

  it('works with writes off: the copy loads; only Save is absent (5d.5)', async () => {
    const { byTest, stable } = await open(`/c/${CODE_A}`, ME_READ_ONLY);
    http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse());
    await stable();
    await settleDraft();
    expect(draft().source.shareCode).toBe(CODE_A);
    expect(byTest('save-update')).toBeNull();
    expect(byTest('share')).not.toBeNull();
  });

  describe('when it cannot open (5d.6, 5d.8, 5d.9; Boo C12)', () => {
    async function notFoundDom(url: string, answer: (() => void) | null) {
      seedDraft({ shellDirty: true, skyDirty: false });
      const before = storage.getItem(DRAFT_KEY);
      const { router, byTest, stable } = await open(url);
      answer?.();
      await stable();
      await settleDraft();
      expect(storage.getItem(DRAFT_KEY)).toBe(before);
      expect(TestBed.inject(NotificationService).notifications()).toEqual([]);
      expect(router.url).not.toBe('/');
      expect(fakes.starts).toHaveLength(0);
      return byTest('message-page')!.innerHTML.replace(/<!--.*?-->/g, '');
    }

    it('a bad-format code (no request), a JSON 404 and an empty 404 render the same DOM', async () => {
      seedDraft({ shellDirty: true, skyDirty: false });
      const before = storage.getItem(DRAFT_KEY);
      const { harness, byTest, stable } = await open('/c/abcdefgl');
      const dom = () => byTest('message-page')!.innerHTML.replace(/<!--.*?-->/g, '');
      const bad = dom();
      expect(ledger).toEqual([]);

      void harness.navigateByUrl(`/c/${CODE_A}`);
      await stable();
      http
        .expectOne(`/api/creations/${CODE_A}`)
        .flush({ message: 'Creation not found.' }, { status: 404, statusText: 'Not Found' });
      await stable();
      const json404 = dom();

      void harness.navigateByUrl(`/c/${CODE_B}`);
      await stable();
      http
        .expectOne(`/api/creations/${CODE_B}`)
        .flush(null, { status: 404, statusText: 'Not Found' });
      await stable();
      const empty404 = dom();

      expect(json404).toBe(bad);
      expect(empty404).toBe(bad);
      expect(bad).toContain('Nothing plays at this link');
      // Kind unknown: neither editor changed (phase-6.md §10.4, D2).
      expect(bad).toContain('Nothing in the designer or the Show Builder has changed.');
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`, `GET /api/creations/${CODE_B}`]);
      await settleDraft();
      expect(storage.getItem(DRAFT_KEY)).toBe(before);
    });

    it.each([
      ['service 404', { message: 'Creation not found.' }],
      ['catch-all 404', null],
    ])('%s renders the not-found page after exactly one GET', async (_n, body) => {
      const dom = await notFoundDom(`/c/${CODE_A}`, () =>
        http
          .expectOne(`/api/creations/${CODE_A}`)
          .flush(body, { status: 404, statusText: 'Not Found' }),
      );
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`]);
      expect(dom).toContain('Nothing plays at this link');
      expect(TestBed.inject(Title).getTitle()).toBe('Link not found · Fireworks Sandbox');
    });

    it.each([
      ['../me', '/c/..%2Fme'],
      ['two segments', '/c/abc/def'],
      ['no code', '/c'],
    ])('%s: the not-found page, no request (Boo C4; Peach N3)', async (_n, url) => {
      await notFoundDom(url, null);
      expect(ledger).toEqual([]);
    });

    it.each([
      ['kind "Shell"', { kind: 'Shell' }],
      ['kind "gallery"', { kind: 'gallery' }],
    ])('%s: not found, and normalize is never reached (Boo C5)', async (_n, override) => {
      const dom = await notFoundDom(`/c/${CODE_A}`, () =>
        http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse(override as never)),
      );
      expect(dom).toContain('Nothing plays at this link');
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('a show that fails normalizeShow: the show copy, both drafts untouched (phase-6.md §10.4)', async () => {
      const dom = await notFoundDom(`/c/${CODE_A}`, () =>
        http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse({ kind: 'show' })),
      );
      expect(dom).toContain("This show can't be opened.");
      expect(dom).toContain("Your show in the Show Builder hasn't changed.");
      expect(dom).toContain('Go to the Show Builder');
      expect(dom).not.toContain("can't be played yet");
    });

    it('a show with a newer version: the show reload copy (phase-6.md §10.4)', async () => {
      const dom = await notFoundDom(`/c/${CODE_A}`, () =>
        http
          .expectOne(`/api/creations/${CODE_A}`)
          .flush(creationResponse({ kind: 'show', document: { version: 2 } })),
      );
      expect(dom).toContain('This show needs a newer version of the app.');
    });

    it('version 2: the newer-version copy; its value never shown (Boo C15)', async () => {
      const dom = await notFoundDom(`/c/${CODE_A}`, () =>
        http
          .expectOne(`/api/creations/${CODE_A}`)
          .flush(creationResponse({ document: { ...editableFrom(PRESETS[2]), version: 2 } })),
      );
      expect(dom).toContain('This shell needs a newer version of the app.');
      expect(dom).toContain('Reload');
    });

    it.each([
      ['a string document', 'x'],
      ['a null document', null],
    ])("%s: the can't-be-opened copy", async (_n, document) => {
      const dom = await notFoundDom(`/c/${CODE_A}`, () =>
        http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse({ document })),
      );
      expect(dom).toContain("This shell can't be opened.");
    });

    it('429: distinct copy, one request, no retry loop', async () => {
      const dom = await notFoundDom(`/c/${CODE_A}`, () =>
        http.expectOne(`/api/creations/${CODE_A}`).flush(null, {
          status: 429,
          statusText: 'Too Many',
          headers: { 'Retry-After': '120' },
        }),
      );
      expect(dom).toContain('Too many requests right now.');
      expect(dom).toContain('Try again in 2 minutes.');
      expect(dom).not.toContain('Nothing plays');
      await tick(50);
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`]);
    });

    it("status 0: can't reach the server; Try again issues one more GET", async () => {
      seedDraft({ shellDirty: false, skyDirty: false });
      const { byTest, stable } = await open(`/c/${CODE_A}`);
      http
        .expectOne(`/api/creations/${CODE_A}`)
        .error(new ProgressEvent('error'), { status: 0, statusText: '' });
      await stable();
      expect(byTest('message-heading')?.textContent?.trim()).toBe("Can't reach the server.");
      byTest('message-retry')!.click();
      await stable();
      http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse());
      await stable();
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`, `GET /api/creations/${CODE_A}`]);
    });
  });

  it('a current-version document normalize adjusts opens, with one warning of codes and paths', async () => {
    const doc = { ...editableFrom(PRESETS[2]), name: 'Secret name' } as Record<string, unknown>;
    (doc['breaks'] as Record<string, unknown>[])[0]['stars'] = 9999;
    const { stable } = await open(`/c/${CODE_A}`);
    http.expectOne(`/api/creations/${CODE_A}`).flush(creationResponse({ document: doc }));
    await stable();
    await settleDraft();
    expect(draft().shell.breaks[0].stars).toBe(400);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls[0]);
    expect(logged).toContain('clamped breaks[0].stars');
    expect(logged).not.toContain('Secret name');
  });
});
