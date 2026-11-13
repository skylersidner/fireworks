import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { MAX_BREAKS, MIN_BREAKS } from '../../../../../engine/model/limits';

/** Tab id for break `index` (the tabpanel's `aria-labelledby`). */
export const breakTabId = (index: number) => `break-tab-${index}`;
export const BREAK_PANEL_ID = 'break-panel';

/**
 * Breaks heading row (+ Add, − Remove) and the break tablist (designer-2c.md §3.4, §8.2):
 * roving tabindex, Left/Right/Home/End with automatic activation. After Remove, focus moves to
 * the newly active tab, because the Remove button may just have disabled itself (§8.1).
 */
@Component({
  selector: 'app-break-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="section-heading">
      <span>Breaks</span>
      <span class="flex gap-1.5">
        <button
          type="button"
          class="btn btn-heading"
          aria-label="Add break"
          data-testid="add-break"
          [disabled]="count() >= max"
          [attr.title]="count() >= max ? 'A shell can have up to 4 breaks.' : null"
          (click)="add.emit()"
        >
          + Add
        </button>
        <button
          type="button"
          class="btn btn-heading"
          data-testid="remove-break"
          [attr.aria-label]="'Remove Break ' + (active() + 1)"
          [disabled]="count() <= min"
          [attr.title]="count() <= min ? 'A shell needs at least one break.' : null"
          (click)="onRemove()"
        >
          − Remove
        </button>
      </span>
    </h2>
    <div class="mb-1.5 flex flex-wrap gap-1" role="tablist" aria-label="Breaks">
      @for (n of tabs(); track n) {
        <button
          #tab
          type="button"
          role="tab"
          class="btn btn-sm px-2.5"
          [class.tab-active]="n === active()"
          [id]="tabId(n)"
          [attr.aria-selected]="n === active()"
          [attr.aria-controls]="panelId"
          [attr.tabindex]="n === active() ? 0 : -1"
          (click)="selected.emit(n)"
          (keydown)="onKeydown($event)"
        >
          Break {{ n + 1 }}
        </button>
      }
    </div>
  `,
})
export class BreakTabsComponent {
  readonly count = input.required<number>();
  readonly active = input.required<number>();

  readonly selected = output<number>();
  readonly add = output<void>();
  readonly remove = output<void>();

  protected readonly tabs = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  protected readonly max = MAX_BREAKS;
  protected readonly min = MIN_BREAKS;
  protected readonly panelId = BREAK_PANEL_ID;
  protected readonly tabId = breakTabId;

  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tab');
  private readonly injector = inject(Injector);

  protected onRemove(): void {
    this.remove.emit();
    this.focusActiveTabAfterRender();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const last = this.count() - 1;
    const current = this.active();
    const next =
      event.key === 'ArrowRight'
        ? current >= last
          ? 0
          : current + 1
        : event.key === 'ArrowLeft'
          ? current <= 0
            ? last
            : current - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    this.selected.emit(next);
    this.focusActiveTabAfterRender();
  }

  private focusActiveTabAfterRender(): void {
    afterNextRender(() => this.tabButtons()[this.active()]?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
