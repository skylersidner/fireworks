import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { StageStats } from '../fireworks-stage/fireworks-stage';

/**
 * Stage HUD (designer-2c.md §3.7; prototype l.526–527). Its input is the stage's throttled
 * `stats` (about 4 Hz), never per frame. `aria-hidden`: a counter that changes 4 times a second
 * is noise to a screen reader.
 */
@Component({
  selector: 'app-hud',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    'data-testid': 'hud',
    class:
      'pointer-events-none absolute top-2.5 right-3 text-right font-mono text-caption leading-[1.5] whitespace-pre text-muted [text-shadow:0_1px_2px_#000]',
  },
  template: `{{ text() }}`,
})
export class HudComponent {
  readonly stats = input<StageStats | null>(null);

  protected readonly text = computed(() => {
    const s = this.stats();
    const particles = (s?.particles ?? 0).toLocaleString();
    const fps = (s?.fps ?? 60).toFixed(0);
    return `${particles} particles · ${fps} fps\nseed ${s?.seed ?? '—'}`;
  });
}
