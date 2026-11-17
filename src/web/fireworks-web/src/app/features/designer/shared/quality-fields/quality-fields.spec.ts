import {
  ChangeDetectionStrategy,
  Component,
  ViewContainerRef,
  signal,
  viewChild,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import type { DisplayModel } from '../designer-draft';
import { QualityFieldsComponent } from './quality-fields';

/**
 * The Reduce flashing switch never shows a value it doesn't have (Toad, end-review verification:
 * under reduce on a loaded machine the designer's switch first read unchecked, then flipped).
 *
 * The cause is the router, not the input default: `RouterOutlet.activateWith` calls
 * `createComponent` and only `markForCheck`, so the page's template runs in creation mode (its
 * elements are in the document) and its bindings land on the next zoneless tick, a macrotask
 * later. A `[checked]` binding on an element created in creation mode is absent for that gap, so
 * the switch reads unchecked. `Outlet` below does exactly what `activateWith` does.
 */
@Component({
  selector: 'app-test-outlet',
  template: `<ng-container #slot />`,
})
class OutletComponent {
  readonly slot = viewChild.required('slot', { read: ViewContainerRef });
}

@Component({
  imports: [QualityFieldsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-quality-fields [fields]="fields" [reduceFlashing]="reduce()" />`,
})
class PageComponent {
  readonly reduce = signal(true);
  readonly fields = form(
    signal<DisplayModel>({ mode: 'manual', persistence: 0.78, starBudget: 1 }),
  );
}

describe('QualityFields Reduce flashing switch, first render', () => {
  function activate() {
    const outlet = TestBed.createComponent(OutletComponent);
    outlet.detectChanges();
    // RouterOutlet.activateWith: createComponent, then markForCheck. No change detection yet.
    const ref = outlet.componentInstance.slot().createComponent(PageComponent);
    ref.changeDetectorRef.markForCheck();
    const host = ref.location.nativeElement as HTMLElement;
    return { outlet, ref, host };
  }
  const switchIn = (host: HTMLElement) =>
    host.querySelector<HTMLInputElement>('input[role="switch"]#reduce-flashing');

  it('before the first tick there is no switch to read, so it can never read unchecked', () => {
    const { host } = activate();
    const sw = switchIn(host);
    // Either absent, or already showing the store's value. Never present and unchecked.
    expect(sw === null || sw.checked).toBe(true);
    expect(sw).toBeNull();
  });

  it('the first rendered switch shows the bound value: checked under reduce', async () => {
    const { outlet, host } = activate();
    await outlet.whenStable();
    expect(switchIn(host)?.checked).toBe(true);
    expect(host.querySelector('[data-testid="reduce-flashing-value"]')?.textContent?.trim()).toBe(
      'On',
    );
  });

  it('and unchecked when the bound value is off', async () => {
    const { outlet, ref, host } = activate();
    ref.instance.reduce.set(false);
    await outlet.whenStable();
    expect(switchIn(host)?.checked).toBe(false);
  });
});
