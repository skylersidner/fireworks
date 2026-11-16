import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ApiStatusService } from './core/api-status';
import { NotificationService, type AppNotification } from './core/notifications';

/**
 * Application root: the notification toast host, and the one API-availability probe. Nothing here
 * blocks a page. Since Phase 2c the probe's result is shown by the page that needs it (the
 * designer's non-blocking banner, `/status`'s text), not by a modal (designer-2c.md §6.3).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  host: { class: 'block h-full' },
})
export class App implements OnInit {
  readonly notificationService = inject(NotificationService);
  private readonly apiStatus = inject(ApiStatusService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly toastFocus = new ToastFocus();

  constructor() {
    // K7 (phase-7.md §3.2): a toast removed with focus on its × (dismissed, or timed out while
    // focused) hands focus to the next toast's ×, else the page's h1. Only then.
    let before: readonly AppNotification[] = [];
    effect(() => {
      const now = this.notificationService.notifications();
      const previous = before;
      before = now;
      const focused = untracked(() => this.toastFocus.id);
      if (focused === null || now.some((n) => n.id === focused)) return;
      this.toastFocus.forget();
      afterNextRender(() => this.handOff(focused, previous, now), { injector: this.injector });
    });
  }

  private handOff(
    removed: number,
    previous: readonly AppNotification[],
    now: readonly AppNotification[],
  ): void {
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    // The host's DOM order: success toasts first, then error toasts (app.html).
    const order = (list: readonly AppNotification[]) => [
      ...list.filter((n) => n.kind !== 'error'),
      ...list.filter((n) => n.kind === 'error'),
    ];
    const was = order(previous);
    const at = was.findIndex((n) => n.id === removed);
    const next = was.slice(at + 1).find((n) => now.some((m) => m.id === n.id));
    const root = this.host.nativeElement;
    const target = next
      ? root.querySelectorAll<HTMLElement>('[data-testid="toast-dismiss"]')[
          order(now).findIndex((n) => n.id === next.id)
        ]
      : (root.querySelector<HTMLElement>('h1[tabindex]') ?? root.querySelector<HTMLElement>('h1'));
    target?.focus();
  }

  ngOnInit(): void {
    this.apiStatus.check();
  }
}

/** Which toast's × has focus (K7). A removed element's `focusout` has no `relatedTarget`. */
class ToastFocus {
  id: number | null = null;

  focusIn(id: number): void {
    this.id = id;
  }

  focusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && next.isConnected) this.id = null;
  }

  forget(): void {
    this.id = null;
  }
}
