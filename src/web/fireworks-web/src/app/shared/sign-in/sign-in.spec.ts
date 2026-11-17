import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClientConfigStore } from '../../core/client-config';
import { SessionService } from '../../core/session';
import { setSignInNavigationForTesting } from '../../core/sign-in';
import { SaveBarComponent } from '../save-bar/save-bar';
import { AccountControlComponent } from './account-control';
import { GoogleSignInButtonComponent } from './google-sign-in-button';
import { SignInDialogComponent } from './sign-in-dialog';

/** phase-8.md §2, §3, §5.1, §5.3 (Rosalina R1–R4; Boo A40). */
describe('sign-in components', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function make<T>(type: Type<T>, inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(type);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      by: (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`),
    };
  }

  it('the save bar signed out (prompt): one Save that emits signIn only; no indicator; the note', async () => {
    const { fixture, by } = await make(SaveBarComponent, {
      prompt: true,
      choices: ['update', 'saveAsNew'],
      source: { shareCode: 'Ab3dEf7h', kind: 'shell', isOwner: true, updatedAt: 't', name: 'n' },
      dirty: true,
    });
    const saves: unknown[] = [];
    const prompts: unknown[] = [];
    fixture.componentInstance.save.subscribe((c) => saves.push(c));
    fixture.componentInstance.signIn.subscribe(() => prompts.push(1));
    expect(by('save-update')).toBeNull();
    expect(by('save-indicator')).toBeNull();
    expect(by('save-note')?.textContent?.trim()).toBe(
      'Sign in to save and get a share link. Your work is kept in this browser.',
    );
    by('save-save')!.click();
    expect([saves, prompts]).toEqual([[], [1]]);
  });

  it("the save bar: an empty show's note wins signed out, and Save is disabled", async () => {
    const { by } = await make(SaveBarComponent, { prompt: true, cannotSaveNote: 'Add a cue.' });
    expect(by('save-note')?.textContent?.trim()).toBe('Add a cue.');
    expect((by('save-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the save bar with neither canWrite nor prompt renders no save button', async () => {
    const { by } = await make(SaveBarComponent, {});
    expect(by('save-save')).toBeNull();
  });

  it('the save bar busy (refresh): buttons aria-disabled and presses held', async () => {
    const { fixture, by } = await make(SaveBarComponent, { canWrite: true, busy: true });
    const saves: unknown[] = [];
    fixture.componentInstance.save.subscribe((c) => saves.push(c));
    expect(by('save-save')?.getAttribute('aria-disabled')).toBe('true');
    by('save-save')!.click();
    expect(saves).toEqual([]);
  });

  it('the Google button: Light theme literals, the text, an inline G, nothing fetched; one press only', async () => {
    const navigations: string[] = [];
    const restore = setSignInNavigationForTesting((u) => navigations.push(u));
    try {
      const flushes: number[] = [];
      const { el, by } = await make(GoogleSignInButtonComponent, {
        from: 'save',
        returnPath: '/show',
        beforeLeave: () => flushes.push(1),
      });
      const b = by('google-sign-in')!;
      expect(b.tagName).toBe('BUTTON');
      expect(b.textContent?.trim()).toBe('Sign in with Google');
      expect(b.getAttribute('aria-label')).toBeNull();
      expect(b.className).toContain('bg-[#FFFFFF]');
      expect(b.className).toContain('border-[#747775]');
      expect(b.className).toContain('text-[#1F1F1F]');
      // The G: Google's bundle SVG served same-origin (phase-8.md §15.1), decorative, never inlined.
      const g = b.querySelectorAll('img');
      expect(g).toHaveLength(1);
      expect(g[0].getAttribute('src')).toBe('brand/google-g.svg');
      expect(g[0].getAttribute('alt')).toBe('');
      expect([g[0].getAttribute('width'), g[0].getAttribute('height')]).toEqual(['20', '20']);
      expect(el.querySelector('svg, link, script')).toBeNull();
      b.click();
      b.click();
      expect(flushes).toEqual([1]);
      expect(navigations).toEqual(['/api/auth/login/google?returnUrl=%2Fshow']);
    } finally {
      restore();
      sessionStorage.clear();
    }
  });

  it('the dialog: Not now first, the Google button focused; one close', async () => {
    const { fixture, el, by } = await make(SignInDialogComponent, {
      variant: 'save',
      noun: 'shell',
    });
    await fixture.whenStable();
    const buttons = [...el.querySelectorAll('button')].map((b) => b.dataset['testid']);
    expect(buttons).toEqual(['sign-in-not-now', 'google-sign-in']);
    expect(document.activeElement).toBe(by('google-sign-in'));
    expect(el.querySelector('dialog')?.getAttribute('role')).toBeNull();
    expect(el.querySelector('dialog')?.getAttribute('aria-describedby')).toBe(
      'sign-in-body-0 sign-in-body-1',
    );
    const closes: number[] = [];
    fixture.componentInstance.closed.subscribe(() => closes.push(1));
    by('sign-in-not-now')!.click();
    el.querySelector('dialog')!.dispatchEvent(new Event('close'));
    expect(closes).toEqual([1]);
  });

  it('the dialog, no providers: "Sign-in isn\'t available right now" and one focused Close', async () => {
    TestBed.inject(ClientConfigStore).setLoginProviders([]);
    const { el, by } = await make(SignInDialogComponent, { variant: 'save', noun: 'show' });
    expect(el.querySelector('h2')?.textContent?.trim()).toBe("Sign-in isn't available right now");
    expect(by('sign-in-line-0')?.textContent?.trim()).toBe(
      "Saving needs a sign-in, and it's switched off on this site at the moment. Your show is kept in this browser.",
    );
    expect(by('google-sign-in')).toBeNull();
    expect(document.activeElement).toBe(by('sign-in-close'));
  });

  it('the dialog, client-config failed: unavailable too; while loading: available', async () => {
    const config = TestBed.inject(ClientConfigStore);
    expect(config.signInAvailable()).toBe(true);
    config.setLoginProviders([{ id: 'google', name: 'Google' }]);
    expect(config.signInAvailable()).toBe(true);
    config.setLoginProviders([{ id: 'github', name: 'GitHub' }, 'junk']);
    expect(config.signInAvailable()).toBe(false);
    config.setConfigFailed();
    expect(config.signInAvailable()).toBe(false);
  });

  it('the account control: nothing while loading; a blank name reads "Signed in"', async () => {
    const http = TestBed.inject(HttpTestingController);
    const { fixture, el, by } = await make(AccountControlComponent);
    expect(el.textContent?.trim()).toBe('');
    TestBed.inject(SessionService).load().subscribe();
    http
      .expectOne('/api/me')
      .flush({ userId: 'u', displayName: '   ', isAuthenticated: true, canWrite: true });
    await fixture.whenStable();
    expect(by('account-name')?.textContent?.trim()).toBe('Signed in');
    expect(by('account-name')?.getAttribute('title')).toBe('Signed in with Google');
    expect(el.textContent).not.toContain('Google');
  });
});
