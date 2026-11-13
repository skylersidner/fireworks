import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { PRESETS } from '../../../../../engine/model/presets';

/** Presets section (designer-2c.md §3.2; prototype l.83–86). Emits the preset index. */
@Component({
  selector: 'app-preset-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="section-heading">Presets</h2>
    <div class="flex flex-wrap gap-1.5">
      @for (preset of presets; track preset.name; let i = $index) {
        <button type="button" class="btn btn-sm" (click)="selected.emit(i)">
          {{ preset.name }}
        </button>
      }
    </div>
  `,
})
export class PresetBarComponent {
  readonly selected = output<number>();
  protected readonly presets = PRESETS;
}
