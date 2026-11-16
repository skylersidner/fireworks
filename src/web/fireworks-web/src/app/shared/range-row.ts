import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import type { NumericRange } from '../../engine/model/limits';

let nextId = 0;

/**
 * Labeled native range input with a value readout (designer-2c.md §5.1). A Signal Forms custom
 * control (`FormValueControl<number>`, not a ControlValueAccessor; OQ17): bind it with
 * `[formField]`, and the field's disabled state arrives through `disabled`.
 *
 * Deliberately has no `min`/`max` inputs: FormField binds those names from the field's own
 * validators, so limits come in as one `range` (from engine/model/limits.ts) instead.
 */
@Component({
  selector: 'app-range-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'my-1.5 grid grid-cols-[96px_1fr_44px] items-center gap-2 pointer-coarse:min-h-[44px]',
  },
  template: `
    <label [for]="id" class="text-muted">{{ label() }}</label>
    <input
      type="range"
      class="w-full accent-accent disabled:cursor-not-allowed disabled:opacity-45"
      [id]="id"
      [min]="range().min"
      [max]="range().max"
      [step]="range().step"
      [value]="value()"
      [disabled]="disabled()"
      [attr.aria-valuetext]="(valueText() ?? format())(value())"
      (input)="onInput($event)"
      (blur)="touch.emit()"
    />
    <output
      [attr.for]="id"
      class="text-right text-small text-primary tabular-nums"
      [class.opacity-45]="disabled()"
      >{{ format()(value()) }}</output
    >
  `,
})
export class RangeRowComponent implements FormValueControl<number> {
  readonly value = model(0);
  readonly disabled = input(false);
  readonly touch = output<void>();

  readonly label = input.required<string>();
  readonly range = input.required<NumericRange>();
  /** Visible value text, e.g. `65%`. */
  readonly format = input<(v: number) => string>((v) => String(v));
  /** Screen-reader value text, e.g. `65 percent`; defaults to `format`. */
  readonly valueText = input<((v: number) => string) | undefined>(undefined);

  protected readonly id = `range-row-${nextId++}`;

  /** Live on `input`, not only `change`, so the preview responds while dragging (§5.1). */
  protected onInput(event: Event): void {
    this.value.set(Number((event.target as HTMLInputElement).value));
  }
}
