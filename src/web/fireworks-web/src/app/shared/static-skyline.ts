import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The skyline silhouette as plain CSS, for pages that show no stage (phase-5.md §9: the not-found
 * page, the player while it loads). Static, so no Pixi chunk is fetched. Decorative.
 */
@Component({
  selector: 'app-static-skyline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    class: 'pointer-events-none absolute inset-x-0 bottom-0 block h-[34px]',
  },
  template: '',
  styles: `
    :host {
      background: #000;
      clip-path: polygon(
        0 60%,
        6% 60%,
        6% 20%,
        11% 20%,
        11% 55%,
        18% 55%,
        18% 0,
        22% 0,
        22% 50%,
        30% 50%,
        30% 30%,
        37% 30%,
        37% 65%,
        45% 65%,
        45% 10%,
        49% 10%,
        49% 45%,
        58% 45%,
        58% 25%,
        64% 25%,
        64% 60%,
        72% 60%,
        72% 5%,
        76% 5%,
        76% 50%,
        85% 50%,
        85% 35%,
        92% 35%,
        92% 60%,
        100% 60%,
        100% 100%,
        0 100%
      );
    }
  `,
})
export class StaticSkylineComponent {}
