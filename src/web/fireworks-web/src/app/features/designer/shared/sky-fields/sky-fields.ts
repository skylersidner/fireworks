import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { SKY_LIMITS } from '../../../../../engine/model/limits';
import type { SkySettings } from '../../../../../engine/model/shell';
import { RangeRowComponent } from '../../../../shared/range-row';
import { plain, windText } from '../../../../shared/formats';

/** Sky section, saved with the shell (designer-2c.md §3.5, D3). */
@Component({
  selector: 'app-sky-fields',
  imports: [FormField, RangeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="section-heading">Sky</h2>
    <app-range-row
      label="Gravity"
      [range]="L.gravity"
      [format]="plain"
      [formField]="fields().gravity"
    />
    <app-range-row
      label="Wind"
      [range]="L.wind"
      [format]="plain"
      [valueText]="windText"
      [formField]="fields().wind"
    />
    <p class="note">Saved with the shell.</p>
  `,
})
export class SkyFieldsComponent {
  readonly fields = input.required<FieldTree<SkySettings>>();
  protected readonly L = SKY_LIMITS;
  protected readonly plain = plain;
  protected readonly windText = windText;
}
