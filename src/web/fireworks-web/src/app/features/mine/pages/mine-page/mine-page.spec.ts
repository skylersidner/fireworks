import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../../app.routes';
import { authInterceptor } from '../../../../core/auth-interceptor';
import { BROWSER_STORAGE } from '../../../../core/browser';
import { ClientConfigStore } from '../../../../core/client-config';
import {
  SIGN_IN_INTENT_KEY,
  setSignInNavigationForTesting,
  writeSignInIntent,
} from '../../../../core/sign-in';
import type { CreationListItem, CreationListPage, MeResponse } from '../../../../core/models';
import { NotificationService } from '../../../../core/notifications';
import { STAGE_RENDERER_FACTORY } from '../../../../shared/fireworks-stage/fireworks-stage';
import {
  CODE_A,
  CODE_B,
  CODE_C,
  ME_ADA,
  ME_ANONYMOUS,
  ME_READ_ONLY,
  ME_SIGNED_IN,
  ME_TEST_WINDOW,
  recorder,
  settleSession,
} from '../../../../testing/creation-fixtures';
import { FakeStageRenderers } from '../../../../testing/fake-stage-renderer';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { relativeTime } from './mine-page';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const LIST = (page: number) => `/api/me/creations?page=${page}&pageSize=24`;

function item(overrides: Partial<CreationListItem> = {}): CreationListItem {
  return {
    shareCode: CODE_A,
    kind: 'shell',
    name: 'Willow 2',
    updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    palette: ['gold', 'red', 'rainbow'],
    ...overrides,
  };
}

function page(items: CreationListItem[], totalCount = items.length, p = 1): CreationListPage {
  return { items, page: p, pageSize: 24, totalCount };
}

/** My creations at `/mine` (plan Phase 5; phase-5.md §10; acceptance 5g; Peach N1; Boo C1–C4, C9). */
describe('My creations /mine', () => {
  let http: HttpTestingController;
  let ledger: string[];
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    ledger = [];
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor, recorder(ledger)])),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: BROWSER_STORAGE, useValue: new MemoryStorage() },
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

  async function visit(me: MeResponse | 'pending' | 'error', url = '/mine') {
    const answer = settleSession(http, me);
    ledger.length = 0;
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(url);
    const root = harness.fixture.nativeElement as HTMLElement;
    const byTest = <T extends HTMLElement = HTMLElement>(id: string) =>
      root.querySelector<T>(`[data-testid="${id}"]`);
    const all = (id: string) => [...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
    const stable = async () => {
      await tick();
      await harness.fixture.whenStable();
      await tick();
      await harness.fixture.whenStable();
    };
    await stable();
    return { harness, root, byTest, all, stable, answer };
  }

  describe('write switch and the session (5g.1, 5g.2; Peach N1)', () => {
    it('api/me pending: neither the list nor "unavailable"; then true → exactly one list GET', async () => {
      const { byTest, stable, answer } = await visit('pending');
      expect(byTest('message-page')).toBeNull();
      expect(ledger).toEqual([]);
      answer(ME_TEST_WINDOW);
      await stable();
      http.expectOne(LIST(1)).flush(page([item()]));
      await stable();
      expect(ledger).toEqual([`GET ${LIST(1)}`]);
      expect(byTest('mine-card')).not.toBeNull();
    });

    it('api/me pending, then signed out: the sign-in prompt in place, and no list GET (A44 as a page rule)', async () => {
      const { byTest, stable, answer, harness } = await visit('pending');
      answer(ME_ANONYMOUS);
      await stable();
      expect(byTest('message-heading')?.textContent?.trim()).toBe('My creations');
      expect(byTest('message-page')?.textContent).toContain(
        "Sign in to see the shells and shows you've saved. You can design and play without signing in; your work is kept in this browser.",
      );
      expect(byTest('google-sign-in')?.textContent?.trim()).toBe('Sign in with Google');
      expect(byTest('message-home')?.getAttribute('href')).toBe('/');
      expect(document.activeElement).toBe(byTest('message-heading'));
      // In place: no redirect.
      expect(TestBed.inject(Router).url).toBe('/mine');
      expect(harness).toBeTruthy();
      expect(ledger).toEqual([]);
      expect(TestBed.inject(NotificationService).notifications()).toEqual([]);
    });

    it("the prompt's Google button returns to /mine with its page, from: nav; nothing else is sent", async () => {
      const navigations: string[] = [];
      const restore = setSignInNavigationForTesting((u) => navigations.push(u));
      try {
        const { byTest, stable } = await visit(ME_ANONYMOUS, '/mine?page=2');
        byTest('google-sign-in')!.click();
        await stable();
        expect(navigations).toEqual(['/api/auth/login/google?returnUrl=%2Fmine%3Fpage%3D2']);
        expect(JSON.parse(sessionStorage.getItem(SIGN_IN_INTENT_KEY) ?? 'null')).toMatchObject({
          from: 'nav',
          path: '/mine?page=2',
        });
        expect(ledger).toEqual([]);
      } finally {
        restore();
        sessionStorage.clear();
      }
    });

    it('no sign-in providers: the unavailable body and only Go to the designer', async () => {
      TestBed.inject(ClientConfigStore).setLoginProviders([]);
      const { byTest } = await visit(ME_ANONYMOUS);
      expect(byTest('message-page')?.textContent).toContain(
        "Sign-in isn't available right now, so there's nothing to list here.",
      );
      expect(byTest('google-sign-in')).toBeNull();
      expect(ledger).toEqual([]);
    });

    it('back from sign-in: the toast, the list, the h1', async () => {
      writeSignInIntent('nav', '/mine');
      const { byTest, stable } = await visit(ME_ADA);
      http.expectOne(LIST(1)).flush(page([item()]));
      await stable();
      expect(
        TestBed.inject(NotificationService)
          .notifications()
          .map((n) => n.message),
      ).toEqual(['Signed in as Ada Lovelace.']);
      expect(document.activeElement).toBe(byTest('mine-heading'));
      expect(sessionStorage.getItem(SIGN_IN_INTENT_KEY)).toBeNull();
      expect(ledger).toEqual([`GET ${LIST(1)}`]);
    });

    it('Sign out on /mine: logout, one api/me, the prompt with its h1 focused', async () => {
      const { byTest, stable } = await visit(ME_ADA);
      http.expectOne(LIST(1)).flush(page([item()]));
      await stable();
      expect(byTest('account-name')?.textContent?.trim()).toBe('Ada Lovelace');
      byTest('account-sign-out')!.click();
      await stable();
      http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      await stable();
      http.expectOne('/api/me').flush(ME_ANONYMOUS);
      await stable();
      expect(ledger).toEqual([`GET ${LIST(1)}`, 'POST /api/auth/logout', 'GET /api/me']);
      expect(byTest('message-heading')?.textContent?.trim()).toBe('My creations');
      expect(document.activeElement).toBe(byTest('message-heading'));
    });

    it("api/me failed: the can't-reach copy; Try again reloads the session", async () => {
      const { byTest, stable } = await visit('error');
      expect(byTest('message-heading')?.textContent?.trim()).toBe("Can't reach the server.");
      byTest('message-retry')!.click();
      await stable();
      http.expectOne('/api/me').flush(ME_TEST_WINDOW);
      await stable();
      http.expectOne(LIST(1)).flush(page([]));
      expect(ledger).toEqual(['GET /api/me', `GET ${LIST(1)}`]);
    });

    it('a 401 from the list: one api/me reload, then the prompt; never a retry (A41)', async () => {
      const { byTest, stable } = await visit(ME_ADA);
      http.expectOne(LIST(1)).flush(null, { status: 401, statusText: 'Unauthorized' });
      await stable();
      http.expectOne('/api/me').flush(ME_ANONYMOUS);
      await stable();
      expect(ledger).toEqual([`GET ${LIST(1)}`, 'GET /api/me']);
      expect(byTest('message-heading')?.textContent?.trim()).toBe('My creations');
      expect(byTest('google-sign-in')).not.toBeNull();
    });
  });

  describe('cards (5g.3; Boo C1–C4)', () => {
    it('both kinds in one grid, in server order, with the kind word; no kind in the ledger (6j.1, D4)', async () => {
      const { all, root, stable } = await visit(ME_TEST_WINDOW);
      http
        .expectOne(LIST(1))
        .flush(page([item({ kind: 'show', name: 'A show' }), item({ shareCode: CODE_B })]));
      await stable();
      expect(ledger).toEqual(['GET /api/me/creations?page=1&pageSize=24']);
      const metas = all('mine-card').map((c) =>
        c.querySelector('p')!.textContent!.replace(/\s+/g, ' ').trim(),
      );
      expect(metas.map((m) => m.split(' ·')[0])).toEqual(['Show', 'Shell']);
      expect(all('card-open').map((a) => a.getAttribute('href'))).toEqual([
        `/c/${CODE_A}`,
        `/c/${CODE_B}`,
      ]);
      expect(root.textContent).toContain(
        "Shells and shows you've saved. Anyone with a share link can play it; nothing here is listed publicly.",
      );
      expect(root.querySelector('a[data-testid="nav-show"]')!.getAttribute('href')).toBe('/show');
    });

    it('one card per item in order, name as text in a bdi, swatches, links from the code', async () => {
      const { all, root, stable } = await visit(ME_TEST_WINDOW);
      http.expectOne(LIST(1)).flush(
        page([
          item({ name: '<img src=x onerror=alert(1)>' }),
          item({
            shareCode: CODE_B,
            name: 'https://evil.example',
            palette: ['cyan', 'ultraviolet'],
          }),
        ]),
      );
      await stable();
      const names = all('card-name').map((n) => n.textContent);
      expect(names).toEqual(['<img src=x onerror=alert(1)>', 'https://evil.example']);
      expect(all('card-name').every((n) => n.tagName === 'BDI')).toBe(true);
      expect(root.querySelector('img')).toBeNull();
      expect(all('card-open').map((a) => a.getAttribute('href'))).toEqual([
        `/c/${CODE_A}`,
        `/c/${CODE_B}`,
      ]);
      expect(all('card-play').map((a) => a.getAttribute('href'))).toEqual([
        `/s/${CODE_A}`,
        `/s/${CODE_B}`,
      ]);
      const swatchRows = [...root.querySelectorAll('[role="img"]')];
      expect(swatchRows.map((r) => r.getAttribute('aria-label'))).toEqual([
        'Colors: Gold, Red, Rainbow',
        'Colors: Cyan',
      ]);
      expect(swatchRows[0].querySelectorAll('span')).toHaveLength(3);
      expect(root.querySelector('canvas')).toBeNull();
      expect(fakes.starts).toHaveLength(0);
      expect(all('card-delete')[0].getAttribute('aria-label')).toBe(
        'Delete “\u2068<img src=x onerror=alert(1)>\u2069”',
      );
    });

    it('an item whose share code fails the pattern is skipped', async () => {
      const { all, stable } = await visit(ME_TEST_WINDOW);
      http
        .expectOne(LIST(1))
        .flush(page([item({ shareCode: '../me' }), item({ shareCode: CODE_B })]));
      await stable();
      expect(all('card-open').map((a) => a.getAttribute('href'))).toEqual([`/c/${CODE_B}`]);
    });

    it('no test-mode banner in any state (Boo A42)', async () => {
      const { byTest, stable } = await visit(ME_SIGNED_IN);
      http.expectOne(LIST(1)).flush(page([]));
      await stable();
      expect(byTest('test-mode-banner')).toBeNull();
    });
  });

  describe('paging and empty (5g.4)', () => {
    it('the h1 takes focus on load (§12.1; Rosalina D1)', async () => {
      const { byTest, stable } = await visit(ME_TEST_WINDOW);
      expect(document.activeElement).toBe(byTest('mine-heading'));
      http.expectOne(LIST(1)).flush(page([item()]));
      await stable();
      expect(document.activeElement).toBe(byTest('mine-heading'));
    });

    it('totalCount 0: the empty state, no page controls', async () => {
      const { byTest, stable } = await visit(ME_TEST_WINDOW);
      http.expectOne(LIST(1)).flush(page([], 0));
      await stable();
      expect(byTest('mine-empty')?.textContent).toContain('Nothing saved yet');
      expect(byTest('mine-pages')).toBeNull();
    });

    it.each([
      [24, null],
      [25, 'Page 1 of 2'],
      [49, 'Page 1 of 3'],
    ])('totalCount %i → %s', async (total, label) => {
      const { byTest, stable } = await visit(ME_TEST_WINDOW);
      http.expectOne(LIST(1)).flush(page([item()], total));
      await stable();
      expect(byTest('page-label')?.textContent?.trim() ?? null).toBe(label);
    });

    it('Next requests page 2 once, puts it in the URL and announces it', async () => {
      const { byTest, stable } = await visit(ME_TEST_WINDOW);
      http.expectOne(LIST(1)).flush(page([item()], 30));
      await stable();
      byTest('page-next')!.click();
      await stable();
      http.expectOne(LIST(2)).flush(page([item({ shareCode: CODE_B })], 30, 2));
      await stable();
      expect(TestBed.inject(Router).url).toBe('/mine?page=2');
      expect(byTest('mine-announcer')?.textContent?.trim()).toBe('Page 2 of 2.');
      expect(ledger).toEqual([`GET ${LIST(1)}`, `GET ${LIST(2)}`]);
    });

    it('a page that is not a positive integer reads as 1', async () => {
      const { stable } = await visit(ME_TEST_WINDOW, '/mine?page=abc');
      http.expectOne(LIST(1)).flush(page([item()]));
      await stable();
      expect(TestBed.inject(Router).url).toBe('/mine');
    });

    it('a page past the end goes to the last page', async () => {
      const { stable } = await visit(ME_TEST_WINDOW, '/mine?page=9');
      http.expectOne(LIST(9)).flush(page([], 30, 9));
      await stable();
      http.expectOne(LIST(2)).flush(page([item()], 30, 2));
      await stable();
      expect(TestBed.inject(Router).url).toBe('/mine?page=2');
    });
  });

  describe('Delete (5g.6; phase-5.md §10.4)', () => {
    async function askDelete() {
      const v = await visit(ME_TEST_WINDOW);
      http
        .expectOne(LIST(1))
        .flush(
          page([item(), item({ shareCode: CODE_B, name: 'Second' }), item({ shareCode: CODE_C })]),
        );
      await v.stable();
      v.all('card-delete')[0].click();
      await v.stable();
      return v;
    }

    it('asks with the spec copy; Keep it sends nothing', async () => {
      const { byTest, stable } = await askDelete();
      expect(byTest('confirm-dialog')?.querySelector('h2')?.textContent).toBe(
        'Delete “\u2068Willow 2\u2069”?',
      );
      expect(byTest('confirm-dialog')?.querySelector('p')?.textContent).toBe(
        "Its share link will stop working for everyone you've sent it to. This can't be undone.",
      );
      expect(byTest('confirm-accept')?.classList).toContain('btn-danger');
      expect(document.activeElement).toBe(byTest('confirm-cancel'));
      byTest('confirm-cancel')!.click();
      await stable();
      expect(ledger).toEqual([`GET ${LIST(1)}`]);
    });

    it('204: exactly one DELETE, a toast, the page re-fetched, focus to the next card', async () => {
      const { byTest, all, stable } = await askDelete();
      byTest('confirm-accept')!.click();
      await stable();
      http
        .expectOne(`/api/creations/${CODE_A}`)
        .flush(null, { status: 204, statusText: 'No Content' });
      await stable();
      http
        .expectOne(LIST(1))
        .flush(page([item({ shareCode: CODE_B, name: 'Second' }), item({ shareCode: CODE_C })]));
      await stable();
      expect(ledger).toEqual([
        `GET ${LIST(1)}`,
        `DELETE /api/creations/${CODE_A}`,
        `GET ${LIST(1)}`,
      ]);
      expect(
        TestBed.inject(NotificationService)
          .notifications()
          .map((n) => n.message),
      ).toEqual(['Deleted “\u2068Willow 2\u2069”.']);
      expect(all('mine-card')).toHaveLength(2);
      expect(document.activeElement).toBe(all('card-open')[0]);
    });

    it('404: it is already gone, so it is a success', async () => {
      const { byTest, stable } = await askDelete();
      byTest('confirm-accept')!.click();
      await stable();
      http
        .expectOne(`/api/creations/${CODE_A}`)
        .flush({ message: 'x' }, { status: 404, statusText: 'x' });
      await stable();
      http.expectOne(LIST(1)).flush(page([]));
      expect(
        TestBed.inject(NotificationService)
          .notifications()
          .map((n) => n.message),
      ).toEqual(['“\u2068Willow 2\u2069” was already deleted.']);
    });

    it('500: an error toast; the card stays', async () => {
      const { byTest, all, stable } = await askDelete();
      byTest('confirm-accept')!.click();
      await stable();
      http.expectOne(`/api/creations/${CODE_A}`).flush(null, { status: 500, statusText: 'x' });
      await stable();
      expect(
        TestBed.inject(NotificationService)
          .notifications()
          .map((n) => n.message),
      ).toEqual([
        "Couldn't delete “\u2068Willow 2\u2069”: something went wrong on the server. Try again in a moment.",
      ]);
      expect(all('mine-card')).toHaveLength(3);
    });

    it('401: the error toast, the prompt replaces the page with its h1 focused; nothing retried', async () => {
      const { byTest, stable } = await askDelete();
      byTest('confirm-accept')!.click();
      await stable();
      http.expectOne(`/api/creations/${CODE_A}`).flush(null, { status: 401, statusText: 'x' });
      await stable();
      http.expectOne('/api/me').flush(ME_ANONYMOUS);
      await stable();
      expect(
        TestBed.inject(NotificationService)
          .notifications()
          .map((n) => n.message),
      ).toContain("You've been signed out, so nothing was deleted.");
      expect(byTest('message-heading')?.textContent?.trim()).toBe('My creations');
      expect(document.activeElement).toBe(byTest('message-heading'));
      expect(ledger.filter((l) => l.startsWith('DELETE'))).toHaveLength(1);
    });
  });

  describe('Share (5c.1 on a card)', () => {
    afterEach(() =>
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }),
    );

    it('copies the card link; no request', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { all, stable } = await visit(ME_TEST_WINDOW);
      http.expectOne(LIST(1)).flush(page([item()]));
      await stable();
      all('card-share')[0].click();
      await stable();
      expect(writeText).toHaveBeenCalledWith(`${location.origin}/s/${CODE_A}`);
      expect(
        TestBed.inject(NotificationService)
          .notifications()
          .map((n) => n.message),
      ).toEqual(['Share link copied.']);
      expect(ledger).toEqual([`GET ${LIST(1)}`]);
    });

    it('a blocked clipboard: the link field takes focus with the link selected (§5; Rosalina D2)', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { all, byTest, stable } = await visit(ME_TEST_WINDOW);
      http.expectOne(LIST(1)).flush(page([item()]));
      await stable();
      all('card-share')[0].click();
      await stable();
      const field = byTest<HTMLInputElement>('share-link-field')!;
      expect(field.value).toBe(`${location.origin}/s/${CODE_A}`);
      expect(document.activeElement).toBe(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    });
  });

  it('relative time: just now under a minute, then Intl wording', () => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    expect(relativeTime(now - 30_000, now)).toBe('just now');
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe(
      new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-3, 'day'),
    );
  });

  // K6 (phase-7.md §3.2; acceptance 7g.8) and R4's busy look on Delete (7g.19).
  describe('Phase 7 focus and busy look', () => {
    it('list-error Try again moves focus to the h1, then the list renders', async () => {
      const { byTest, stable } = await visit(ME_TEST_WINDOW);
      http.expectOne(LIST(1)).flush(null, { status: 500, statusText: 'x' });
      await stable();
      const retry = byTest('mine-error-retry')!;
      retry.focus();
      retry.click();
      await stable();
      expect(document.activeElement).toBe(byTest('mine-heading'));
      http.expectOne(LIST(1)).flush(page([item()]));
      await stable();
      expect(byTest('mine-card')).not.toBeNull();
    });

    it('Delete is busy (aria-disabled + .btn-busy) only while its delete is in flight', async () => {
      const { byTest, stable } = await visit(ME_TEST_WINDOW);
      http.expectOne(LIST(1)).flush(page([item()]));
      await stable();
      const del = byTest('card-delete')!;
      expect(del.classList.contains('btn-busy')).toBe(false);
      del.click();
      await stable();
      byTest('confirm-accept')!.click();
      await stable();
      expect([del.getAttribute('aria-disabled'), del.classList.contains('btn-busy')]).toEqual([
        'true',
        true,
      ]);
      http.expectOne(`/api/creations/${CODE_A}`).flush(null, { status: 500, statusText: 'x' });
      await stable();
      expect(del.classList.contains('btn-busy')).toBe(false);
    });
  });
});
