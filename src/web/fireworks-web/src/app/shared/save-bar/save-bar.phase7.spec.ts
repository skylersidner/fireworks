import { TestBed } from '@angular/core/testing';
import { SaveBarComponent } from './save-bar';

interface NodeFs {
  readFileSync(p: string, e: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };

/** R4 (phase-7.md §3.4) and R1's aria-keyshortcuts (§3.3); acceptance 7g.18, 7g.19, 7g.9. */
describe('SaveBarComponent Phase 7', () => {
  async function make(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(SaveBarComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('in flight every save button is busy (aria-disabled + .btn-busy); otherwise neither', async () => {
    const idle = await make({ canWrite: true, choices: ['update', 'saveAsNew'] });
    for (const b of idle.querySelectorAll('button'))
      expect([b.classList.contains('btn-busy'), b.getAttribute('aria-disabled')]).toEqual([
        false,
        null,
      ]);
    const busy = await make({ canWrite: true, choices: ['update', 'saveAsNew'], saving: 'update' });
    for (const b of busy.querySelectorAll('button'))
      expect([b.classList.contains('btn-busy'), b.getAttribute('aria-disabled')]).toEqual([
        true,
        'true',
      ]);
  });

  it('only the single-choice Save carries aria-keyshortcuts', async () => {
    const one = await make({ canWrite: true, choices: ['save'] });
    expect(
      one.querySelector('[data-testid="save-save"]')!.getAttribute('aria-keyshortcuts'),
    ).toMatch(/^(Meta|Control)\+S$/);
    const two = await make({ canWrite: true, choices: ['update', 'saveAsNew'] });
    expect(two.querySelector('[aria-keyshortcuts]')).toBeNull();
  });

  it('the player and /status h1s take focus for K7 (tabindex -1)', () => {
    const fs = process.getBuiltinModule('node:fs');
    const src = `${process.cwd()}/src/app`;
    const player = fs.readFileSync(
      `${src}/features/player/pages/player-page/player-page.html`,
      'utf8',
    );
    const status = fs.readFileSync(`${src}/pages/status/status-page.html`, 'utf8');
    expect(player.match(/<h1[^>]*tabindex="-1"/g)).toHaveLength(2);
    expect(status).toMatch(/<h1[^>]*tabindex="-1"/);
  });
});
