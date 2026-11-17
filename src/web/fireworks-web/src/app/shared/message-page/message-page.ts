import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
} from '@angular/core';
import { StaticSkylineComponent } from '../static-skyline';

/**
 * The full-page message layout (phase-5.md §9), shared by the not-found page and every "can't
 * open" or "can't play" message (§7.3, §8.4) and My creations' notices (§10.2). A centered card
 * over the sunken page with the skyline silhouette along the bottom, static: no stage, no Pixi
 * chunk. Focus goes to the `h1` on load (§12.1). Buttons are projected. Text only (Boo C1).
 */
@Component({
  selector: 'app-message-page',
  imports: [StaticSkylineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative grid min-h-dvh place-items-center overflow-hidden bg-surface-sunken p-4',
    'data-testid': 'message-page',
  },
  template: `
    <div class="relative z-10 w-full max-w-[420px] rounded-xl border border-default bg-surface p-5">
      <h1 class="m-0 mb-1.5 text-heading" tabindex="-1" data-testid="message-heading">
        {{ heading() }}
      </h1>
      @for (line of body(); track $index; let first = $first) {
        <p class="m-0 text-body text-muted" [class.mt-2]="!first">{{ line }}</p>
      }
      <div class="mt-4 flex flex-wrap gap-[8px]"><ng-content /></div>
    </div>
    <app-static-skyline />
  `,
})
export class MessagePageComponent {
  readonly heading = input.required<string>();
  /** Paragraphs, in order. */
  readonly body = input<readonly string[]>([]);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => host.nativeElement.querySelector<HTMLElement>('h1')?.focus());
  }
}
