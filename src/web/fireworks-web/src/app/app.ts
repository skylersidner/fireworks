import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { HealthService } from './core/health';
import { NotificationService } from './core/notifications';

/**
 * Application root, and host for the two app-wide concerns that sit above every page: the
 * notification toast host and the API-availability probe with its modal. The probe is also the
 * only visible check that the dev proxy's /health rule works, since a broken proxy rule otherwise
 * fails silently.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  host: { class: 'block h-full' },
})
export class App implements OnInit {
  readonly notificationService = inject(NotificationService);
  private readonly healthService = inject(HealthService);

  readonly isCheckingApiAvailability = signal(false);
  readonly isApiUnavailable = signal(false);

  ngOnInit(): void {
    this.checkApiAvailability();
  }

  checkApiAvailability(): void {
    this.isCheckingApiAvailability.set(true);
    this.healthService.getLiveness().subscribe({
      next: () => {
        this.isCheckingApiAvailability.set(false);
        this.isApiUnavailable.set(false);
      },
      error: () => {
        this.isCheckingApiAvailability.set(false);
        this.isApiUnavailable.set(true);
      },
    });
  }
}
