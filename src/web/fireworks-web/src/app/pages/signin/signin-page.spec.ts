import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { BROWSER_STORAGE } from '../../core/browser';
import { ClientConfigStore } from '../../core/client-config';
import type { MeResponse } from '../../core/models';
import {
  SIGN_IN_INTENT_KEY,
  setSignInNavigationForTesting,
  writeSignInIntent,
} from '../../core/sign-in';
import { STAGE_RENDERER_FACTORY } from '../../shared/fireworks-stage/fireworks-stage';
import { ME_ADA, ME_ANONYMOUS, recorder, settleSession } from '../../testing/creation-fixtures';
import { FakeStageRenderers } from '../../testing/fake-stage-renderer';
import { MemoryStorage } from '../../testing/memory-storage';
import { backTargetOf } from './signin-page';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** `/signin` (phase-8.md §9.4; Boo A5). */
describe('/signin', () => {
  let http: HttpTestingController;
  let ledger: string[];
  let navigations: string[];
  let restore: () => void;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ledger = [];
    navigations = [];
    restore = setSignInNavigationForTesting((u) => navigations.push(u));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([recorder(ledger)])),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: STAGE_RENDERER_FACTORY, useValue: new FakeStageRenderers().factory },
        { provide: BROWSER_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    restore();
    sessionStorage.clear();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  async function visit(url: string, me: MeResponse = ME_ANONYMOUS) {
    settleSession(http, me);
    ledger.length = 0;
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(url);
    await tick();
    await harness.fixture.whenStable();
    await tick();
    const root = harness.fixture.nativeElement as HTMLElement;
    const by = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return { root, by };
  }

  it.each([
    ['cancelled', 'Sign-in was cancelled', 'Nothing changed. Your work is still in this browser.'],
    [
      'failed',
      "Sign-in didn't finish",
      "Google didn't complete the sign-in. Try again in a moment. Your work is still in this browser.",
    ],
    [
      null,
      'Sign in to Fireworks Sandbox',
      'Sign in to save shells and shows and see My creations. You can design and play without signing in.',
    ],
  ])(
    'error=%s: the heading, the body, the Google button and Go back; the h1 focused',
    async (error, heading, body) => {
      const q = error ? `?error=${error}&returnUrl=%2Fshow` : '?returnUrl=%2Fshow';
      const { by } = await visit(`/signin${q}`);
      expect(by('message-heading')?.textContent?.trim()).toBe(heading);
      expect(by('message-page')?.textContent).toContain(body);
      expect(document.activeElement).toBe(by('message-heading'));
      expect(by('signin-back')?.textContent?.trim()).toBe('Back to the Show Builder');
      expect(by('signin-back')?.getAttribute('href')).toBe('/show');
      expect(TestBed.inject(Title).getTitle()).toBe('Sign in · Fireworks Sandbox');
      expect(ledger).toEqual([]);
    },
  );

  it('no returnUrl: Go to the designer; the button returns to /', async () => {
    const { by } = await visit('/signin?error=failed');
    expect(by('signin-back')?.textContent?.trim()).toBe('Go to the designer');
    expect(by('signin-back')?.getAttribute('href')).toBe('/');
    by('google-sign-in')!.click();
    expect(navigations).toEqual(['/api/auth/login/google?returnUrl=%2F']);
  });

  it.each([
    ['//evil.example', '%2F', '/'],
    ['/api/auth/logout', '%2F', '/'],
    ['https://evil.example/x', '%2F', '/'],
    ['/mine?page=2', '%2Fmine%3Fpage%3D2', '/mine'],
  ])(
    'returnUrl %s: re-checked (A5); passed on encoded as %s; Go back to %s',
    async (raw, sent, back) => {
      const { by } = await visit(`/signin?error=cancelled&returnUrl=${encodeURIComponent(raw)}`);
      expect(by('signin-back')?.getAttribute('href')).toBe(back);
      by('google-sign-in')!.click();
      expect(navigations).toEqual([`/api/auth/login/google?returnUrl=${sent}`]);
    },
  );

  it("the marker's from is kept and written again on a retry (a Save prompt stays a Save prompt)", async () => {
    writeSignInIntent('save', '/show');
    const { by } = await visit('/signin?error=cancelled&returnUrl=%2Fshow');
    expect(sessionStorage.getItem(SIGN_IN_INTENT_KEY)).toBeNull();
    by('google-sign-in')!.click();
    expect(JSON.parse(sessionStorage.getItem(SIGN_IN_INTENT_KEY)!)).toMatchObject({
      from: 'save',
      path: '/show',
    });
  });

  it('no providers: "Sign-in isn\'t available right now" and only Go back', async () => {
    TestBed.inject(ClientConfigStore).setLoginProviders([]);
    const { by } = await visit('/signin?error=failed');
    expect(by('message-heading')?.textContent?.trim()).toBe("Sign-in isn't available right now");
    expect(by('google-sign-in')).toBeNull();
    expect(by('signin-back')).not.toBeNull();
  });

  it('already signed in: replaced by the literal route for the checked returnUrl', async () => {
    await visit('/signin?returnUrl=%2Fshow%3Fx%3D1', ME_ADA);
    await tick();
    expect(TestBed.inject(Router).url).toBe('/show');
    expect(navigations).toEqual([]);
  });

  it('backTargetOf maps only three literal routes', () => {
    expect(
      ['/', '/show', '/show?x', '/mine', '/mine?page=2', '/c/abc', '/showy', '/s/x'].map(
        backTargetOf,
      ),
    ).toEqual(['/', '/show', '/show', '/mine', '/mine', '/', '/', '/']);
  });
});
