import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormField, disabled, form } from '@angular/forms/signals';
import type { Option } from '../../engine/model/labels';
import { RangeRowComponent } from './range-row';
import { SelectRowComponent } from './select-row';

const swatch = (v: string) => (v === 'none' ? null : { background: '#ff0000', glow: '#ff0000' });

@Component({
  imports: [FormField, RangeRowComponent, SelectRowComponent],
  template: `
    <app-range-row
      label="Stars"
      [range]="{ min: 4, max: 400, step: 1 }"
      [format]="fmt"
      [valueText]="text"
      [formField]="f.stars"
    />
    <app-select-row label="Color" [options]="options" [swatch]="swatch" [formField]="f.color" />
  `,
})
class Host {
  readonly model = signal({ stars: 120, color: 'red', locked: false });
  readonly f = form(this.model, (p) => {
    disabled(p.stars, ({ valueOf }) => valueOf(p.locked));
  });
  readonly options: Option[] = [
    { value: 'none', label: 'No change' },
    { value: 'red', label: 'Red' },
  ];
  readonly fmt = (v: number) => `${v}!`;
  readonly text = (v: number) => `${v} stars`;
  readonly swatch = swatch;
}

describe('range-row and select-row (Signal Forms custom controls, designer-2c.md §5)', () => {
  async function mount() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      host: fixture.componentInstance,
      range: el.querySelector<HTMLInputElement>('input[type="range"]')!,
      output: el.querySelector('output')!,
      select: el.querySelector('select')!,
      el,
    };
  }

  it('range-row shows the model, writes on input (live while dragging), labels and valuetext', async () => {
    const { fixture, host, range, output, el } = await mount();
    expect([range.min, range.max, range.step, range.value]).toEqual(['4', '400', '1', '120']);
    expect(output.textContent?.trim()).toBe('120!');
    expect(range.getAttribute('aria-valuetext')).toBe('120 stars');
    expect(el.querySelector(`label[for="${range.id}"]`)?.textContent).toBe('Stars');

    range.value = '200';
    range.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(host.model().stars).toBe(200);
    expect(output.textContent?.trim()).toBe('200!');
  });

  it('range-row takes disabled from the field state', async () => {
    const { fixture, host, range } = await mount();
    expect(range.disabled).toBe(false);
    host.model.update((m) => ({ ...m, locked: true }));
    await fixture.whenStable();
    expect(range.disabled).toBe(true);
  });

  it('select-row selects the model value, writes on change, and swatches (none: no swatch)', async () => {
    const { fixture, host, select, el } = await mount();
    expect(select.value).toBe('red');
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['No change', 'Red']);
    expect(el.querySelector('[data-testid="swatch"]')?.getAttribute('aria-hidden')).toBe('true');

    select.value = 'none';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(host.model().color).toBe('none');
    expect(el.querySelector('[data-testid="swatch"]')).toBeNull();

    host.model.update((m) => ({ ...m, color: 'red' }));
    await fixture.whenStable();
    expect(select.value).toBe('red');
  });
});
