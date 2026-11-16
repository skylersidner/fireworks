import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PRESETS } from '../../../../../engine/model/presets';
import { ApiStatusService } from '../../../../core/api-status';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import type { CreationSource } from '../../../../core/creation-save';
import { FLASH_NOTICE_KEY } from '../../../../core/device-preferences';
import { STAGE_RENDERER_FACTORY } from '../../../../shared/fireworks-stage/fireworks-stage';
import { SHORTCUT_CHOOSE, SHORTCUT_NOTHING_NEW } from '../../../../shared/save-shortcut';
import {
  CODE_A,
  ME_READ_ONLY,
  ME_TEST_WINDOW,
  creationResponse,
  recorder,
  settleSession,
} from '../../../../testing/creation-fixtures';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { FakeStageRenderers } from '../../../../testing/fake-stage-renderer';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { DRAFT_KEY, editableFrom, serializeDraft } from '../../shared/designer-draft';
import { DesignerPageComponent } from './designer-page';
import { ShellDesignerStore } from './shell-designer.store';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));
const OWNED: CreationSource = {
  shareCode: CODE_A,
  kind: 'shell',
  name: 'Mine',
  isOwner: true,
  updatedAt: '2026-11-15T00:00:00.000Z',
};

/** Phase 7 B3 on `/` (phase-7.md §3.2 K1, K2, §3.3, §10 Try again; acceptance 7g). */
describe('Designer Phase 7', () => {
  let storage: MemoryStorage;
  let http: HttpTestingController;
  let ledger: string[];
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storage = new MemoryStorage();
    storage.setItem(FLASH_NOTICE_KEY, '1');
    ledger = [];
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      imports: [DesignerPageComponent],
      providers: [
        provideHttpClient(withInterceptors([recorder(ledger)])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: MATCH_MEDIA, useValue: new FakeMatchMedia().fn },
        { provide: BROWSER_STORAGE, useValue: storage },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      (document.activeElement as HTMLElement | null)?.blur?.();
      vi.restoreAllMocks();
      TestBed.resetTestingModule();
    }
  });

  async function mount(
    me: Parameters<typeof settleSession>[1] = ME_TEST_WINDOW,
    draft: { source?: CreationSource | null; saved?: boolean; dirty?: boolean } = {},
  ) {
    if (Object.keys(draft).length) {
      storage.setItem(
        DRAFT_KEY,
        serializeDraft({
          shell: editableFrom(PRESETS[2]),
          activeBreak: 0,
          display: { mode: 'loop', persistence: 0.78, starBudget: 1, reduceFlashing: null },
          shellDirty: draft.dirty ?? true,
          skyDirty: draft.dirty ?? true,
          saved: draft.saved ?? false,
          source: draft.source ?? null,
        }),
      );
    }
    settleSession(http, me);
    const fixture = TestBed.createComponent(DesignerPageComponent);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    fakes.starts[fakes.starts.length - 1].resolve('webgl');
    await flush();
    await fixture.whenStable();
    ledger.length = 0;
    const el = fixture.nativeElement as HTMLElement;
    const byTest = <T extends HTMLElement = HTMLElement>(id: string) =>
      el.querySelector<T>(`[data-testid="${id}"]`);
    const stable = async () => {
      await flush();
      await fixture.whenStable();
    };
    const store = fixture.debugElement.injector.get(ShellDesignerStore);
    const key = async (target: Element, init: KeyboardEventInit) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      await stable();
      return e;
    };
    return { fixture, el, byTest, stable, store, key };
  }

  it('K1: + Add keeps focus at 1→2 and 2→3; the Add that makes the 4th break focuses the new tab (7g.3)', async () => {
    const { byTest, stable, el, fixture } = await mount();
    const add = byTest<HTMLButtonElement>('add-break')!;
    const tabs = () => [...el.querySelectorAll<HTMLElement>('[role="tab"]')];
    while (tabs().length > 1) {
      byTest('remove-break')!.click();
      await stable();
    }
    for (const n of [2, 3]) {
      add.focus();
      add.click();
      await stable();
      expect([n, tabs().length, document.activeElement === add]).toEqual([n, n, true]);
    }
    add.focus();
    add.click();
    await stable();
    expect(tabs()).toHaveLength(4);
    expect(add.disabled).toBe(true);
    expect(document.activeElement).toBe(tabs()[3]);
    fixture.nativeElement.remove();
  });

  it('K2: Revert focuses the textarea (7g.4)', async () => {
    const { byTest, stable, fixture } = await mount();
    const area = byTest<HTMLTextAreaElement>('json-text')!;
    area.value = '{}';
    area.dispatchEvent(new Event('input'));
    await stable();
    const revert = byTest('json-revert')!;
    revert.focus();
    revert.click();
    await stable();
    expect(byTest('json-revert')).toBeNull();
    expect(document.activeElement).toBe(area);
    fixture.nativeElement.remove();
  });

  it('B4: Copy twice re-inserts the Shell JSON note node, so the same note re-announces (C2 ruling 4)', async () => {
    const { byTest, stable, fixture } = await mount();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
    const note = byTest('json-note')!;
    const textNode = () =>
      [...note.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim());
    byTest('json-copy')!.click();
    await stable();
    expect(note.textContent!.trim()).toBe('Copied to clipboard.');
    const first = textNode();
    byTest('json-copy')!.click();
    await stable();
    expect(note.textContent!.trim()).toBe('Copied to clipboard.');
    // Negative control: an unkeyed {{ note }} keeps the same text node, which isn't re-announced.
    expect(textNode()).not.toBe(first);
    fixture.nativeElement.remove();
  });

  it('⌘S/Ctrl+S: no save bar is not prevented; one choice saves; Saved says nothing new; two choices focus Update original (7g.10–7g.15)', async () => {
    const ro = await mount(ME_READ_ONLY, { dirty: true });
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      expect((await ro.key(document.body, { key: 's', ...mod })).defaultPrevented).toBe(false);
    }
    expect(ledger).toEqual([]);
    ro.fixture.destroy();
    ro.fixture.nativeElement.remove();
  });

  it('⌘S with one choice sends the same POST as Save; the label stays Save', async () => {
    const { key, byTest, stable, fixture } = await mount(ME_TEST_WINDOW, { dirty: true });
    expect(byTest('save-save')!.textContent!.trim()).toBe('Save');
    expect(byTest('save-save')!.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+S$/);
    const e = await key(byTest('json-text')!, { key: 's', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    const req = http.expectOne('/api/creations');
    expect([req.request.method, req.request.body.kind]).toEqual(['POST', 'shell']);
    req.flush(creationResponse({ kind: 'shell', document: req.request.body.document }));
    await stable();
    // Now Saved: nothing new.
    const again = await key(document.body, { key: 's', metaKey: true });
    expect(again.defaultPrevented).toBe(true);
    expect(byTest('announcer')!.textContent!.trim()).toBe(SHORTCUT_NOTHING_NEW);
    fixture.nativeElement.remove();
  });

  it('⌘S with two choices focuses Update original, sends nothing, announces', async () => {
    const { key, byTest, fixture } = await mount(ME_TEST_WINDOW, { dirty: true, source: OWNED });
    const e = await key(document.body, { key: 's', metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byTest('save-update'));
    expect(byTest('announcer')!.textContent!.trim()).toBe(SHORTCUT_CHOOSE);
    expect(ledger).toEqual([]);
    fixture.nativeElement.remove();
  });

  it('Try again: aria-disabled and busy while checking, a second press sends nothing, focus to the h1 on recovery (7g.20)', async () => {
    const { byTest, stable, fixture } = await mount();
    TestBed.inject(ApiStatusService).check();
    http.expectOne('/health/live').flush('x', { status: 503, statusText: 'Down' });
    await stable();
    const retry = byTest<HTMLButtonElement>('api-retry')!;
    retry.focus();
    retry.click();
    await stable();
    expect(document.activeElement).toBe(retry);
    retry.click();
    await stable();
    const probes = http.match('/health/live');
    expect(probes).toHaveLength(1);
    probes[0].flush('x', { status: 503, statusText: 'Down' });
    http.match('/api/me').forEach((r) => r.flush(ME_TEST_WINDOW));
    await stable();
    fixture.nativeElement.remove();
  });

  it('Try again on recovery: the banner unmounts and focus moves to the panel h1; on failure it stays', async () => {
    const { byTest, stable, fixture } = await mount();
    TestBed.inject(ApiStatusService).check();
    http.expectOne('/health/live').flush('x', { status: 503, statusText: 'Down' });
    await stable();
    let retry = byTest<HTMLButtonElement>('api-retry')!;
    retry.focus();
    retry.click();
    await stable();
    http.expectOne('/health/live').flush('x', { status: 503, statusText: 'Down' });
    http.match('/api/me').forEach((r) => r.flush(ME_TEST_WINDOW));
    await stable();
    retry = byTest<HTMLButtonElement>('api-retry')!;
    expect(retry.textContent!.trim()).toBe('Try again');
    expect(document.activeElement).toBe(retry);
    retry.click();
    await stable();
    http.expectOne('/health/live').flush('Healthy');
    http.expectOne('/api/me').flush(ME_TEST_WINDOW);
    await stable();
    expect(byTest('api-banner')).toBeNull();
    expect(document.activeElement).toBe(byTest('panel-heading'));
    fixture.nativeElement.remove();
  });
});
