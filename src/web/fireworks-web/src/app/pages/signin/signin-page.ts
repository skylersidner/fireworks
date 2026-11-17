import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ClientConfigStore } from '../../core/client-config';
import { SessionService } from '../../core/session';
import { isSafeInternalUrl, takeSignInIntent, type SignInFrom } from '../../core/sign-in';
import { SITE_TITLE } from '../../shared/link-copy';
import { MessagePageComponent } from '../../shared/message-page/message-page';
import { GoogleSignInButtonComponent } from '../../shared/sign-in/google-sign-in-button';

export const SIGNIN_TITLE = `Sign in · ${SITE_TITLE}`;

/** Where `Go back` and an already-signed-in visit may go: literal routes only (Boo C14). */
export type BackTarget = '/' | '/show' | '/mine';

/** The page a checked return path belongs to; anything else is the designer. */
export function backTargetOf(returnPath: string): BackTarget {
  const path = returnPath.split(/[?#]/, 1)[0];
  if (path === '/show' || path.startsWith('/show/')) return '/show';
  if (path === '/mine' || path.startsWith('/mine/')) return '/mine';
  return '/';
}

interface SignInCopy {
  readonly heading: string;
  readonly body: readonly string[];
}

/** phase-8.md §9.4, verbatim. */
export function signInPageCopy(error: string | null, available: boolean): SignInCopy {
  if (!available) {
    return {
      heading: "Sign-in isn't available right now",
      body: ['Your work is still in this browser.'],
    };
  }
  if (error === 'cancelled') {
    return {
      heading: 'Sign-in was cancelled',
      body: ['Nothing changed. Your work is still in this browser.'],
    };
  }
  if (error === 'failed') {
    return {
      heading: "Sign-in didn't finish",
      body: [
        "Google didn't complete the sign-in. Try again in a moment. Your work is still in this browser.",
      ],
    };
  }
  return {
    heading: 'Sign in to Fireworks Sandbox',
    body: [
      'Sign in to save shells and shows and see My creations. You can design and play without signing in.',
    ],
  };
}

/**
 * `/signin` (phase-8.md §9.4; phase-8-auth.md §6.1): the landing page for a failed or cancelled
 * sign-in (`?error=cancelled|failed&returnUrl=…`, `returnUrl` possibly missing) and for a direct
 * visit. Not a guard target.
 *  - `returnUrl` is re-checked with `isSafeInternalUrl` (Boo A5). It is only ever passed on as the
 *    Google button's encoded `returnUrl` query value, or reduced to one of three literal routes for
 *    `Go back` and for the already-signed-in redirect. The client never navigates to it as given.
 *  - The return marker is read (and deleted) on load; its `from` is written again when this page's
 *    Google button is pressed, so a retry after a Save prompt still returns focus to Save.
 *  - Nothing renders until `api/me` has answered; signed in, it replaces itself with the target.
 */
@Component({
  selector: 'app-signin-page',
  imports: [GoogleSignInButtonComponent, MessagePageComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session.status() !== 'loading' && !session.isAuthenticated()) {
      <app-message-page [heading]="copy().heading" [body]="copy().body">
        @if (available()) {
          <app-google-sign-in-button [from]="from" [returnPath]="returnPath" />
        }
        @switch (back) {
          @case ('/show') {
            <a
              routerLink="/show"
              class="btn no-underline pointer-coarse:min-h-[44px]"
              data-testid="signin-back"
              >Back to the Show Builder</a
            >
          }
          @case ('/mine') {
            <a
              routerLink="/mine"
              class="btn no-underline pointer-coarse:min-h-[44px]"
              data-testid="signin-back"
              >Go back</a
            >
          }
          @default {
            <a
              routerLink="/"
              class="btn no-underline pointer-coarse:min-h-[44px]"
              data-testid="signin-back"
              >Go to the designer</a
            >
          }
        }
      </app-message-page>
    }
  `,
})
export class SignInPageComponent {
  protected readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly config = inject(ClientConfigStore);

  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  private readonly error = this.query.get('error');
  /** The checked return path, or `/`. */
  protected readonly returnPath: string;
  protected readonly back: BackTarget;
  protected readonly from: SignInFrom;
  protected readonly available = this.config.signInAvailable;
  protected readonly copy = computed(() => signInPageCopy(this.error, this.available()));

  constructor() {
    inject(Title).setTitle(SIGNIN_TITLE);
    const raw = this.query.get('returnUrl');
    this.returnPath = isSafeInternalUrl(raw) ? raw : '/';
    this.back = backTargetOf(this.returnPath);
    this.from = takeSignInIntent(null)?.from ?? 'nav';
    this.session
      .settled()
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => {
        if (!this.session.isAuthenticated()) return;
        if (this.back === '/show') void this.router.navigateByUrl('/show', { replaceUrl: true });
        else if (this.back === '/mine')
          void this.router.navigateByUrl('/mine', { replaceUrl: true });
        else void this.router.navigateByUrl('/', { replaceUrl: true });
      });
  }
}
