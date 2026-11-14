import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SessionService } from '../core/session';

/**
 * Final copy (docs/fireworks-app/design/phase-5.md §2.4), verbatim. It says what Boo C17 requires:
 * anyone who can reach the site can change or delete every saved creation, and a share link can
 * later play something else.
 */
export const TEST_MODE_TEXT =
  'Test mode: anyone who can reach this site can change or delete any saved creation, including yours. A share link may later play something else or stop working.';

/**
 * The test-mode banner (Boo C17; Skyler, 2026-11-14): shown whenever writes are on without a
 * login (`canWrite && !isAuthenticated`), which before Phase 8 is every test window. On the
 * designer, the player and `/mine`. Identity comes only from SessionService.
 */
@Component({
  selector: 'app-test-mode-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (visible()) {
      <p
        class="m-0 mb-3 rounded-md border border-accent bg-surface-raised px-3 py-2 text-small text-primary"
        role="note"
        data-testid="test-mode-banner"
      >
        {{ text }}
      </p>
    }
  `,
})
export class TestModeBannerComponent {
  private readonly session = inject(SessionService);
  protected readonly text = TEST_MODE_TEXT;
  protected readonly visible = computed(
    () => this.session.canWrite() && this.session.currentUser()?.isAuthenticated !== true,
  );
}
