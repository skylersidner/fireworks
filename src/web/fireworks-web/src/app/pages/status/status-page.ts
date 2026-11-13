import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiStatusService } from '../../core/api-status';
import { SessionService } from '../../core/session';

/**
 * Phase 1 status page, moved to `/status` in 2c without the canary (decided 2026-11-12): API
 * health and the session's write state. It reads the app-wide probe instead of probing again,
 * and is also the stage-free route the 2d WebGL leak check navigates to.
 */
@Component({
  selector: 'app-status-page',
  imports: [RouterLink],
  templateUrl: './status-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-auto' },
})
export class StatusPageComponent {
  protected readonly apiStatus = inject(ApiStatusService);
  protected readonly session = inject(SessionService);
}
