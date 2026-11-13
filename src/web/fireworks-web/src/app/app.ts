import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ApiStatusService } from './core/api-status';
import { NotificationService } from './core/notifications';

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

  ngOnInit(): void {
    this.apiStatus.check();
  }
}
