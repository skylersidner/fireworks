import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * The player's flashing-lights notice (phase-5.md §8.3): the designer's rules (designer-2c.md
 * §7.2) with the player's copy. Non-modal, on the stage, no ×, no Escape; the page holds playback
 * until it's answered. Focus moves to its first button if focus is on `body`. The name is text in
 * a `<bdi>` (Boo C1, C3).
 */
@Component({
  selector: 'app-player-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'region',
    'aria-label': 'Flashing lights notice',
    'data-testid': 'flash-notice',
    class:
      'absolute inset-x-3 top-1/2 z-10 mx-auto block max-w-[420px] -translate-y-1/2 rounded-md border border-l-[3px] border-default border-l-accent bg-surface-raised px-3 py-2.5 text-small text-primary shadow-[0_8px_24px_rgba(0,0,0,0.45)]',
  },
  template: `
    <p class="m-0" id="player-notice-text" data-testid="flash-notice-text">
      <strong>Flashing lights.</strong>
      “<bdi>{{ name() }}</bdi
      >” starts when you close this notice.
      @if (reduceFlashing()) {
        Reduce flashing is on, so strobe is off and burst flashes are dimmed.
      } @else {
        {{ strobe() ? 'It has bright bursts and strobe effects.' : 'Its bursts flash brightly.' }}
        If flashing affects you, turn on Reduce flashing first. You can pause at any time.
      }
    </p>
    <div class="mt-2.5 flex flex-wrap gap-2">
      @if (!reduceFlashing()) {
        <button
          type="button"
          class="btn btn-primary"
          data-testid="flash-turn-on"
          aria-describedby="player-notice-text"
          (click)="turnOn.emit()"
        >
          Turn on Reduce flashing
        </button>
      }
      <button
        type="button"
        class="btn"
        data-testid="flash-play"
        aria-describedby="player-notice-text"
        (click)="play.emit()"
      >
        Play
      </button>
    </div>
  `,
})
export class PlayerNoticeComponent {
  readonly name = input.required<string>();
  /** Any break has `effect: "strobe"` (§8.3). */
  readonly strobe = input(false);
  readonly reduceFlashing = input(false);
  readonly turnOn = output<void>();
  readonly play = output<void>();

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      host.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
    });
  }
}
