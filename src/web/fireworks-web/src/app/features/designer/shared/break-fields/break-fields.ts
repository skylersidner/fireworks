import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import {
  COLOR1_SELECT_OPTIONS,
  COLOR2_SELECT_OPTIONS,
  EFFECT_OPTIONS,
  PATTERN_OPTIONS,
  TRAIL_OPTIONS,
} from '../../../../../engine/model/labels';
import { BREAK_LIMITS } from '../../../../../engine/model/limits';
import type { BreakDef } from '../../../../../engine/model/shell';
import { RangeRowComponent } from '../../../../shared/range-row';
import { SelectRowComponent } from '../../../../shared/select-row';
import { BREAK_PANEL_ID, breakTabId } from '../break-tabs/break-tabs';
import {
  changeAtText,
  colorSwatch,
  delayText,
  fixed2,
  percent,
  plain,
  seconds1,
  seconds1Text,
  seconds2,
  starsText,
} from '../formats';

/** The active break's rows, in prototype order (designer-2c.md §3.4; prototype l.617–645). */
@Component({
  selector: 'app-break-fields',
  imports: [FormField, RangeRowComponent, SelectRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'tabpanel',
    '[id]': 'panelId',
    '[attr.aria-labelledby]': 'tabId(index())',
    class: 'block',
  },
  template: `
    @let f = fields();
    <app-select-row label="Pattern" [options]="patterns" [formField]="f.pattern" />
    <app-range-row
      label="Stars"
      [range]="L.stars"
      [format]="plain"
      [valueText]="starsText"
      [formField]="f.stars"
    />
    <app-range-row label="Burst speed" [range]="L.speed" [format]="plain" [formField]="f.speed" />
    <app-select-row
      label="Color"
      [options]="colors1"
      [swatch]="colorSwatch"
      [formField]="f.color1"
    />
    <app-select-row
      label="Changes to"
      [options]="colors2"
      [swatch]="colorSwatch"
      [formField]="f.color2"
    />
    <app-range-row
      label="Change at"
      [range]="L.changeAt"
      [format]="percent"
      [valueText]="changeAtText"
      [formField]="f.changeAt"
    />
    @if (f.color2().value() === 'none') {
      <p class="note -mt-1" data-testid="change-at-note">Pick a second color to use this.</p>
    }
    <app-range-row
      label="Burn time"
      [range]="L.burn"
      [format]="seconds1"
      [valueText]="seconds1Text"
      [formField]="f.burn"
    />
    <app-range-row label="Air drag" [range]="L.drag" [format]="fixed2" [formField]="f.drag" />
    <app-range-row label="Star size" [range]="L.size" [format]="fixed2" [formField]="f.size" />
    <app-select-row label="Trail" [options]="trails" [formField]="f.trail" />
    <app-select-row label="Effect" [options]="effects" [formField]="f.effect" />
    @if (reduceFlashing() && f.effect().value() === 'strobe') {
      <p class="note -mt-1" data-testid="strobe-note">
        Strobe shows as steady stars while Reduce flashing is on.
      </p>
    }
    @if (index() > 0) {
      <app-range-row
        label="Delay"
        [range]="L.delay"
        [format]="seconds2"
        [valueText]="delayText"
        [formField]="f.delay"
      />
    }
  `,
})
export class BreakFieldsComponent {
  readonly fields = input.required<FieldTree<BreakDef>>();
  readonly index = input.required<number>();
  readonly reduceFlashing = input(false);

  protected readonly L = BREAK_LIMITS;
  protected readonly patterns = PATTERN_OPTIONS;
  protected readonly colors1 = COLOR1_SELECT_OPTIONS;
  protected readonly colors2 = COLOR2_SELECT_OPTIONS;
  protected readonly trails = TRAIL_OPTIONS;
  protected readonly effects = EFFECT_OPTIONS;
  protected readonly panelId = BREAK_PANEL_ID;
  protected readonly tabId = breakTabId;
  protected readonly colorSwatch = colorSwatch;
  protected readonly plain = plain;
  protected readonly starsText = starsText;
  protected readonly percent = percent;
  protected readonly changeAtText = changeAtText;
  protected readonly seconds1 = seconds1;
  protected readonly seconds1Text = seconds1Text;
  protected readonly seconds2 = seconds2;
  protected readonly delayText = delayText;
  protected readonly fixed2 = fixed2;
}
