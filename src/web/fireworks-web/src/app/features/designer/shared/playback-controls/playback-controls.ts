import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import type { PlaybackMode } from '../../../../../engine/model/enums';
import type { Option } from '../../../../../engine/model/labels';
import { SelectRowComponent } from '../../../../shared/select-row';
import { PLAYBACK_HELD_TITLE } from '../designer-copy';

const MODE_OPTIONS: readonly Option<PlaybackMode>[] = [
  { value: 'loop', label: 'Preview loop (current shell)' },
  { value: 'manual', label: 'Manual (click sky / Space)' },
  { value: 'show', label: 'Auto show (random presets)' },
];

/** Playback section (designer-2c.md §3.1; prototype l.65–81). */
@Component({
  selector: 'app-playback-controls',
  imports: [FormField, SelectRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="section-heading">Playback</h2>
    <div class="flex flex-wrap gap-1.5">
      <button
        type="button"
        class="btn btn-primary"
        data-testid="launch"
        [disabled]="paused()"
        [attr.title]="paused() ? heldTitle : null"
        (click)="launch.emit()"
      >
        {{ coarse() ? 'Launch' : 'Launch (Space)' }}
      </button>
      <button
        type="button"
        class="btn"
        data-testid="replay"
        [title]="paused() ? heldTitle : replayTitle"
        [disabled]="!canReplay() || paused()"
        (click)="replay.emit()"
      >
        Replay last
      </button>
      <button type="button" class="btn" data-testid="clear" (click)="clear.emit()">
        Clear sky
      </button>
    </div>
    <app-select-row class="mt-2.5" label="Mode" [options]="modeOptions" [formField]="mode()" />
    <p class="note" data-testid="playback-note">
      @if (paused()) {
        Close the flashing notice on the stage to start.
      } @else {
        {{ coarse() ? 'Tap' : 'Click' }} anywhere in the sky to burst the current shell at that
        point.
      }
    </p>
  `,
})
export class PlaybackControlsComponent {
  readonly mode = input.required<FieldTree<PlaybackMode>>();
  readonly canReplay = input(false);
  readonly coarse = input(false);
  /** Playback is paused (the flashing notice is up): Launch and Replay are disabled, and the note says why. */
  readonly paused = input(false);

  readonly launch = output<void>();
  readonly replay = output<void>();
  readonly clear = output<void>();

  protected readonly modeOptions = MODE_OPTIONS;
  protected readonly heldTitle = PLAYBACK_HELD_TITLE;
  protected readonly replayTitle = 'Fire the last launch again, with the same seed';
}
