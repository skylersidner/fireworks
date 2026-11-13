import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type { PlaybackMode } from '../../../../../engine/model/enums';
import { flashNoticeModeSentence } from '../designer-copy';

let nextId = 0;

/**
 * First-visit flashing notice on the stage (designer-2c.md §7.2, D1). Non-modal: nothing behind it
 * is inert. While it shows, the page holds playback (Skyler 2026-11-13); this component only
 * shows the copy and reports the answer. No ×, no Escape: both answers are explicit buttons.
 * On first render, if focus is still on `body`, it moves to the first button. Both buttons are
 * described by the copy paragraph, so a screen reader hears what the notice asks when it takes focus.
 */
@Component({
  selector: 'app-flash-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'region',
    'aria-label': 'Flashing lights notice',
    'data-testid': 'flash-notice',
    class:
      'absolute top-12 right-3 left-3 z-10 mx-auto block max-w-[420px] rounded-md border border-l-[3px] border-default border-l-accent bg-surface-raised px-3 py-2.5 text-small text-primary shadow-[0_8px_24px_rgba(0,0,0,0.45)]',
  },
  template: `
    @if (reduceFlashing()) {
      <p class="m-0" data-testid="flash-notice-text" [id]="textId">
        <strong>Flashing lights.</strong> {{ modeSentence() }} Reduce flashing is on, so strobe is
        off and burst flashes are dimmed. You can change this under Display.
      </p>
      <div class="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn"
          data-testid="flash-continue"
          [attr.aria-describedby]="textId"
          (click)="dismiss.emit()"
        >
          Continue
        </button>
      </div>
    } @else {
      <p class="m-0" data-testid="flash-notice-text" [id]="textId">
        <strong>Flashing lights.</strong> {{ modeSentence() }} Bursts flash, and some effects
        strobe. If flashing affects you, turn on Reduce flashing first.
        @if (mode() !== 'manual') {
          To stop the loop later, set Mode to Manual.
        }
      </p>
      <div class="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-primary"
          data-testid="flash-turn-on"
          [attr.aria-describedby]="textId"
          (click)="turnOn.emit()"
        >
          Turn on Reduce flashing
        </button>
        <button
          type="button"
          class="btn"
          data-testid="flash-continue"
          [attr.aria-describedby]="textId"
          (click)="dismiss.emit()"
        >
          Continue
        </button>
      </div>
    }
  `,
})
export class FlashNoticeComponent {
  readonly reduceFlashing = input(false);
  readonly mode = input<PlaybackMode>('loop');
  readonly turnOn = output<void>();
  readonly dismiss = output<void>();

  /** Unique per instance: the id the buttons' `aria-describedby` points at. */
  protected readonly textId = `flash-notice-text-${nextId++}`;
  protected readonly modeSentence = computed(() => flashNoticeModeSentence(this.mode()));

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      host.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
    });
  }
}
