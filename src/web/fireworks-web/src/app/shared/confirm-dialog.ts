import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * In-page confirmation (designer-2c.md §6.4; shared, so Phase 5's discard and delete prompts
 * reuse it). A native `<dialog>` opened with `showModal()`: top layer, inert page, focus
 * containment and Escape come from the browser. Render it while a question is pending; it opens
 * on render and answers exactly once.
 *  - Focus starts on the safe button, which comes first; there is no dialog-wide Enter shortcut.
 *  - Escape is the safe answer. It is read from both `cancel` and `close`: in the 2c smoke
 *    (headless Chrome), Escape closed the modal without firing `cancel` (close-watcher rules), so
 *    `cancel` alone left the question pending with no dialog on screen.
 *  - A backdrop click does nothing (native default).
 * The host returns focus to whatever opened it. Text is interpolated, never bound as HTML.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      role="alertdialog"
      class="m-auto w-[calc(100%-32px)] max-w-[380px] rounded-xl border border-default bg-surface-raised p-4 text-primary shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop:bg-scrim"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      data-testid="confirm-dialog"
      (cancel)="settle('cancel')"
      (close)="settle('cancel')"
    >
      <h2 id="confirm-title" class="m-0 mb-1.5 text-heading font-semibold">{{ title() }}</h2>
      <p id="confirm-body" class="m-0 mb-4 text-body break-words text-primary">{{ body() }}</p>
      <div class="flex flex-wrap justify-end gap-2">
        <button
          #cancelButton
          type="button"
          class="btn"
          data-testid="confirm-cancel"
          (click)="settle('cancel')"
        >
          {{ cancelLabel() }}
        </button>
        <button
          type="button"
          class="btn"
          [class.btn-primary]="tone() === 'primary'"
          [class.btn-danger]="tone() === 'danger'"
          data-testid="confirm-accept"
          (click)="settle('confirm')"
        >
          {{ confirmLabel() }}
        </button>
      </div>
    </dialog>
  `,
})
export class ConfirmDialogComponent {
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly cancelLabel = input.required<string>();
  /** `danger` for a destructive answer (Delete, phase-5.md §10.4); the gradient means "go". */
  readonly tone = input<'primary' | 'danger'>('primary');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');
  private settled = false;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    afterNextRender(() => {
      const dialog = this.dialog().nativeElement;
      // jsdom has no showModal; the attribute keeps specs on the same template.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      this.cancelButton().nativeElement.focus();
    });
  }

  /** One answer per dialog: a button, Escape (`cancel`), or any other close, never two. */
  protected settle(answer: 'confirm' | 'cancel'): void {
    if (this.settled || this.destroyed) return;
    this.settled = true;
    if (answer === 'confirm') this.confirmed.emit();
    else this.cancelled.emit();
  }
}
