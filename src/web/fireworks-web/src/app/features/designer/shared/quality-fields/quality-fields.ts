import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { QUALITY_LIMITS } from '../../../../../engine/model/limits';
import { RangeRowComponent } from '../../../../shared/range-row';
import type { DisplayModel } from '../designer-draft';
import { percent } from '../../../../shared/formats';

/**
 * Display section, this device only (designer-2c.md §3.5, §5.4). Reduce flashing is a native
 * checkbox with role="switch"; it is not form-bound because "the visitor chose" (versus "follows
 * the OS") is the state that matters, so it emits the explicit choice instead.
 *
 * The switch row sits in an `@if`, so it is created in update mode, together with its bindings.
 * A routed page's static elements are created in creation mode: `RouterOutlet.activateWith` calls
 * `createComponent` and only `markForCheck`, and the bindings land on the next zoneless tick, a
 * macrotask later. A switch created then read unchecked for that gap, which a loaded machine made
 * visible under reduce (Toad's end-review verification; `quality-fields.spec.ts`). The input
 * default played no part: inputs are set before the first update either way.
 */
@Component({
  selector: 'app-quality-fields',
  imports: [FormField, RangeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="section-heading">Display</h2>
    <app-range-row
      label="Motion blur"
      [range]="L.persistence"
      [format]="percent"
      [formField]="fields().persistence"
    />
    <app-range-row
      label="Star budget"
      [range]="L.starBudget"
      [format]="percent"
      [formField]="fields().starBudget"
    />
    <!-- Created in update mode so it never exists without its [checked] (see the class comment). -->
    @if (true) {
      <div
        class="my-1.5 grid grid-cols-[96px_1fr_44px] items-center gap-2 pointer-coarse:min-h-[44px]"
      >
        <label for="reduce-flashing" class="text-muted">Reduce flashing</label>
        <span>
          <input
            id="reduce-flashing"
            type="checkbox"
            role="switch"
            class="switch"
            aria-describedby="reduce-flashing-note"
            [checked]="reduceFlashing()"
            (change)="reduceFlashingChange.emit($any($event.target).checked)"
          />
        </span>
        <span class="text-right text-small text-primary" data-testid="reduce-flashing-value">
          {{ reduceFlashing() ? 'On' : 'Off' }}
        </span>
      </div>
    }
    <p class="note" id="reduce-flashing-note">
      Turns off strobe and dims burst flashes.{{
        fromDevice() ? ' On because your device asks for reduced motion.' : ''
      }}
    </p>
    <p class="note">These stay on this device and aren't saved with the shell.</p>
  `,
})
export class QualityFieldsComponent {
  readonly fields = input.required<FieldTree<DisplayModel>>();
  readonly reduceFlashing = input(false);
  readonly fromDevice = input(false);
  readonly reduceFlashingChange = output<boolean>();

  protected readonly L = QUALITY_LIMITS;
  protected readonly percent = percent;
}
