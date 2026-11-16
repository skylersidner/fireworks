import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { NAME_MAX_LENGTH, SHELL_LIMITS } from '../../../../../engine/model/limits';
import { RangeRowComponent } from '../../../../shared/range-row';
import type { EditableShell } from '../designer-draft';
import { degrees, degreesText, percent, percentText } from '../../../../shared/formats';

/** Counter appears at this many characters (designer-2c.md §3.3). */
const COUNTER_FROM = 70;

/** Shell section: Name, Burst height, Angle jitter (designer-2c.md §3.3; prototype l.606–615). */
@Component({
  selector: 'app-shell-fields',
  imports: [FormField, RangeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="section-heading">Shell</h2>
    <div class="my-1.5 grid grid-cols-[96px_1fr] items-center gap-2">
      <label for="shell-name" class="text-muted">Name</label>
      <input
        id="shell-name"
        type="text"
        class="field"
        placeholder="Name your shell"
        autocomplete="off"
        [formField]="fields().name"
      />
    </div>
    @if (nameLength() >= counterFrom) {
      <p class="note text-right" data-testid="name-counter">{{ nameLength() }}/{{ maxLength }}</p>
    }
    <app-range-row
      label="Burst height"
      [range]="limits.burstHeight"
      [format]="percent"
      [valueText]="percentText"
      [formField]="fields().burstHeight"
    />
    <app-range-row
      label="Angle jitter"
      [range]="limits.angleJitter"
      [format]="degrees"
      [valueText]="degreesText"
      [formField]="fields().angleJitter"
    />
  `,
})
export class ShellFieldsComponent {
  readonly fields = input.required<FieldTree<EditableShell>>();

  protected readonly nameLength = computed(() => Array.from(this.fields().name().value()).length);
  protected readonly limits = SHELL_LIMITS;
  protected readonly maxLength = NAME_MAX_LENGTH;
  protected readonly counterFrom = COUNTER_FROM;
  protected readonly percent = percent;
  protected readonly percentText = percentText;
  protected readonly degrees = degrees;
  protected readonly degreesText = degreesText;
}
