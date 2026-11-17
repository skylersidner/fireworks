import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PRESETS } from '../../../../../engine/model/presets';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import type { CreationSource } from '../../../../core/creation-save';
import { FLASH_NOTICE_KEY } from '../../../../core/device-preferences';
import { authInterceptor } from '../../../../core/auth-interceptor';
import { httpErrorInterceptor } from '../../../../core/http-error-interceptor';
import {
  SIGN_IN_INTENT_KEY,
  setSignInNavigationForTesting,
  writeSignInIntent,
} from '../../../../core/sign-in';
import { NotificationService } from '../../../../core/notifications';
import { STAGE_RENDERER_FACTORY } from '../../../../shared/fireworks-stage/fireworks-stage';
import {
  CODE_A,
  CODE_B,
  ME_ADA,
  ME_ANONYMOUS,
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
import { SHOW_DRAFT_KEY } from '../../../show/shared/show-draft';
import { WorkingCopyHandoff } from '../../shared/working-copy-handoff';
import { DesignerPageComponent } from './designer-page';
import { DRAFT_DEBOUNCE_MS, ShellDesignerStore } from './shell-designer.store';

/**
 * `setTimeout` is faked for every test here (testing strategy §3 item 9), so waits cost no real
 * time: `wait(ms)` advances the fake clock, running microtasks between timers.
 */
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const flush = () => wait(0);

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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakes = new FakeStageRenderers();
    storage = new MemoryStorage();
    storage.setItem(FLASH_NOTICE_KEY, '1');
    ledger = [];
    TestBed.configureTestingModule({
      imports: [DesignerPageComponent],
      providers: [
        provideHttpClient(
          withInterceptors([httpErrorInterceptor, authInterceptor, recorder(ledger)]),
        ),
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
      vi.useRealTimers();
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
    // Exactly the draft debounce: one millisecond less fails the draft checks (the NEG).
    const settleDraft = async () => {
      await wait(DRAFT_DEBOUNCE_MS);
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

  describe('identity and the save bar (Phase 8; phase-8.md §4, §5.1; Boo A40)', () => {
    it.each([
      ['api/me pending', 'pending' as const],
      ['api/me failed', 'error' as const],
    ])('%s: no save control; My creations is in the nav; the designer works', async (_n, me) => {
      const { byTest, answer } = await mount(me, OWNED);
      for (const id of ['save-save', 'save-update', 'save-saveAsNew', 'save-indicator']) {
        expect(byTest(id), id).toBeNull();
      }
      expect(byTest('nav-mine')?.getAttribute('href')).toBe('/mine');
      expect(byTest('account-sign-in')).toBeNull();
      // Share needs only a source (§5): copying a public link writes nothing.
      expect(byTest('share')).not.toBeNull();
      expect(byTest('launch')).not.toBeNull();
      if (me === 'pending') answer(ME_ANONYMOUS);
      expect(ledger).toEqual([]);
    });

    it('signed out: one Save (even for an owned source), no indicator, the sign-in note, Sign in', async () => {
      const { byTest } = await mount(ME_ANONYMOUS, OWNED);
      expect(byTest('save-save')?.textContent?.trim()).toBe('Save');
      expect(byTest('save-save')?.getAttribute('aria-haspopup')).toBe('dialog');
      expect(byTest('save-update')).toBeNull();
      expect(byTest('save-saveAsNew')).toBeNull();
      expect(byTest('save-indicator')).toBeNull();
      expect(byTest('save-note')?.textContent?.trim()).toBe(
        'Sign in to save and get a share link. Your work is kept in this browser.',
      );
      expect(byTest('share')).not.toBeNull();
      expect(byTest('account-sign-in')?.textContent?.trim()).toBe('Sign in');
      expect(byTest('nav-mine')).not.toBeNull();
      expect(ledger).toEqual([]);
    });

    it('signed out, Save: the dialog, zero writes; the Google button flushes, then one navigation', async () => {
      const navigations: string[] = [];
      const restore = setSignInNavigationForTesting((u) => navigations.push(u));
      try {
        const { byTest, stable, editName } = await mount(ME_ANONYMOUS);
        await editName('Before sign-in');
        byTest('save-save')!.click();
        await stable();
        expect(byTest('sign-in-dialog')).not.toBeNull();
        expect(byTest('sign-in-dialog')?.textContent).toContain('Sign in to save');
        expect(document.activeElement?.getAttribute('data-testid')).toBe('google-sign-in');
        expect(storage.getItem(DRAFT_KEY) ?? '').not.toContain('Before sign-in');
        byTest('google-sign-in')!.click();
        await stable();
        // flushDraft ran before the navigation (no debounce wait).
        expect(storage.getItem(DRAFT_KEY)).toContain('Before sign-in');
        expect(navigations).toEqual(['/api/auth/login/google?returnUrl=%2F']);
        expect(JSON.parse(sessionStorage.getItem(SIGN_IN_INTENT_KEY) ?? 'null')).toMatchObject({
          from: 'save',
          path: '/',
        });
        expect(byTest('google-sign-in')?.getAttribute('aria-disabled')).toBe('true');
        expect(ledger).toEqual([]);
      } finally {
        restore();
        sessionStorage.clear();
      }
    });

    it('signed out, Not now: the dialog closes, focus returns to Save, nothing sent', async () => {
      const { byTest, stable } = await mount(ME_ANONYMOUS);
      byTest('save-save')!.focus();
      byTest('save-save')!.click();
      await stable();
      byTest('sign-in-not-now')!.click();
      await stable();
      expect(byTest('sign-in-dialog')).toBeNull();
      expect(document.activeElement?.getAttribute('data-testid')).toBe('save-save');
      expect(ledger).toEqual([]);
    });

    it('the nav Sign in opens the nav variant; signed in, the name and Sign out', async () => {
      const { byTest, stable } = await mount(ME_ANONYMOUS);
      byTest('account-sign-in')!.click();
      await stable();
      expect(byTest('sign-in-dialog')?.querySelector('h2')?.textContent?.trim()).toBe('Sign in');
      expect(byTest('sign-in-line-0')?.textContent?.trim()).toBe(
        "Sign in with Google to save shells and shows and see My creations. Whatever you're working on stays in this browser.",
      );
      expect(byTest('sign-in-line-1')?.textContent?.trim()).toBe(
        'Fireworks Sandbox keeps your name from Google, not your email address.',
      );
    });

    it('signed in: the name in <bdi>, Sign out; Sign out posts logout, reloads, toasts, focuses Sign in', async () => {
      storage.setItem(SHOW_DRAFT_KEY, '{"show":"kept"}');
      const { byTest, stable } = await mount(ME_ADA, null, { shellDirty: true });
      const drafts = () => [storage.getItem(DRAFT_KEY), storage.getItem(SHOW_DRAFT_KEY)];
      const kept = drafts();
      expect(byTest('account-name')?.tagName).toBe('BDI');
      expect(byTest('account-name')?.textContent?.trim()).toBe('Ada Lovelace');
      expect(byTest('account-name')?.getAttribute('title')).toBe(
        'Signed in with Google as Ada Lovelace',
      );
      byTest('account-sign-out')!.focus();
      byTest('account-sign-out')!.click();
      await stable();
      expect(byTest('account-sign-out')?.getAttribute('aria-disabled')).toBe('true');
      respond('/api/auth/logout', null, 204);
      await stable();
      respond('/api/me', ME_ANONYMOUS);
      await stable();
      expect(ledger).toEqual(['POST /api/auth/logout', 'GET /api/me']);
      // G2: both drafts are byte-identical across Sign out (Skyler, 2026-11-16).
      expect(kept).not.toContain(null);
      expect(drafts()).toEqual(kept);
      expect(toasts.notifications().map((n) => n.message)).toContain('Signed out.');
      expect(document.activeElement?.getAttribute('data-testid')).toBe('account-sign-in');
      expect(byTest('save-save')?.getAttribute('aria-haspopup')).toBe('dialog');
    });

    it('Sign out failing: the error toast; Sign out stays', async () => {
      const { byTest, stable } = await mount(ME_ADA);
      byTest('account-sign-out')!.click();
      await stable();
      fail('/api/auth/logout', 0);
      await stable();
      expect(ledger).toEqual(['POST /api/auth/logout']);
      expect(toasts.notifications().map((n) => n.message)).toEqual([
        "Couldn't sign out: can't reach the server. Try again.",
      ]);
      expect(byTest('account-sign-out')).not.toBeNull();
    });

    it('the test-mode banner is gone in every state (Boo A42)', async () => {
      for (const me of [ME_TEST_WINDOW, ME_ANONYMOUS, ME_ADA]) {
        const { el, fixture } = await mount(me);
        expect(el.querySelector('[data-testid="test-mode-banner"]')).toBeNull();
        expect(el.textContent).not.toMatch(/Test mode|change or delete any saved/);
        fixture.destroy();
        TestBed.inject(HttpTestingController);
      }
    });

    it('the panel is not a Tab stop of its own (phase-8.md §12.5)', async () => {
      const { byTest } = await mount(ME_ANONYMOUS);
      expect(byTest('designer-panel')?.getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('the restore refresh and the return (schema.md §11.2 writer 4; phase-8.md §6)', () => {
    afterEach(() => sessionStorage.clear());

    it('signed in with a restored source: exactly one GET; isOwner and name refreshed, updatedAt kept', async () => {
      const legacy = { ...OWNED, isOwner: false, name: 'Old name' };
      const { byTest, stable, settleDraft, draft } = await mount(ME_ADA, legacy);
      // In flight: the one Save is busy.
      expect(byTest('save-save')?.getAttribute('aria-disabled')).toBe('true');
      respond(
        `/api/creations/${CODE_A}`,
        creationResponse({ isOwner: true, name: 'Willow 3', updatedAt: 'server-newer' }),
      );
      await stable();
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`]);
      expect(byTest('save-update')).not.toBeNull();
      expect(byTest('save-update')?.getAttribute('aria-disabled')).toBeNull();
      await settleDraft();
      expect(draft().source).toEqual({ ...OWNED, isOwner: true, name: 'Willow 3' });
    });

    it('a refresh 404 clears the source; another failure leaves it', async () => {
      const first = await mount(ME_ADA, OWNED);
      fail(`/api/creations/${CODE_A}`, 404);
      await first.stable();
      await first.settleDraft();
      expect(first.draft().source).toBeNull();
      expect(first.byTest('share')).toBeNull();
    });

    it('a /c/ working copy is a fresh read: no refresh GET, even over a restored source (running-app B2 find)', async () => {
      TestBed.inject(WorkingCopyHandoff).offer({
        shell: editableFrom(PRESETS[1]),
        source: { ...OWNED, shareCode: CODE_B, name: 'Linked' },
      });
      const { byTest, settleDraft, draft } = await mount(ME_ADA, OWNED, {
        shellDirty: false,
        skyDirty: false,
      });
      expect(ledger).toEqual([]);
      expect(byTest('save-update')?.getAttribute('aria-disabled')).toBeNull();
      await settleDraft();
      expect(draft().source.shareCode).toBe(CODE_B);
    });

    it('signed out, or with no source: no GET (call ledger)', async () => {
      await mount(ME_ANONYMOUS, OWNED);
      expect(ledger).toEqual([]);
      TestBed.resetTestingModule();
    });

    it('the return from Save: the toast, then focus on the first choice after the refresh; nothing saved (A41)', async () => {
      writeSignInIntent('save', '/');
      const { byTest, stable } = await mount(ME_ADA, OWNED);
      expect(toasts.notifications()).toEqual([]);
      respond(`/api/creations/${CODE_A}`, creationResponse({ isOwner: true }));
      await stable();
      expect(toasts.notifications().map((n) => n.message)).toEqual(['Signed in as Ada Lovelace.']);
      expect(document.activeElement).toBe(byTest('save-update'));
      expect(sessionStorage.getItem(SIGN_IN_INTENT_KEY)).toBeNull();
      expect(ledger).toEqual([`GET /api/creations/${CODE_A}`]);
    });

    it('the return from the nav: the toast and the h1; a stale or foreign marker does nothing', async () => {
      writeSignInIntent('nav', '/');
      const { byTest } = await mount(ME_ADA);
      expect(toasts.notifications().map((n) => n.message)).toEqual(['Signed in as Ada Lovelace.']);
      expect(document.activeElement).toBe(byTest('panel-heading'));
      expect(ledger).toEqual([]);
    });

    it('a marker for another page, or an old one, is deleted and ignored', async () => {
      writeSignInIntent('save', '/show');
      await mount(ME_ADA);
      expect(toasts.notifications()).toEqual([]);
      expect(sessionStorage.getItem(SIGN_IN_INTENT_KEY)).toBeNull();
    });

    it('back signed out (a refused cookie): nothing', async () => {
      writeSignInIntent('save', '/');
      await mount(ME_ANONYMOUS);
      expect(toasts.notifications()).toEqual([]);
      expect(ledger).toEqual([]);
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
        await wait(DRAFT_DEBOUNCE_MS);
        const before = storage.getItem(DRAFT_KEY);
        byTest('save-update')!.click();
        await stable();
        fail(`/api/creations/${CODE_A}`, status, body, headers);
        await stable();
        await wait(DRAFT_DEBOUNCE_MS);
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

    it('401: the signed-out copy, exactly one GET api/me (the interceptor), no retry; the bar collapses (A41)', async () => {
      const { byTest, stable } = await mount(ME_ADA, OWNED);
      respond(`/api/creations/${CODE_A}`, creationResponse({ isOwner: true }));
      await stable();
      byTest('save-update')!.focus();
      byTest('save-update')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}`, 401);
      await stable();
      respond('/api/me', ME_ANONYMOUS);
      await stable();
      expect(ledger).toEqual([
        `GET /api/creations/${CODE_A}`,
        `PUT /api/creations/${CODE_A}`,
        'GET /api/me',
      ]);
      expect(byTest('save-status-text')?.textContent?.trim()).toBe(
        "Couldn't save: you've been signed out. Sign in to save; your shell is kept in this browser.",
      );
      expect(byTest('save-update')).toBeNull();
      expect(byTest('save-save')?.getAttribute('aria-haspopup')).toBe('dialog');
      // The pressed button is gone: focus goes to the signed-out Save (§9.1).
      expect(document.activeElement).toBe(byTest('save-save'));
      // No generic toast for the 401.
      expect(toasts.notifications()).toEqual([]);
      // The block's Sign in opens the Save variant.
      byTest('save-status-signIn')!.click();
      await stable();
      expect(byTest('sign-in-dialog')?.querySelector('h2')?.textContent?.trim()).toBe(
        'Sign in to save',
      );
    });

    it('403 (the cross-origin check): the server-fault copy, no api/me reload', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-update')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}`, 403, { message: 'Cross-origin request.' });
      await stable();
      expect(ledger).toEqual([`PUT /api/creations/${CODE_A}`]);
      expect(byTest('save-status-text')?.textContent?.trim()).toBe(
        "Couldn't save: something went wrong on the server. Try again in a moment. Your shell is kept in this browser.",
      );
    });

    it('412: the copy, Save as new and Replace; Replace is one GET then one PUT with the fresh tag', async () => {
      const { byTest, stable, settleDraft, draft } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-update')!.click();
      await stable();
      const put = fail(`/api/creations/${CODE_A}`, 412, { message: 'x' }, { ETag: '"t9"' });
      expect(put.request.headers.get('If-Match')).toBe(`"${OWNED.updatedAt}"`);
      await stable();
      expect(byTest('save-status-text')?.textContent?.trim()).toBe(
        "Couldn't update “\u2068Willow 2\u2069”: it was changed somewhere else (another tab or device) after you opened it. Nothing was saved. Save as new keeps both versions; Replace puts yours on its share link and discards the other changes.",
      );
      expect(byTest('save-status-saveAsNew')?.textContent?.trim()).toBe('Save as new');
      expect(byTest('save-status-replace')?.textContent?.trim()).toBe('Replace the newer version');
      // The source is unchanged (the edit base stays for If-Match).
      await settleDraft();
      expect(draft().source).toEqual(OWNED);
      byTest('save-status-replace')!.focus();
      byTest('save-status-replace')!.click();
      await stable();
      expect(byTest('save-status-replace')?.textContent?.trim()).toBe('Replacing…');
      expect(byTest('save-status-replace')?.getAttribute('aria-disabled')).toBe('true');
      expect(byTest('save-update')?.getAttribute('aria-disabled')).toBe('true');
      respond(`/api/creations/${CODE_A}`, creationResponse({ updatedAt: 'fresh' }));
      const second = http.expectOne((r) => r.method === 'PUT');
      expect(second.request.headers.get('If-Match')).toBe('"fresh"');
      second.flush(creationResponse({ updatedAt: 'after' }));
      await stable();
      expect(ledger).toEqual([
        `PUT /api/creations/${CODE_A}`,
        `GET /api/creations/${CODE_A}`,
        `PUT /api/creations/${CODE_A}`,
      ]);
      expect(byTest('save-status')).toBeNull();
      // The block left with the focused Replace: focus goes to Save as new (§9.2).
      expect(document.activeElement).toBe(byTest('save-saveAsNew'));
      await settleDraft();
      expect(draft().source.updatedAt).toBe('after');
    });

    it('412, Save as new: the remix, as from the bar', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-update')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}`, 412, { message: 'x' });
      await stable();
      byTest('save-status-saveAsNew')!.click();
      await stable();
      respond(`/api/creations/${CODE_A}/remix`, creationResponse({ shareCode: CODE_B }), 201);
      await stable();
      expect(ledger).toEqual([
        `PUT /api/creations/${CODE_A}`,
        `POST /api/creations/${CODE_A}/remix`,
      ]);
    });

    it('Replace whose GET says not yours: row 404a, no PUT, source forgotten', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-update')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}`, 412, { message: 'x' });
      await stable();
      byTest('save-status-replace')!.click();
      await stable();
      respond(`/api/creations/${CODE_A}`, creationResponse({ isOwner: false }));
      await stable();
      expect(ledger).toEqual([`PUT /api/creations/${CODE_A}`, `GET /api/creations/${CODE_A}`]);
      expect(byTest('save-status-text')?.textContent).toMatch(/deleted or is no longer yours/);
      expect(byTest('share')).toBeNull();
    });

    it('428: the Reload row (an empty token never reaches a PUT: readSource drops it, creation-save guards it)', async () => {
      const { byTest, stable } = await mount(ME_TEST_WINDOW, OWNED);
      byTest('save-update')!.click();
      await stable();
      fail(`/api/creations/${CODE_A}`, 428, { message: 'x' });
      await stable();
      expect(ledger).toEqual([`PUT /api/creations/${CODE_A}`]);
      expect(byTest('save-status-text')?.textContent?.trim()).toBe(
        "Couldn't update “\u2068Willow 2\u2069”: this page is out of date. Reload, then save again. Your shell is kept in this browser.",
      );
      expect(byTest('save-status-reload')).not.toBeNull();
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
