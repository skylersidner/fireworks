import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PRESETS } from '../../../../../engine/model/presets';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import type { CreationSource } from '../../../../core/creation-save';
import { FLASH_NOTICE_KEY } from '../../../../core/device-preferences';
import { httpErrorInterceptor } from '../../../../core/http-error-interceptor';
import { NotificationService } from '../../../../core/notifications';
import { STAGE_RENDERER_FACTORY } from '../../../../shared/fireworks-stage/fireworks-stage';
import {
  CODE_A,
  CODE_B,
  ME_READ_ONLY,
  ME_SIGNED_IN,
  ME_TEST_WINDOW,
  creationResponse,
  recorder,
  settleSession,
} from '../../../../testing/creation-fixtures';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { FakeStageRenderers } from '../../../../testing/fake-stage-renderer';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { DRAFT_KEY, editableFrom, serializeDraft } from '../../shared/designer-draft';
import { DesignerPageComponent } from './designer-page';
import { ShellDesignerStore } from './shell-designer.store';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

const OWNED: CreationSource = {
  shareCode: CODE_A,
  kind: 'shell',
  isOwner: true,
  updatedAt: '2026-11-14T10:00:00.123456+00:00',
  name: 'Willow 2',
};

/**
 * Save, Share and the dirty indicator on the designer (plan Phase 5; phase-5.md §2–§6; schema.md
 * §11.4; acceptance 5b, 5c; Boo C7–C9, C11, C15, C17). Ledgers are exact (Toad's rule).
 */
describe('Designer Save and Share', () => {
  let fakes: FakeStageRenderers;
  let storage: MemoryStorage;
  let http: HttpTestingController;
  let ledger: string[];
  let toasts: NotificationService;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakes = new FakeStageRenderers();
    storage = new MemoryStorage();
    storage.setItem(FLASH_NOTICE_KEY, '1');
    ledger = [];
    TestBed.configureTestingModule({
      imports: [DesignerPageComponent],
      providers: [
        provideHttpClient(withInterceptors([httpErrorInterceptor, recorder(ledger)])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: MATCH_MEDIA, useValue: new FakeMatchMedia().fn },
        { provide: BROWSER_STORAGE, useValue: storage },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    toasts = TestBed.inject(NotificationService);
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

  /** Optionally seeds the draft with `source`, then mounts with `api/me` answered as `me`. */
  async function mount(
    me: Parameters<typeof settleSession>[1] = ME_TEST_WINDOW,
    source: CreationSource | null = null,
    flags: { shellDirty?: boolean; skyDirty?: boolean; saved?: boolean } = {},
  ) {
    if (source || Object.keys(flags).length) {
      storage.setItem(
        DRAFT_KEY,
        serializeDraft({
          shell: editableFrom(PRESETS[2]),
          activeBreak: 0,
          display: { mode: 'loop', persistence: 0.78, starBudget: 1, reduceFlashing: null },
          shellDirty: flags.shellDirty ?? true,
          skyDirty: flags.skyDirty ?? true,
          saved: flags.saved ?? false,
          source,
        }),
      );
    }
    const answer = settleSession(http, me);
    ledger.length = 0;
    const fixture = TestBed.createComponent(DesignerPageComponent);
    await fixture.whenStable();
    fakes.starts[fakes.starts.length - 1].resolve('webgl');
    await flush();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const byTest = <T extends HTMLElement = HTMLElement>(id: string) =>
      el.querySelector<T>(`[data-testid="${id}"]`);
    const stable = async () => {
      await fixture.whenStable();
      await flush();
      await fixture.whenStable();
    };
    const draft = () => JSON.parse(storage.getItem(DRAFT_KEY) ?? 'null');
    const settleDraft = async () => {
      await new Promise((r) => setTimeout(r, 350));
      await stable();
    };
    const editName = async (value: string) => {
      const name = el.querySelector<HTMLInputElement>('#shell-name')!;
      name.value = value;
      name.dispatchEvent(new Event('input'));
      await stable();
    };
    return { fixture, el, byTest, stable, draft, settleDraft, editName, answer };
  }

  function respond(url: string, body: object | null, status = 200) {
    const req = http.expectOne(url);
    req.flush(body, { status, statusText: String(status) });
    return req;
  }

  function fail(url: string, status: number, body: object | null = null, headers = {}) {
    const req = http.expectOne(url);
    if (status === 0) req.error(new ProgressEvent('error'), { status: 0, statusText: '' });
    else req.flush(body, { status, statusText: String(status), headers });
    return req;
  }

  describe('write switch (5b.1; Boo C9)', () => {
    it.each([
      ['writes off', ME_READ_ONLY],
      ['api/me pending', 'pending' as const],
      ['api/me failed', 'error' as const],
    ])('%s: no save control, no My creations link, the designer still works', async (_n, me) => {
      const { byTest, answer } = await mount(me, OWNED);
      for (const id of [
        'save-save',
        'save-update',
        'save-saveAsNew',
        'save-indicator',
        'nav-mine',
      ]) {
        expect(byTest(id), id).toBeNull();
      }
      // Share needs only a source (§5): copying a public link writes nothing.
      expect(byTest('share')).not.toBeNull();
      expect(byTest('launch')).not.toBeNull();
      if (me === 'pending') answer(ME_READ_ONLY);
      expect(ledger).toEqual([]);
    });

    it('controls appear without a reload once api/me answers canWrite: true', async () => {
      const { byTest, stable, answer } = await mount('pending');
      expect(byTest('save-save')).toBeNull();
      answer(ME_TEST_WINDOW);
      await stable();
      expect(byTest('save-save')?.textContent?.trim()).toBe('Save');
      expect(byTest('nav-mine')?.getAttribute('href')).toBe('/mine');
    });

    it('writes off and no source: the panel shows no save bar content at all (§2.1)', async () => {
      const { byTest } = await mount(ME_READ_ONLY);
      expect(byTest('save-bar')?.textContent?.trim()).toBe('');
    });
  });

  describe('test-mode banner (Boo C17)', () => {
    it.each([
      ['writes on, not signed in', ME_TEST_WINDOW, true],
      ['writes off', ME_READ_ONLY, false],
      ['signed in (Phase 8)', ME_SIGNED_IN, false],
    ])('%s → shown: %s', async (_n, me, shown) => {
      const { byTest } = await mount(me);
      expect(!!byTest('test-mode-banner')).toBe(shown);
      if (shown) {
        expect(byTest('test-mode-banner')?.textContent).toMatch(/change or delete any saved/);
      }
    });
  });

  describe('fresh work (5b.2, 5b.7)', () => {
    it('one Save; the note says Save to get a share link; no Share', async () => {
      const { byTest } = await mount();
      expect(byTest('save-save')).not.toBeNull();
      expect(byTest('save-update')).toBeNull();
      expect(byTest('share')).toBeNull();
      expect(byTest('save-note')?.textContent?.trim()).toBe('Save to get a share link.');
      // Untouched default with no source: no indicator (§2.3 last row).
      expect(byTest('save-indicator')).toBeNull();
    });

    it('Save sends exactly POST api/creations with {kind, document}, compact; source is stored', async () => {
      const { byTest, stable, draft, settleDraft, editName } = await mount();
      await editName('Willow 2');
      expect(byTest('save-indicator')?.textContent?.trim()).toBe('Not saved');
      byTest('save-save')!.click();
      await stable();
      expect(byTest('save-save')?.textContent?.trim()).toBe('Saving…');
      expect(byTest('save-save')?.getAttribute('aria-disabled')).toBe('true');
      expect(byTest('save-indicator')?.textContent?.trim()).toBe('Saving…');

      const req = http.expectOne('/api/creations');
      expect(req.request.method).toBe('POST');
      expect(Object.keys(req.request.body).sort()).toEqual(['document', 'kind']);
      expect(req.request.body.kind).toBe('shell');
      expect(Object.keys(req.request.body.document)).toEqual([
        'version',
        'name',
        'burstHeight',
        'angleJitter',
        'sky',
        'breaks',
      ]);
      expect(JSON.stringify(req.request.body)).not.toMatch(/\n/);
      req.flush(creationResponse({ shareCode: CODE_B, name: 'Willow 2' }), {
        status: 201,
        statusText: 'Created',
      });
      await settleDraft();

      expect(ledger).toEqual(['POST /api/creations']);
      expect(draft().source).toEqual({
        shareCode: CODE_B,
        kind: 'shell',
        isOwner: true,
        updatedAt: '2026-11-14T10:00:00.123456+00:00',
        name: 'Willow 2',
      });
      expect(draft()).toMatchObject({ shellDirty: false, skyDirty: false, saved: true });
      expect(byTest('save-indicator')?.textContent?.trim()).toBe('Saved');
      expect(byTest('save-update')?.hasAttribute('disabled')).toBe(true);
      expect(byTest('save-update')?.getAttribute('title')).toBe('No changes since you saved.');
      expect(byTest('save-saveAsNew')?.hasAttribute('disabled')).toBe(false);
      expect(toasts.notifications().map((n) => n.message)).toEqual([
        'Saved “\u2068Willow 2\u2069”.',
      ]);
    });

    it('a blank name saves as "Custom" and Save is not blocked (5b.7)', async () => {
      const { byTest, stable, editName } = await mount();
      await editName('   ');
      byTest('save-save')!.click();
      await stable();
      const req = http.expectOne('/api/creations');
      expect(req.request.body.document.name).toBe('Custom');
      req.flush(creationResponse({ name: 'Custom' }), { status: 201, statusText: 'Created' });
    });

    it('two presses before the response send one request (5b.10)', async () => {
      const { byTest, stable } = await mount();
      byTest('save-save')!.click();
      byTest('save-save')!.click();
      await stable();
      byTest('save-save')!.click();
      await stable();
      respond('/api/creations', creationResponse({ shareCode: CODE_B }), 201);
      expect(ledger).toEqual(['POST /api/creations']);
    });
  });

  describe('F4: saved, dirty and the in-flight edit (phase-5.md §3.3, §4)', () => {
    it('Save, then a preset loads without asking, and reads Not saved', async () => {
      const { byTest, el, stable, editName } = await mount();
      await editName('Mine');
      byTest('save-save')!.click();
      await stable();
      respond('/api/creations', creationResponse({ shareCode: CODE_B, name: 'Mine' }), 201);
      await stable();
      el.querySelectorAll<HTMLButtonElement>('app-preset-bar button')[3].click();
      await stable();
      expect(byTest('confirm-dialog')).toBeNull();
      expect(byTest('save-indicator')?.textContent?.trim()).toBe('Not saved');
      // A preset on a working copy is an edit to that copy: source stays.
      expect(byTest('save-update')).not.toBeNull();
      expect(byTest('save-update')?.hasAttribute('disabled')).toBe(false);
    });

    it('an edit while the request is in flight keeps Not saved and both flags', async () => {
      const { byTest, stable, draft, settleDraft, editName } = await mount();
      await editName('Before');
      byTest('save-save')!.click();
      await stable();
      await editName('After');
      respond('/api/creations', creationResponse({ shareCode: CODE_B, name: 'Before' }), 201);
      await settleDraft();
      expect(draft()).toMatchObject({ shellDirty: true, saved: false });
      expect(draft().source.shareCode).toBe(CODE_B);
      expect(byTest('save-indicator')?.textContent?.trim()).toBe('Not saved');
    });

    it('a draft with saved missing or malformed reads Not saved', async () => {
      storage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          ...JSON.parse(
            serializeDraft({
              shell: editableFrom(PRESETS[2]),
              activeBreak: 0,
              display: { mode: 'loop', persistence: 0.78, starBudget: 1, reduceFlashing: null },
              shellDirty: false,
              skyDirty: false,
              saved: true,
              source: OWNED,
            }),
          ),
          saved: 'true',
        }),
      );
      const { byTest } = await mount();
      expect(byTest('save-indicator')?.textContent?.trim()).toBe('Not saved');
    });
  });

  describe('owned working copy (5b.3; Done-when 3, 4)', () => {
    it('shows Update original and Save as new with the owner note', async () => {
      const { byTest } = await mount(ME_TEST_WINDOW, OWNED);
      expect(byTest('save-update')?.textContent?.trim()).toBe('Update original');
      expect(byTest('save-saveAsNew')?.textContent?.trim()).toBe('Save as new');
      expect(byTest('save-save')).toBeNull();
      expect(byTest('save-note')?.textContent?.trim()).toBe(
        'Update original changes what the share link for “\u2068Willow 2\u2069” plays. Save as new keeps it and makes a new link.',
      );
      expect(byTest('save-indicator')?.textContent?.trim()).toBe('Not saved');
    });

    it('Update original: exactly PUT {document}; same code, updatedAt refreshed', async () => {
      const { byTest, stable, draft, settleDraft } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-update')!.click();
      await stable();
      const req = http.expectOne(`/api/creations/${CODE_A}`);
      expect(req.request.method).toBe('PUT');
      expect(Object.keys(req.request.body)).toEqual(['document']);
      req.flush(
        creationResponse({ updatedAt: '2026-11-14T11:00:00.000001+00:00', name: 'Willow 2' }),
      );
      await settleDraft();
      expect(ledger).toEqual([`PUT /api/creations/${CODE_A}`]);
      expect(draft().source).toEqual({ ...OWNED, updatedAt: '2026-11-14T11:00:00.000001+00:00' });
      expect(toasts.notifications().at(-1)?.message).toBe(
        'Updated “\u2068Willow 2\u2069”. Its share link plays this version now.',
      );
    });

    it('Save as new: exactly POST …/remix {document}; source is the new record', async () => {
      const { byTest, stable, draft, settleDraft } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-saveAsNew')!.click();
      await stable();
      const req = http.expectOne(`/api/creations/${CODE_A}/remix`);
      expect(req.request.method).toBe('POST');
      expect(Object.keys(req.request.body)).toEqual(['document']);
      req.flush(creationResponse({ shareCode: CODE_B, name: 'Willow 2' }), {
        status: 201,
        statusText: 'Created',
      });
      await settleDraft();
      expect(ledger).toEqual([`POST /api/creations/${CODE_A}/remix`]);
      expect(draft().source.shareCode).toBe(CODE_B);
      expect(toasts.notifications().at(-1)?.message).toBe(
        'Saved “\u2068Willow 2\u2069” as a new creation with its own link.',
      );
    });

    it('focus leaves a button the save disabled: to Save as new (§12.1)', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-update')!.focus();
      byTest('save-update')!.click();
      await stable();
      respond(`/api/creations/${CODE_A}`, creationResponse());
      await stable();
      expect(document.activeElement).toBe(byTest('save-saveAsNew'));
    });
  });

  describe('non-owner working copy (5b.4; spec only before Phase 8)', () => {
    it('one Save, no Update original; the ledger is exactly one POST …/remix', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, { ...OWNED, isOwner: false });
      expect(byTest('save-update')).toBeNull();
      expect(byTest('save-save')?.textContent?.trim()).toBe('Save');
      expect(byTest('save-note')?.textContent?.trim()).toBe(
        "Saves your own copy with a new link. The original isn't changed.",
      );
      byTest('save-save')!.click();
      await stable();
      respond(`/api/creations/${CODE_A}/remix`, creationResponse({ shareCode: CODE_B }), 201);
      expect(ledger).toEqual([`POST /api/creations/${CODE_A}/remix`]);
      expect(toasts.notifications().at(-1)?.message).toBe(
        'Saved “\u2068Willow\u2069” as your own copy.',
      );
    });
  });

  describe('404 fallbacks (5b.5, 5b.6; schema.md §11.2; Y2)', () => {
    it('PUT 404 asks; source becomes null; Save as new is one plain POST', async () => {
      const { byTest, stable, draft, settleDraft } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-update')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}`, 404, { message: 'Not found.' });
      await settleDraft();
      expect(byTest('save-status')?.getAttribute('role')).toBe('alert');
      expect(byTest('save-status-text')?.textContent?.trim()).toBe(
        "Couldn't update “\u2068Willow 2\u2069”: the original was deleted or is no longer yours. Nothing was saved. Save as new to keep your shell with a new share link.",
      );
      expect(draft().source).toBeNull();
      expect(byTest('share')).toBeNull();
      expect(byTest('save-save')).not.toBeNull();
      expect(ledger).toEqual([`PUT /api/creations/${CODE_A}`]);

      byTest('save-status-saveAsNew')!.click();
      await stable();
      const create = http.expectOne('/api/creations');
      expect(Object.keys(create.request.body).sort()).toEqual(['document', 'kind']);
      create.flush(creationResponse({ shareCode: CODE_B }), { status: 201, statusText: 'Created' });
      await settleDraft();
      expect(ledger).toEqual([`PUT /api/creations/${CODE_A}`, 'POST /api/creations']);
      expect(draft().source.shareCode).toBe(CODE_B);
      expect(byTest('save-status')).toBeNull();
      expect(document.activeElement).toBe(byTest('save-saveAsNew'));
    });

    it.each([
      ['owner, Save as new', OWNED, 'save-saveAsNew'],
      ['non-owner Save', { ...OWNED, isOwner: false }, 'save-save'],
    ])(
      '%s: remix 404 falls back to one plain POST and reports the caveat',
      async (_n, source, id) => {
        const { byTest, stable, draft, settleDraft } = await mount(ME_TEST_WINDOW, source);
        byTest(id)!.click();
        await stable();
        fail(`/api/creations/${CODE_A}/remix`, 404, { message: 'Not found.' });
        respond('/api/creations', creationResponse({ shareCode: CODE_B, name: 'Willow 3' }), 201);
        await settleDraft();
        expect(ledger).toEqual([`POST /api/creations/${CODE_A}/remix`, 'POST /api/creations']);
        expect(byTest('save-status')?.getAttribute('role')).toBe('status');
        expect(byTest('save-status-text')?.textContent?.trim()).toBe(
          "Saved “\u2068Willow 3\u2069” as a new creation. The original it came from was deleted, so the two aren't linked.",
        );
        expect(draft().source.shareCode).toBe(CODE_B);
      },
    );

    it('remix 404 then a failed POST: source stays null and the POST failure shows', async () => {
      const { byTest, stable, draft, settleDraft } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-saveAsNew')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}/remix`, 404, { message: 'Not found.' });
      fail('/api/creations', 500);
      await settleDraft();
      expect(draft().source).toBeNull();
      expect(byTest('save-status-text')?.textContent).toContain(
        'something went wrong on the server',
      );
    });
  });

  describe('Save-time failures (5b.9; F10; Boo C8, C15)', () => {
    const KEPT = 'Your shell is kept in this browser.';
    it.each([
      [
        '400 with issues, truncated',
        400,
        {
          message: '<b>x</b> visit evil.example',
          errors: [
            { path: 'breaks[0].stars', code: 'out-of-range', message: 'evil.example' },
            { path: 'name', code: 'too-long', message: 'x' },
            { path: 'theme', code: 'unknown-property', message: 'x' },
            { path: 'sky.wind', code: 'not-integer', message: 'x' },
          ],
          truncated: true,
        },
        {},
        `Couldn't save: the server didn't accept this shell (Stars (Break 1) is outside 4 to 400; Name is longer than 80 characters; theme isn't a field this app knows, and more). Reloading the page usually fixes this. ${KEPT}`,
        ['reload'],
      ],
      [
        '400 version (stale tab)',
        400,
        {
          message: 'x',
          errors: [{ path: 'version', code: 'version', message: 'x' }],
          truncated: false,
        },
        {},
        `Couldn't save: this page is out of date. Reload to get the latest version, then save again. ${KEPT}`,
        ['reload'],
      ],
      [
        '413',
        413,
        null,
        {},
        "Couldn't save: this shell is larger than the 256 KB the server accepts. Nothing was saved. Your work is kept in this browser.",
        [],
      ],
      [
        'status 0',
        0,
        null,
        {},
        `Couldn't save: can't reach the server. Check your connection and try again. ${KEPT}`,
        ['retry'],
      ],
      [
        '429',
        429,
        null,
        { 'Retry-After': '42' },
        `Couldn't save: too many saves in a short time. Try again in 42 seconds. ${KEPT}`,
        [],
      ],
      [
        '500',
        500,
        null,
        {},
        `Couldn't save: something went wrong on the server. Try again in a moment. ${KEPT}`,
        ['retry'],
      ],
    ])(
      '%s: inline copy, no toast, draft byte-identical, Save usable',
      async (_n, status, body, headers, text, actions) => {
        const { byTest, stable, el } = await mount(ME_TEST_WINDOW, OWNED);
        await new Promise((r) => setTimeout(r, 350));
        const before = storage.getItem(DRAFT_KEY);
        byTest('save-update')!.click();
        await stable();
        fail(`/api/creations/${CODE_A}`, status, body, headers);
        await stable();
        await new Promise((r) => setTimeout(r, 350));
        expect(byTest('save-status-text')?.textContent?.trim()).toBe(text);
        expect(
          [...el.querySelectorAll('[data-testid^="save-status-"]')]
            .map((b) => b.getAttribute('data-testid')!.replace('save-status-', ''))
            .filter((a) => a !== 'text' && a !== 'dismiss'),
        ).toEqual(actions);
        expect(el.textContent).not.toContain('evil.example');
        expect(toasts.notifications()).toEqual([]);
        expect(storage.getItem(DRAFT_KEY)).toBe(before);
        expect(byTest('save-update')?.getAttribute('aria-disabled')).toBeNull();
        expect(ledger).toEqual([`PUT /api/creations/${CODE_A}`]);
      },
    );

    it('403: the copy, then exactly one GET api/me, and the bar hides; the message stays', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-update')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}`, 403, { message: 'Writes are off.' });
      await stable();
      respond('/api/me', ME_READ_ONLY);
      await stable();
      expect(ledger).toEqual([`PUT /api/creations/${CODE_A}`, 'GET /api/me']);
      expect(byTest('save-status-text')?.textContent?.trim()).toBe(
        "Couldn't save: saving has been turned off on this site. Your shell is kept in this browser.",
      );
      expect(byTest('save-update')).toBeNull();
      expect(byTest('nav-mine')).toBeNull();
    });

    it('Try again repeats the failed save; Dismiss clears the block', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-saveAsNew')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}/remix`, 0);
      await stable();
      byTest('save-status-retry')!.click();
      await stable();
      respond(`/api/creations/${CODE_A}/remix`, creationResponse({ shareCode: CODE_B }), 201);
      await stable();
      expect(ledger).toEqual([
        `POST /api/creations/${CODE_A}/remix`,
        `POST /api/creations/${CODE_A}/remix`,
      ]);
      expect(byTest('save-status')).toBeNull();
    });

    it('a Try again left over after writes go off sends nothing (Boo C9; Toad, Phase 5 review)', async () => {
      // The status block isn't gated on canWrite, so the flow's own guard is the only stop.
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-saveAsNew')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}/remix`, 0);
      await stable();
      settleSession(http, ME_READ_ONLY);
      await stable();
      expect(byTest('save-saveAsNew')).toBeNull();
      expect(byTest('save-status-retry')).not.toBeNull();
      ledger.length = 0;
      byTest('save-status-retry')!.click();
      await stable();
      expect(ledger).toEqual([]);
    });
  });

  describe('Share (5c; Boo C11)', () => {
    let writeText: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });
    afterEach(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });

    it('copies exactly {origin}/s/{code} with the unsaved caveat; no request', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('share')!.click();
      await stable();
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(`${location.origin}/s/${CODE_A}`);
      expect(writeText.mock.calls[0][0]).toMatch(/^https?:\/\/[^/]+\/s\/[1-9A-HJ-NP-Za-km-z]{8}$/);
      expect(toasts.notifications().map((n) => n.message)).toEqual([
        'Share link copied. It plays the last saved version, not your unsaved changes.',
      ]);
      expect(ledger).toEqual([]);
    });

    it('after a save the toast has no caveat', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED, {
        shellDirty: false,
        skyDirty: false,
        saved: true,
      });
      byTest('share')!.click();
      await stable();
      expect(toasts.notifications().map((n) => n.message)).toEqual(['Share link copied.']);
    });

    it('a blocked clipboard shows the link selected, no toast; an edit removes it', async () => {
      writeText.mockRejectedValue(new Error('denied'));
      const { byTest, stable, editName } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('share')!.click();
      await stable();
      const field = byTest<HTMLInputElement>('share-link-field')!;
      expect(field.value).toBe(`${location.origin}/s/${CODE_A}`);
      expect(field.getAttribute('aria-label')).toBe('Share link');
      expect(byTest('share-blocked')?.textContent).toMatch(
        /Copy was blocked\. The link is selected/,
      );
      expect(toasts.notifications()).toEqual([]);
      await editName('Edited');
      expect(byTest('share-link-field')).toBeNull();
    });

    it('works with writes off when there is a source', async () => {
      const { byTest, stable } = await mount(ME_READ_ONLY, OWNED);
      byTest('share')!.click();
      await stable();
      expect(writeText).toHaveBeenCalledWith(`${location.origin}/s/${CODE_A}`);
    });
  });

  describe('a source of the wrong kind (Boo, Phase 5 info)', () => {
    it('a tampered draft with source.kind "show" restores as fresh work; Save is a plain create', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, { ...OWNED, kind: 'show' });
      expect(byTest('save-update')).toBeNull();
      byTest('save-save')!.click();
      await stable();
      expect(byTest('save-save')?.textContent?.trim()).toBe('Saving…');
      respond('/api/creations', creationResponse({ shareCode: CODE_B, name: 'Willow 2' }), 201);
      await stable();
      expect(ledger).toEqual(['POST /api/creations']);
      expect(byTest('save-indicator')?.textContent?.trim()).toBe('Saved');
    });

    it('a plan that cannot be made never leaves Save at "Saving…" and sends nothing', async () => {
      const { fixture, byTest, stable } = await mount(ME_TEST_WINDOW);
      const store = fixture.debugElement.injector.get(ShellDesignerStore);
      // Only a bug could set this; the draft refuses it (above).
      (store as unknown as { sourceState: { set(v: unknown): void } }).sourceState.set({
        ...OWNED,
        kind: 'show',
        isOwner: false,
      });
      await stable();
      byTest('save-save')!.click();
      await stable();
      expect(ledger).toEqual([]);
      expect(byTest('save-save')?.textContent?.trim()).toBe('Save');
      expect(byTest('save-save')?.getAttribute('aria-disabled')).not.toBe('true');
      expect(byTest('save-status-text')?.textContent).toContain("Couldn't save");
    });
  });
});
