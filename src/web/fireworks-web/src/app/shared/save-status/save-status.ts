import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import {
  REPLACING_LABEL,
  SAVE_STATUS_ACTION_LABELS,
  type SaveStatus,
  type SaveStatusAction,
} from '../save-copy';

/**
 * The status block at the top of the panel (phase-5.md §3.4, §6): the latest save failure, or a
 * success with a caveat. Errors are `role="alert"`, the caveat `role="status"`. It never takes
 * focus. It stays until the next save attempt, a successful save, or Dismiss. Text only (Boo C1).
 */
@Component({
  selector: 'app-save-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mb-3 block rounded-md border border-default px-3 py-2 text-small',
    '[class.bg-danger-surface]': "status().tone === 'error'",
    '[class.text-on-danger-surface]': "status().tone === 'error'",
    '[class.bg-success-surface]': "status().tone === 'caveat'",
    '[class.text-on-success-surface]': "status().tone === 'caveat'",
    '[attr.role]': "status().tone === 'error' ? 'alert' : 'status'",
    '[attr.data-tone]': 'status().tone',
    'data-testid': 'save-status',
  },
  template: `
    <p class="m-0" data-testid="save-status-text">{{ status().text }}</p>
    <div class="mt-2 flex flex-wrap items-center gap-2">
      @for (action of status().actions; track action) {
        <button
          type="button"
          class="btn btn-sm"
          [attr.data-testid]="'save-status-' + action"
          [attr.aria-haspopup]="action === 'signIn' ? 'dialog' : null"
          [class.btn-busy]="busy()"
          [attr.aria-disabled]="busy() ? 'true' : null"
          (click)="press(action)"
        >
          {{ action === 'replace' && replacing() ? replacingLabel : labels[action] }}
        </button>
      }
      <button
        type="button"
        class="ml-auto cursor-pointer border-0 bg-transparent p-0 text-inherit underline"
        aria-label="Dismiss message"
        data-testid="save-status-dismiss"
        (click)="dismiss.emit()"
      >
        Dismiss
      </button>
    </div>
  `,
})
export class SaveStatusComponent {
  readonly status = input.required<SaveStatus>();
  /** 412's Replace is running (phase-8.md §9.2): it reads `Replacing…`. */
  readonly replacing = input(false);
  /** A save is in flight (Replace included): every action is aria-disabled and ignored. */
  readonly busy = input(false);
  readonly act = output<SaveStatusAction>();
  readonly dismiss = output<void>();

  protected readonly labels = SAVE_STATUS_ACTION_LABELS;
  protected readonly replacingLabel = REPLACING_LABEL;

  protected press(action: SaveStatusAction): void {
    if (this.busy()) return;
    this.act.emit(action);
  }
}
