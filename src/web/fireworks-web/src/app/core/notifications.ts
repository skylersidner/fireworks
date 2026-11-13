import { Injectable, signal } from '@angular/core';

export type NotificationKind = 'success' | 'error';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  message: string;
}

/** designer-2c.md §6.3 item 4: success toasts last 4 s, error toasts 8 s and pause while held. */
export const SUCCESS_TOAST_MS = 4000;
export const ERROR_TOAST_MS = 8000;

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  startedAt: number;
  holds: number;
}

/**
 * App-wide toast queue, rendered by the root App's toast host. Each toast auto-dismisses; an
 * error toast pauses while it is hovered or focused (`pause`/`resume`, counted, so hover and
 * focus together need two resumes).
 */
@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private nextId = 1;
  private readonly timers = new Map<number, Timer>();
  readonly notifications = signal<AppNotification[]>([]);

  success(message: string): void {
    this.enqueue('success', message, SUCCESS_TOAST_MS);
  }

  error(message: string): void {
    this.enqueue('error', message, ERROR_TOAST_MS);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer?.handle) clearTimeout(timer.handle);
    this.timers.delete(id);
    this.notifications.update((items) => items.filter((item) => item.id !== id));
  }

  /** Stops the countdown (hover or focus). */
  pause(id: number): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    timer.holds++;
    if (timer.handle) {
      clearTimeout(timer.handle);
      timer.handle = null;
      timer.remainingMs -= Date.now() - timer.startedAt;
    }
  }

  /** Restarts the countdown with the time that was left, once every hold is released. */
  resume(id: number): void {
    const timer = this.timers.get(id);
    if (!timer || timer.holds === 0) return;
    timer.holds--;
    if (timer.holds === 0 && !timer.handle) this.arm(id, timer);
  }

  private enqueue(kind: NotificationKind, message: string, durationMs: number): void {
    const id = this.nextId++;
    this.notifications.update((items) => [...items, { id, kind, message }]);
    const timer: Timer = { handle: null, remainingMs: durationMs, startedAt: 0, holds: 0 };
    this.timers.set(id, timer);
    this.arm(id, timer);
  }

  private arm(id: number, timer: Timer): void {
    timer.startedAt = Date.now();
    timer.handle = setTimeout(() => this.dismiss(id), Math.max(0, timer.remainingMs));
  }
}
