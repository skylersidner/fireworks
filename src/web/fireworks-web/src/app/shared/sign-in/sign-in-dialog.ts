import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ClientConfigStore } from '../../core/client-config';
import type { SignInFrom } from '../../core/sign-in';
import type { SaveNoun } from '../save-copy';
import { GoogleSignInButtonComponent } from './google-sign-in-button';
import {
  CLOSE_LABEL,
  NAV_DIALOG_BODY,
  NAV_DIALOG_TITLE,
  NOT_NOW_LABEL,
  PRIVACY_LINE,
  SAVE_DIALOG_TITLE,
  UNAVAILABLE_DIALOG_TITLE,
  UNDO_LINE,
  saveDialogBody,
  unavailableDialogBody,
} from './sign-in-copy';

/**
 * The sign-in dialog (phase-8.md §5.3): a native modal `<dialog>` with confirm-dialog's look,
 * Escape handling and return-focus-to-opener. It is a dialog, not an alertdialog: nothing is
 * destroyed, so focus starts on the Google button. `Not now` comes first.
 *
 *  - `save` (signed-out Save, ⌘S, the 401 row's Sign in) and `nav` (the account control's Sign in).
 *  - The builder passes `undoLine` only when Undo or Redo history exists.
 *  - With no providers (or a failed client-config) it reads "Sign-in isn't available right now"
 *    with one `Close`. Nothing is ever sent from here except the Google button's navigation.
 * Text is interpolated, never bound as HTML.
 */
@Component({
  selector: 'app-sign-in-dialog',
  imports: [GoogleSignInButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="m-auto w-[calc(100%-32px)] max-w-[420px] rounded-xl border border-default bg-surface-raised p-4 text-primary shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop:bg-scrim"
      aria-labelledby="sign-in-title"
      [attr.aria-describedby]="describedBy()"
      data-testid="sign-in-dialog"
      (cancel)="close()"
      (close)="close()"
    >
      <h2 id="sign-in-title" class="m-0 mb-1.5 text-heading font-semibold">{{ title() }}</h2>
      @for (line of lines(); track $index) {
        <p
          [id]="'sign-in-body-' + $index"
          class="m-0 mb-2 text-body break-words text-primary"
          [attr.data-testid]="'sign-in-line-' + $index"
        >
          {{ line }}
        </p>
      }
      <div class="mt-4 flex flex-wrap items-center justify-end gap-[8px]">
        @if (available()) {
          <button
            type="button"
            class="btn pointer-coarse:min-h-[44px]"
            data-testid="sign-in-not-now"
            (click)="close()"
          >
            {{ notNow }}
          </button>
          <app-google-sign-in-button [from]="variant()" [beforeLeave]="beforeLeave()" />
        } @else {
          <button
            type="button"
            class="btn pointer-coarse:min-h-[44px]"
            data-testid="sign-in-close"
            (click)="close()"
          >
            {{ closeLabel }}
          </button>
        }
      </div>
    </dialog>
  `,
})
export class SignInDialogComponent {
  readonly variant = input<SignInFrom>('save');
  readonly noun = input<SaveNoun>('shell');
  /** Builder: Undo or Redo history exists (phase-8.md §5.3). */
  readonly undoLine = input(false);
  /** The page store's `flushDraft()`. */
  readonly beforeLeave = input<(() => void) | null>(null);

  /** `Not now`, `Close`, Escape or any other close. Emitted once. */
  readonly closed = output<void>();

  private readonly config = inject(ClientConfigStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly notNow = NOT_NOW_LABEL;
  protected readonly closeLabel = CLOSE_LABEL;
  protected readonly available = this.config.signInAvailable;

  protected readonly title = computed(() =>
    !this.available()
      ? UNAVAILABLE_DIALOG_TITLE
      : this.variant() === 'save'
        ? SAVE_DIALOG_TITLE
        : NAV_DIALOG_TITLE,
  );
  protected readonly lines = computed<readonly string[]>(() => {
    if (!this.available()) return [unavailableDialogBody(this.noun())];
    const first = this.variant() === 'save' ? saveDialogBody(this.noun()) : NAV_DIALOG_BODY;
    return this.undoLine() ? [first, UNDO_LINE, PRIVACY_LINE] : [first, PRIVACY_LINE];
  });
  protected readonly describedBy = computed(() =>
    this.lines()
      .map((_, i) => `sign-in-body-${i}`)
      .join(' '),
  );

  /** Whatever had focus when the dialog opened gets it back on close (§12.1). */
  private readonly opener: HTMLElement | null =
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  private done = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      const el = this.opener;
      if (this.done && el?.isConnected) queueMicrotask(() => el.focus());
    });
    afterNextRender(() => {
      const dialog = this.dialog().nativeElement;
      // jsdom has no showModal; the attribute keeps specs on the same template.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      this.host.nativeElement
        .querySelector<HTMLElement>('[data-testid="google-sign-in"], [data-testid="sign-in-close"]')
        ?.focus();
    });
  }

  protected close(): void {
    if (this.done) return;
    this.done = true;
    this.closed.emit();
  }
}
