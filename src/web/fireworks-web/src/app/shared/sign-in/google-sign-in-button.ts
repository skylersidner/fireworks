import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { currentReturnPath, startSignIn, type SignInFrom } from '../../core/sign-in';

/** The button's text: one of the three Google allows; "Google" alone never is (phase-8.md §3). */
export const GOOGLE_BUTTON_TEXT = 'Sign in with Google';

/**
 * The branded "Sign in with Google" button (phase-8.md §3; Rosalina R3): Google's Light theme,
 * rectangular, built in HTML because the GIS script is cross-origin (`script-src 'self'`) and a
 * different flow. Nothing is loaded from Google: the G is Google's current bundle SVG, chrome paths
 * removed and cropped, served same-origin as `public/brand/google-g.svg` under `img-src 'self'`
 * (phase-8.md §15.1; not inlined, it uses `foreignObject`). The font stack names Google Sans only as an installed font, falling back to Roboto or the
 * system sans at 500 (Boo A6: no `font-src` change in Phase 8, so it is never fetched).
 *
 * The brand hexes are literal on purpose: they are Google's, not tokens, and this is the one
 * component that may hard-code them. Raw px throughout (the root font is 13px).
 *
 * The press flushes the draft (`beforeLeave`), writes the return marker and navigates to the login
 * endpoint (core/sign-in.ts). After it, the button is aria-disabled and keeps focus; the page is
 * leaving.
 */
@Component({
  selector: 'app-google-sign-in-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <button
      type="button"
      class="inline-flex h-[40px] cursor-pointer items-center gap-[10px] rounded-[4px] border border-solid border-[#747775] bg-[#FFFFFF] pr-[12px] pl-[12px] text-[14px] leading-[20px] font-medium whitespace-nowrap text-[#1F1F1F] box-border hover:bg-[#F7F8F8] pointer-coarse:h-auto pointer-coarse:min-h-[44px] aria-disabled:cursor-progress"
      style="font-family: 'Google Sans', Roboto, system-ui, sans-serif"
      data-testid="google-sign-in"
      [attr.aria-disabled]="pressed() ? 'true' : null"
      (click)="press()"
    >
      <img src="brand/google-g.svg" alt="" width="20" height="20" class="block flex-none" />
      <span>{{ text }}</span>
    </button>
  `,
})
export class GoogleSignInButtonComponent {
  /** `save` returns focus to Save; `nav` to the page's h1 (phase-8.md §6.2). */
  readonly from = input<SignInFrom>('nav');
  /** Where to come back to; defaults to the current path and query. */
  readonly returnPath = input<string | null>(null);
  /** The page store's `flushDraft()`, when the page has a draft. */
  readonly beforeLeave = input<(() => void) | null>(null);

  protected readonly text = GOOGLE_BUTTON_TEXT;
  protected readonly pressed = signal(false);

  protected press(): void {
    if (this.pressed()) return;
    this.pressed.set(true);
    startSignIn({
      from: this.from(),
      returnPath: this.returnPath() ?? currentReturnPath(),
      beforeLeave: this.beforeLeave() ?? undefined,
    });
  }
}
