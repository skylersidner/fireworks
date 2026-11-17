import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  output,
  signal,
} from '@angular/core';
import { NotificationService } from '../../core/notifications';
import { SessionService } from '../../core/session';
import {
  BLANK_NAME,
  SIGNED_OUT_TOAST,
  SIGN_IN_LABEL,
  SIGN_OUT_FAILED,
  SIGN_OUT_LABEL,
} from './sign-in-copy';

/**
 * The account control on the subtitle row of `/`, `/show` and `/mine` (phase-8.md §2; Rosalina
 * R1). Identity comes only from SessionService.
 *  - `loading` or `unavailable`: nothing (the subtitle holds the row's height).
 *  - Signed out: `Sign in`, a link-styled button that asks the page to open its sign-in dialog
 *    (the nav variant). It never says "Google" on its own.
 *  - Signed in: the name in `<bdi>` (text only, Boo C1, C3; truncated, full name in the DOM and the
 *    title), ` · `, then `Sign out`, which posts `api/auth/logout` and reloads the session. The
 *    draft is kept (Skyler, 2026-11-16).
 * Not a live region: the change comes with a toast (§12.2).
 */
@Component({
  selector: 'app-account-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 items-baseline gap-1', 'data-testid': 'account-control' },
  template: `
    @if (session.status() === 'ready') {
      @if (session.isAuthenticated()) {
        <bdi
          class="inline-block max-w-[16ch] truncate align-bottom text-small text-primary max-[760px]:max-w-[12ch]"
          data-testid="account-name"
          [attr.title]="nameTitle()"
          >{{ name() }}</bdi
        >
        <span class="text-small text-muted" aria-hidden="true">·</span>
        <button
          type="button"
          class="touch-link cursor-pointer border-0 bg-transparent p-0 text-small text-muted hover:text-primary aria-disabled:cursor-progress"
          data-testid="account-sign-out"
          [attr.aria-disabled]="signingOut() ? 'true' : null"
          (click)="signOut()"
        >
          {{ signOutLabel }}
        </button>
      } @else {
        <button
          type="button"
          class="touch-link cursor-pointer border-0 bg-transparent p-0 text-small text-muted hover:text-primary"
          aria-haspopup="dialog"
          data-testid="account-sign-in"
          (click)="signIn.emit()"
        >
          {{ signInLabel }}
        </button>
      }
    }
  `,
})
export class AccountControlComponent {
  protected readonly session = inject(SessionService);
  private readonly notifications = inject(NotificationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** `Sign in` was pressed: the page opens its sign-in dialog (nav variant). */
  readonly signIn = output<void>();
  /** The session reloaded signed out after `Sign out` (the page may move focus, e.g. `/mine`). */
  readonly signedOut = output<void>();

  protected readonly signInLabel = SIGN_IN_LABEL;
  protected readonly signOutLabel = SIGN_OUT_LABEL;
  protected readonly signingOut = signal(false);

  protected name(): string {
    return this.session.displayName() || BLANK_NAME;
  }

  protected nameTitle(): string {
    const name = this.session.displayName();
    return name ? `Signed in with Google as ${name}` : 'Signed in with Google';
  }

  protected signOut(): void {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    const button = this.byTest('account-sign-out');
    this.session.signOut().subscribe((ok) => {
      this.signingOut.set(false);
      if (!ok) {
        this.notifications.error(SIGN_OUT_FAILED);
        return;
      }
      const active = document.activeElement;
      const stranded =
        active === null || active === document.body || active === button || !active.isConnected;
      this.notifications.success(SIGNED_OUT_TOAST);
      this.signedOut.emit();
      // K9: `Sign out` is replaced by `Sign in`; focus follows it (§2.2).
      afterNextRender(
        () => {
          const now = document.activeElement;
          if (stranded && (now === null || now === document.body || now === button)) {
            this.byTest('account-sign-in')?.focus();
          }
        },
        { injector: this.injector },
      );
    });
  }

  private byTest(id: string): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }
}
