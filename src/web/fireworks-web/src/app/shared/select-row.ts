import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import type { Option } from '../../engine/model/labels';

/** A decorative color dot beside a select (designer-2c.md §5.2). */
export interface SwatchSpec {
  readonly background: string;
  readonly glow: string;
}

let nextId = 0;

/**
 * Labeled native select, optionally with a swatch (designer-2c.md §5.2). A Signal Forms custom
 * control (`FormValueControl<T>`; OQ17), bound with `[formField]`. Option labels are display copy,
 * values are schema values. The swatch is `aria-hidden`: the option text is the accessible value.
 */
@Component({
  selector: 'app-select-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'my-1.5 grid grid-cols-[96px_1fr] items-center gap-2 pointer-coarse:min-h-[44px]',
  },
  template: `
    <label [for]="id" class="text-muted">{{ label() }}</label>
    <div class="flex items-center gap-1.5">
      <select
        class="w-full rounded-md border border-control bg-surface-raised px-[7px] py-[5px] text-primary hover:border-control-hover disabled:cursor-not-allowed disabled:opacity-45"
        [id]="id"
        [disabled]="disabled()"
        (change)="onChange($event)"
        (blur)="touch.emit()"
      >
        @for (option of options(); track option.value) {
          <option [value]="option.value" [selected]="option.value === value()">
            {{ option.label }}
          </option>
        }
      </select>
      @if (swatchSpec(); as s) {
        <span
          aria-hidden="true"
          data-testid="swatch"
          class="inline-block size-3 flex-none rounded-full"
          [style.background]="s.background"
          [style.box-shadow]="'0 0 6px ' + s.glow"
        ></span>
      }
    </div>
  `,
})
export class SelectRowComponent<T extends string = string> implements FormValueControl<T> {
  readonly value = model.required<T>();
  readonly disabled = input(false);
  readonly touch = output<void>();

  readonly label = input.required<string>();
  readonly options = input.required<readonly Option<T>[]>();
  readonly swatch = input<((value: T) => SwatchSpec | null) | undefined>(undefined);

  protected readonly id = `select-row-${nextId++}`;
  protected readonly swatchSpec = computed(() => this.swatch()?.(this.value()) ?? null);

  protected onChange(event: Event): void {
    this.value.set((event.target as HTMLSelectElement).value as T);
  }
}
