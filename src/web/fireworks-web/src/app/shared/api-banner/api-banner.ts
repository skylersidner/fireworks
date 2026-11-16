import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** The designer's sentence (designer-2c.md §6.3); the default `message`. */
export const API_BANNER_DESIGNER =
  "Can't reach the server right now. You can keep designing; your shell is kept in this browser.";

/**
 * Non-blocking API-down banner at the top of the panel (designer-2c.md §6.3), replacing the Phase
 * 1 modal. The host page renders it only while the API is unavailable or being re-checked after
 * being unavailable; on recovery it disappears, with no success toast. The Show Builder passes its
 * own `message` (phase-6.md §19.2 B1); the button and behavior are shared. When it unmounts with
 * focus inside it, the host moves focus to its panel h1 (`BannerFocus`, phase-7.md §10).
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
    <p class="m-0">{{ message() }}</p>
    <button
      type="button"
      class="btn btn-sm mt-2"
      data-testid="api-retry"
      [class.btn-busy]="checking()"
      [attr.aria-disabled]="checking() ? 'true' : null"
      (click)="press()"
    >
      {{ checking() ? 'Checking…' : 'Try again' }}
    </button>
  `,
})
export class ApiBannerComponent {
  readonly checking = input(false);
  readonly message = input(API_BANNER_DESIGNER);
  readonly retry = output<void>();

  /**
   * While checking, Try again is `aria-disabled` and busy-looking, so it keeps focus (phase-7.md
   * §10), and a press is ignored: one probe at a time.
   */
  protected press(): void {
    if (!this.checking()) this.retry.emit();
  }
}

/**
 * Where focus goes when the banner unmounts with focus inside it (phase-7.md §10): the host's
 * panel h1. Tracks focus by `focusin`, and forgets it only when focus moves to another connected
 * element (a removed element's `focusout` has no `relatedTarget`). The host calls `left()` when the
 * banner stops showing.
 */
export class BannerFocus {
  private inside = false;

  constructor(private readonly target: () => HTMLElement | null) {}

  focusIn(): void {
    this.inside = true;
  }

  focusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && next.isConnected) this.inside = false;
  }

  /** The banner is gone: if focus was in it and is now on nothing, move it to the target. */
  left(): void {
    if (!this.inside) return;
    this.inside = false;
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) this.target()?.focus();
  }
}
