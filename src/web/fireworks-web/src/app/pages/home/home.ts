import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HealthService } from '../../core/health';
import { SessionService } from '../../core/session';
import { PixiCanaryComponent } from './pixi-canary/pixi-canary';

export type HealthStatus = 'checking' | 'healthy' | 'unavailable';

/**
 * Phase 1 home page: title, API health, the session's write state and the Pixi canary. Replaced
 * by the Shell Designer at `/` in Phase 2c (OQ8, pending Rosalina's design-review).
 */
@Component({
  selector: 'app-home-page',
  imports: [PixiCanaryComponent],
  templateUrl: './home.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-auto' },
})
export class HomePageComponent {
  private readonly healthService = inject(HealthService);
  readonly session = inject(SessionService);

  readonly health = signal<HealthStatus>('checking');

  constructor() {
    this.healthService.getLiveness().subscribe({
      next: () => this.health.set('healthy'),
      error: () => this.health.set('unavailable'),
    });
  }
}
