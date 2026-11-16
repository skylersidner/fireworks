import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PRESETS } from '../../../../../engine/model/presets';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import { httpErrorInterceptor } from '../../../../core/http-error-interceptor';
import { NotificationService } from '../../../../core/notifications';
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
import { MemoryStorage } from '../../../../testing/memory-storage';
import { doneWhenShow } from '../../../../testing/show-fixtures';
import { SHARE_COPIED, SHARE_COPIED_UNSAVED } from '../../../../shared/save-copy';
import { EMPTY_SAVE_NOTE, formatTime } from '../../shared/show-copy';
import { SHOW_DRAFT_KEY } from '../../shared/show-draft';
import { embeddable } from '../../shared/show-edit';
import { SHOW_DRAFT_DEBOUNCE_MS, ShowBuilderStore } from './show-builder.store';
import { MY_SHELLS_PAGE_SIZE, ShowLibraryFlow } from './show-library';
import { ShowSaveFlow } from './show-save';

/**
 * `setTimeout` is faked for every test here (testing strategy §3 item 9), so waits cost no real
 * time: `wait(ms)` advances the fake clock, running microtasks between timers.
 */
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const flush = () => wait(0);
const OWNED = {
  shareCode: CODE_A,
  kind: 'show' as const,
  isOwner: true,
  updatedAt: '2026-11-14T10:00:00Z',
  name: 'Saved show',
};
const LIST = `/api/me/creations?page=1&pageSize=${MY_SHELLS_PAGE_SIZE}&kind=shell`;

/**
 * Save and Share for shows (schema.md §11.4; phase-6.md §9.1, §10; acceptance 6f) and the "My
 * shells" library (6d.2, 6e). Ledgers are exact (Toad's rule).
 */
describe('Show save and library flows', () => {
  let storage: MemoryStorage;
  let http: HttpTestingController;
  let ledger: string[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storage = new MemoryStorage();
    ledger = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([httpErrorInterceptor, recorder(ledger)])),
        provideHttpClientTesting(),
        ShowBuilderStore,
        ShowSaveFlow,
        ShowLibraryFlow,
        { provide: BROWSER_STORAGE, useValue: storage },
        { provide: MATCH_MEDIA, useValue: new FakeMatchMedia().fn },
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
      vi.useRealTimers();
    }
  });

  function setup(me: Parameters<typeof settleSession>[1] = ME_TEST_WINDOW) {
    const answer = settleSession(http, me);
    const store = TestBed.inject(ShowBuilderStore);
    const save = TestBed.inject(ShowSaveFlow);
    const library = TestBed.inject(ShowLibraryFlow);
    TestBed.tick();
    // The library lists my shells once the session is ready with canWrite.
    if (me !== 'pending' && me !== 'error' && me.canWrite) {
      http.expectOne(LIST).flush({ items: [], page: 1, pageSize: 24, totalCount: 0 });
    }
    ledger.length = 0;
    return { store, save, library, answer };
  }

  describe('Save (6f)', () => {
    it('an empty show: the note, and Save sends nothing (6f.2)', () => {
      const { save } = setup();
      expect(save.cannotSave()).toBe(EMPTY_SAVE_NOTE);
      save.save('save');
      expect(ledger).toEqual([]);
      // Blocked before validation: no "server didn't accept" status for a rule known up front.
      expect(save.status()).toBeNull();
    });

    it('fresh: one POST with exactly kind and document, a compact valid show (6f.3, 6f.5)', async () => {
      const { store, save } = setup();
      store.edit(doneWhenShow());
      store.addCue(embeddable(PRESETS[4])!, 30, 0.5);
      save.save('save');
      const req = http.expectOne('/api/creations');
      const body = req.request.body as { kind: string; document: Record<string, unknown> };
      expect(Object.keys(body).sort()).toEqual(['document', 'kind']);
      expect(body.kind).toBe('show');
      expect(Object.keys(body.document).sort()).toEqual(
        ['cues', 'duration', 'name', 'shells', 'sky', 'version'].sort(),
      );
      for (const cue of body.document['cues'] as Record<string, unknown>[]) {
        const keys = Object.keys(cue).sort();
        expect(keys.filter((k) => k !== 'burstHeight')).toEqual(['id', 'seed', 'shell', 't', 'x']);
      }
      for (const s of Object.values(body.document['shells'] as Record<string, object>)) {
        expect('sky' in s).toBe(false);
      }
      expect(JSON.stringify(body)).not.toContain('\n');
      req.flush(creationResponse({ kind: 'show', shareCode: CODE_B, document: body.document }), {
        status: 201,
        statusText: 'Created',
      });
      await flush();
      expect(ledger).toEqual(['POST /api/creations']);
      expect([
        store.dirty(),
        store.saved(),
        store.source()?.shareCode,
        store.source()?.kind,
      ]).toEqual([false, true, CODE_B, 'show']);
    });

    it('owned: Update original is a PUT, Save as new a remix; bodies are only document (6f.5)', async () => {
      const { store, save } = setup();
      store.openWorkingCopy({ show: doneWhenShow(), source: OWNED });
      expect(save.choices()).toEqual(['update', 'saveAsNew']);
      save.save('update');
      const put = http.expectOne(`/api/creations/${CODE_A}`);
      expect(put.request.method).toBe('PUT');
      expect(Object.keys(put.request.body)).toEqual(['document']);
      put.flush(creationResponse({ kind: 'show' }));
      await flush();
      store.moveCue('c4', 4);
      save.save('saveAsNew');
      const remix = http.expectOne(`/api/creations/${CODE_A}/remix`);
      expect(Object.keys(remix.request.body)).toEqual(['document']);
      remix.flush(creationResponse({ kind: 'show', shareCode: CODE_B }), {
        status: 201,
        statusText: 'Created',
      });
      await flush();
      expect(ledger).toEqual([
        `PUT /api/creations/${CODE_A}`,
        `POST /api/creations/${CODE_A}/remix`,
      ]);
    });

    it('non-owner: exactly one remix, no PUT (spec only)', async () => {
      const { store, save } = setup();
      store.openWorkingCopy({ show: doneWhenShow(), source: { ...OWNED, isOwner: false } });
      save.save('save');
      http
        .expectOne(`/api/creations/${CODE_A}/remix`)
        .flush(creationResponse({ kind: 'show', shareCode: CODE_B }), {
          status: 201,
          statusText: 'Created',
        });
      await flush();
      expect(ledger).toEqual([`POST /api/creations/${CODE_A}/remix`]);
    });

    it('PUT 404 asks (source null, nothing else sent); remix 404 falls back once (6f.6)', async () => {
      const { store, save } = setup();
      store.openWorkingCopy({ show: doneWhenShow(), source: OWNED });
      save.save('update');
      http.expectOne(`/api/creations/${CODE_A}`).flush(null, { status: 404, statusText: 'NF' });
      await flush();
      expect([store.source(), save.status()?.actions]).toEqual([null, ['saveAsNew']]);
      expect(save.status()?.text).toContain('keep your show with a new share link');
      expect(ledger).toEqual([`PUT /api/creations/${CODE_A}`]);
    });

    it('a 400 reads issues in field language, and the draft is byte-identical (6f.7)', async () => {
      const { store, save } = setup();
      store.edit(doneWhenShow());
      TestBed.tick();
      await wait(SHOW_DRAFT_DEBOUNCE_MS);
      const before = storage.getItem(SHOW_DRAFT_KEY);
      // The debounced draft was written, so the byte-identical check below compares a real draft.
      expect(before).not.toBeNull();
      save.save('save');
      http.expectOne('/api/creations').flush(
        {
          message: 'x',
          truncated: true,
          errors: [
            { path: 'cues[3].seed', code: 'type', message: '' },
            { path: 'duration', code: 'out-of-range', message: '' },
            { path: 'shells.s1.breaks[0].stars', code: 'not-integer', message: '' },
          ],
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await flush();
      const text = save.status()!.text;
      expect(text).toContain(`Seed (Cue at ${formatTime(store.show().cues[3].t)})`);
      expect(text).toContain('Duration is outside 1 to 600');
      expect(text).toContain('Stars (⁨Crossette⁩, Break 1) must be a whole number');
      expect(text).toContain('Your show is kept in this browser.');
      expect(text).not.toMatch(/cues\[|shells\./);
      await wait(SHOW_DRAFT_DEBOUNCE_MS);
      expect(storage.getItem(SHOW_DRAFT_KEY)).toBe(before);
      expect(TestBed.inject(NotificationService).notifications()).toEqual([]);
    });

    it('writes off: no save choices are sent (6f.1)', () => {
      const { store, save } = setup(ME_READ_ONLY);
      store.edit(doneWhenShow());
      save.save('save');
      expect(save.canWrite()).toBe(false);
      expect(ledger).toEqual([]);
    });
  });

  // Toad, Phase 6 review-fix (Peach 6a.4, 6f.9): the builder's Share had no spec.
  describe('Share (6f.9)', () => {
    let writeText: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });
    afterEach(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    const toasts = () =>
      TestBed.inject(NotificationService)
        .notifications()
        .map((n) => [n.kind, n.message]);

    async function saved() {
      const ctx = setup();
      ctx.store.edit(doneWhenShow());
      ctx.save.save('save');
      http
        .expectOne('/api/creations')
        .flush(creationResponse({ kind: 'show', shareCode: CODE_B }), {
          status: 201,
          statusText: 'Created',
        });
      await flush();
      TestBed.inject(NotificationService).notifications.set([]);
      ledger.length = 0;
      return ctx;
    }

    it('after a save: copies exactly {origin}/s/{code}, the plain toast, no request', async () => {
      const { save } = await saved();
      expect(await save.share()).toBe('copied');
      expect(writeText.mock.calls).toEqual([[`${location.origin}/s/${CODE_B}`]]);
      expect(writeText.mock.calls[0][0]).toMatch(/^https?:\/\/[^/]+\/s\/[1-9A-HJ-NP-Za-km-z]{8}$/);
      expect(toasts()).toEqual([['success', SHARE_COPIED]]);
      expect(save.blockedLink()).toBeNull();
      expect(ledger).toEqual([]);
    });

    it('with unsaved changes: the same link, the caveat toast', async () => {
      const { store, save } = await saved();
      store.moveCue('c4', 4);
      expect(store.saved()).toBe(false);
      expect(await save.share()).toBe('copied');
      expect(writeText.mock.calls).toEqual([[`${location.origin}/s/${CODE_B}`]]);
      expect(toasts()).toEqual([['success', SHARE_COPIED_UNSAVED]]);
      expect(ledger).toEqual([]);
    });

    it('a blocked clipboard: the link is offered, no toast; the next edit removes it', async () => {
      writeText.mockRejectedValue(new Error('denied'));
      const { store, save } = await saved();
      expect(await save.share()).toBe('blocked');
      expect(save.blockedLink()).toBe(`${location.origin}/s/${CODE_B}`);
      expect(toasts()).toEqual([]);
      store.moveCue('c4', 4);
      TestBed.tick();
      expect(save.blockedLink()).toBeNull();
      expect(ledger).toEqual([]);
    });

    it('no source: nothing is copied, no toast, no request', async () => {
      const { store, save } = setup();
      store.edit(doneWhenShow());
      expect(await save.share()).toBe('none');
      expect(writeText).not.toHaveBeenCalled();
      expect(toasts()).toEqual([]);
      expect(ledger).toEqual([]);
    });
  });

  describe('My shells (6d.2, 6e)', () => {
    // Toad, Phase 6 review-fix (Peach 6e.1): Show more had no spec.
    it('Show more requests page=2 with the same other params and appends it; then nothing more', () => {
      settleSession(http, ME_TEST_WINDOW);
      const library = TestBed.inject(ShowLibraryFlow);
      TestBed.tick();
      const item = (i: number) => ({
        shareCode: `Mine${'23456789ABCDEFGH'[i >> 4]}${'23456789ABCDEFGH'[i & 15]}xy`,
        kind: 'shell' as const,
        name: `Mine ${i}`,
        updatedAt: '2026-11-14T10:00:00Z',
        palette: [],
      });
      const first = Array.from({ length: MY_SHELLS_PAGE_SIZE }, (_, i) => item(i));
      const second = Array.from({ length: 6 }, (_, i) => item(MY_SHELLS_PAGE_SIZE + i));
      http.expectOne(LIST).flush({ items: first, page: 1, pageSize: 24, totalCount: 30 });
      expect(library.state()).toEqual({ status: 'ready', items: first, page: 1, more: true });
      ledger.length = 0;
      library.showMore();
      const page2 = `/api/me/creations?page=2&pageSize=${MY_SHELLS_PAGE_SIZE}&kind=shell`;
      expect(library.state()).toEqual({ status: 'loading', items: first });
      http.expectOne(page2).flush({ items: second, page: 2, pageSize: 24, totalCount: 30 });
      expect(ledger).toEqual([`GET ${page2}`]);
      expect(library.state()).toEqual({
        status: 'ready',
        items: [...first, ...second],
        page: 2,
        more: false,
      });
      library.showMore();
      expect(ledger).toEqual([`GET ${page2}`]);
    });

    it('api/me pending: nothing; then canWrite true: exactly one list GET with kind=shell (6e.1, 6e.3)', () => {
      const answer = settleSession(http, 'pending');
      ledger.length = 0;
      const library = TestBed.inject(ShowLibraryFlow);
      TestBed.tick();
      expect(ledger).toEqual([]);
      expect(library.state().status).toBe('hidden');
      answer(ME_TEST_WINDOW);
      TestBed.tick();
      http.expectOne(LIST).flush({ items: [], page: 1, pageSize: 24, totalCount: 0 });
      expect(ledger).toEqual([`GET ${LIST}`]);
      expect(library.state().status).toBe('ready');
    });

    it('canWrite false or api/me failed: no list request, hidden (6e.2)', () => {
      for (const me of [ME_READ_ONLY, 'error'] as const) {
        settleSession(http, me);
        ledger.length = 0;
        const library = TestBed.inject(ShowLibraryFlow);
        TestBed.tick();
        expect(ledger).toEqual([]);
        expect(library.state().status).toBe('hidden');
      }
    });

    it('adding one of my shells is exactly one GET, without sky; a 404 adds nothing and says so', async () => {
      const { library, store } = setup();
      const item = {
        shareCode: CODE_B,
        kind: 'shell' as const,
        name: 'Mine',
        updatedAt: 'x',
        palette: [],
      };
      let got: unknown = null;
      library.fetchShell(item).subscribe((r) => (got = r));
      http.expectOne(`/api/creations/${CODE_B}`).flush(creationResponse({ shareCode: CODE_B }));
      expect(ledger).toEqual([`GET /api/creations/${CODE_B}`]);
      expect(got).toEqual(expect.objectContaining({ name: 'Willow' }));
      expect('sky' in (got as object)).toBe(false);

      ledger.length = 0;
      library.fetchShell(item).subscribe((r) => (got = r));
      http.expectOne(`/api/creations/${CODE_B}`).flush(null, { status: 404, statusText: 'NF' });
      expect(got).toBe('gone');
      expect(library.itemFailure()).toEqual({ code: CODE_B, name: 'Mine', failure: 'gone' });
      expect(store.show().cues).toEqual([]);
      expect(TestBed.inject(NotificationService).notifications()).toEqual([]);
    });
  });
});
