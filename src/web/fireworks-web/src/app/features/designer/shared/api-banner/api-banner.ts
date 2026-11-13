import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Non-blocking API-down banner at the top of the panel (designer-2c.md §6.3), replacing the Phase
 * 1 modal. The host page renders it only while the API is unavailable or being re-checked after
 * being unavailable; on recovery it disappears, with no success toast.
 */
@Component({
  selector: 'app-api-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'data-testid': 'api-banner',
    class:
      'mb-3 block rounded-md border border-default bg-danger-surface px-3 py-2 text-small text-on-danger-surface',
  },
  template: `
    <p class="m-0">
      Can't reach the server right now. You can keep designing; your shell is kept in this browser.
    </p>
    <button
      type="button"
      class="btn btn-sm mt-2"
      data-testid="api-retry"
      [disabled]="checking()"
      (click)="retry.emit()"
    >
      {{ checking() ? 'Checking…' : 'Try again' }}
    </button>
  `,
})
export class ApiBannerComponent {
  readonly checking = input(false);
  readonly retry = output<void>();
}
