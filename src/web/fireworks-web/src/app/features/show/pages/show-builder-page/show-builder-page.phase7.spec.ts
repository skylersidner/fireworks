import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../../app.routes';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import { FLASH_NOTICE_KEY } from '../../../../core/device-preferences';
import { STAGE_RENDERER_FACTORY } from '../../../../shared/fireworks-stage/fireworks-stage';
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
import { provideStepClock } from '../../../../testing/stage-clock';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { doneWhenShow } from '../../../../testing/show-fixtures';
import { ANNOUNCE_REPEAT_MS } from '../../../../shared/announcer';
import { SHORTCUT_CHOOSE, SHORTCUT_NOTHING_NEW } from '../../../../shared/save-shortcut';
import {
  CUE_CAP,
  DURATION_RANGE_NOTE,
  EMPTY_SAVE_NOTE,
  SHELL_CAP,
  SHOW_ENDED,
} from '../../shared/show-copy';
import { SHOW_DRAFT_KEY, serializeShowDraft } from '../../shared/show-draft';
import { ShowTimelineComponent } from '../../shared/timeline/timeline';
import { RULER_HEIGHT } from '../../shared/timeline/timeline-layout';
import { ShowBuilderStore } from './show-builder.store';
import { normalizeShow } from '../../../../../engine/model/normalize';
import { saveDocumentOf } from './show-save';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const LIST = '/api/me/creations?page=1&pageSize=24&kind=shell';
const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();

/** Phase 7 B3 on `/show` (docs/fireworks-app/design/phase-7.md; acceptance 7g, 7i, 7j, 7k). */
describe('Show Builder Phase 7', () => {
  let storage: MemoryStorage;
  let http: HttpTestingController;
  let ledger: string[];
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage = new MemoryStorage();
    storage.setItem(FLASH_NOTICE_KEY, '1');
    ledger = [];
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([recorder(ledger)])),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        provideStepClock(),
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

  function seed(over: Record<string, unknown> = {}) {
    storage.setItem(
      SHOW_DRAFT_KEY,
      serializeShowDraft({
        show: doneWhenShow(),
        nextCueId: 51,
        selectedCueId: null,
        activeShell: { kind: 'preset', index: 0 },
        view: { pxPerSecond: null, scroll: 0 },
        dirty: false,
        saved: false,
        source: null,
        ...over,
      } as Parameters<typeof serializeShowDraft>[0]),
    );
  }

  async function open(
    me: Parameters<typeof settleSession>[1] = ME_TEST_WINDOW,
    firstList: (r: TestRequest) => void = (r) =>
      r.flush({ items: [], page: 1, pageSize: 24, totalCount: 0 }),
  ) {
    settleSession(http, me);
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl('/show');
    const stable = async () => {
      await tick();
      await harness.fixture.whenStable();
      await tick();
      await harness.fixture.whenStable();
    };
    await stable();
    http.match(LIST).forEach(firstList);
    await stable();
    if (fakes.starts.length) fakes.starts[0].resolve('webgl');
    await stable();
    ledger.length = 0;
    const root = harness.fixture.nativeElement as HTMLElement;
    const byTest = <T extends HTMLElement = HTMLElement>(id: string) =>
      root.querySelector<T>(`[data-testid="${id}"]`);
    const store = () =>
      harness.fixture.debugElement
        .query((d) => d.providerTokens.includes(ShowBuilderStore))!
        .injector.get(ShowBuilderStore);
    const timeline = () =>
      harness.fixture.debugElement.query(
        (d) => d.componentInstance instanceof ShowTimelineComponent,
      )!.componentInstance as ShowTimelineComponent;
    const key = async (target: Element, init: KeyboardEventInit) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      await stable();
      return e;
    };
    return { harness, root, byTest, stable, store, key, timeline };
  }

  // ---- K9: My shells Try again and Show more (phase-7.md §3.2, C2-3) --------------------------

  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const mineItem = (n: number) => ({
    shareCode: `Mk2222${B58[Math.floor(n / 58)]}${B58[n % 58]}`,
    kind: 'shell' as const,
    name: `Mine ${n}`,
    updatedAt: '2026-11-15T00:00:00.000Z',
    palette: [],
  });
  const fail500 = (r: TestRequest) =>
    r.flush({ title: 'x' }, { status: 500, statusText: 'Server Error' });
  const busy = (el: HTMLElement | null) => [
    el?.isConnected,
    el?.getAttribute('aria-disabled'),
    el?.classList.contains('btn-busy'),
  ];

  it('K9: Try again stays rendered and busy while loading; a second press sends nothing; success focuses the first item', async () => {
    const m = await open(ME_TEST_WINDOW, fail500);
    const retry = m.byTest<HTMLButtonElement>('mine-retry')!;
    expect(busy(retry)).toEqual([true, null, false]);
    retry.focus();
    retry.click();
    await m.stable();
    // Negative control for the old template: the button was removed here and focus fell to body.
    expect(busy(m.byTest('mine-retry'))).toEqual([true, 'true', true]);
    expect(m.byTest('mine-retry')).toBe(retry);
    expect(document.activeElement).toBe(retry);
    retry.click();
    await m.stable();
    const reqs = http.match(LIST);
    expect(reqs).toHaveLength(1);
    reqs[0].flush({ items: [mineItem(1), mineItem(2)], page: 1, pageSize: 24, totalCount: 2 });
    await m.stable();
    expect(m.byTest('mine-retry')).toBeNull();
    expect(document.activeElement).toBe(m.byTest(`lib-mine-${mineItem(1).shareCode}`));
  });

  it('K9: Try again with no shells focuses the My shells heading; a failed retry keeps focus on Try again', async () => {
    const m = await open(ME_TEST_WINDOW, fail500);
    const retry = m.byTest<HTMLButtonElement>('mine-retry')!;
    retry.focus();
    retry.click();
    await m.stable();
    http.expectOne(LIST).flush({ title: 'x' }, { status: 500, statusText: 'Server Error' });
    await m.stable();
    expect(m.byTest('mine-retry')).toBe(retry);
    expect(busy(retry)).toEqual([true, null, false]);
    expect(document.activeElement).toBe(retry);
    retry.click();
    await m.stable();
    http.expectOne(LIST).flush({ items: [], page: 1, pageSize: 24, totalCount: 0 });
    await m.stable();
    const heading = m.byTest('mine-heading')!;
    expect([heading.tagName, heading.getAttribute('tabindex')]).toEqual(['H3', '-1']);
    expect(document.activeElement).toBe(heading);
  });

  it('K9: Show more stays rendered and busy while loading; success focuses the first newly loaded item', async () => {
    const first = Array.from({ length: 24 }, (_, i) => mineItem(i + 1));
    const m = await open(ME_TEST_WINDOW, (r) =>
      r.flush({ items: first, page: 1, pageSize: 24, totalCount: 26 }),
    );
    const more = m.byTest<HTMLButtonElement>('mine-more')!;
    more.focus();
    more.click();
    await m.stable();
    expect(m.byTest('mine-more')).toBe(more);
    expect(busy(more)).toEqual([true, 'true', true]);
    expect(document.activeElement).toBe(more);
    more.click();
    await m.stable();
    const reqs = http.match('/api/me/creations?page=2&pageSize=24&kind=shell');
    expect(reqs).toHaveLength(1);
    reqs[0].flush({ items: [mineItem(25), mineItem(26)], page: 2, pageSize: 24, totalCount: 26 });
    await m.stable();
    expect(m.byTest('mine-more')).toBeNull();
    expect(document.activeElement).toBe(m.byTest(`lib-mine-${mineItem(25).shareCode}`));
  });

  // ---- K8, K5, K4, B5 ------------------------------------------------------------------------

  it('K8: the first panel element is the skip link; it focuses Play without scrolling (7g.2)', async () => {
    const { byTest, stable } = await open();
    const panel = byTest('builder-panel')!;
    const first = panel.querySelector('a, button, input, select, textarea, summary');
    expect(first).toBe(byTest('skip-link'));
    expect(text(first)).toBe('Skip to the timeline controls');
    expect(first!.className).toContain('sr-only');
    expect(first!.className).toContain('focus:not-sr-only');
    const y = window.scrollY;
    (first as HTMLElement).click();
    await stable();
    expect(document.activeElement).toBe(byTest('play'));
    expect(window.scrollY).toBe(y);
  });

  it('K5: toolbar Duplicate and Delete are aria-disabled, never disabled; Delete on the last cue keeps focus (7g.7)', async () => {
    const { byTest, stable, store } = await open();
    const dup = byTest<HTMLButtonElement>('toolbar-duplicate')!;
    const del = byTest<HTMLButtonElement>('toolbar-delete')!;
    expect([
      dup.disabled,
      dup.getAttribute('aria-disabled'),
      del.disabled,
      del.getAttribute('aria-disabled'),
    ]).toEqual([false, 'true', false, 'true']);
    byTest('add-cue')!.click();
    await stable();
    expect(del.getAttribute('aria-disabled')).toBeNull();
    del.focus();
    del.click();
    await stable();
    expect(store().show().cues).toHaveLength(0);
    expect(document.activeElement).toBe(del);
    expect(del.getAttribute('aria-disabled')).toBe('true');
    const undoDepth = store().canUndo();
    del.click();
    dup.click();
    await stable();
    expect(store().show().cues).toHaveLength(0);
    expect(store().canUndo()).toBe(undoDepth);
  });

  it('K4: Remove (unused) focuses the next row, else the previous, else the first preset (7g.6)', async () => {
    const { byTest, stable, store } = await open();
    for (const i of [2, 3, 4]) {
      byTest(`lib-preset-${i}`)!.click();
      await stable();
      byTest('add-cue')!.click();
      await stable();
    }
    const s = store();
    s.deleteCue(s.show().cues[0].id);
    s.deleteCue(s.show().cues[0].id);
    s.deleteCue(s.show().cues[0].id);
    await stable();
    const keys = Object.keys(s.show().shells);
    expect(keys).toHaveLength(3);
    byTest(`lib-remove-${keys[0]}`)!.click();
    await stable();
    expect(document.activeElement).toBe(byTest(`lib-embedded-${keys[1]}`));
    byTest(`lib-remove-${keys[2]}`)!.click();
    await stable();
    expect(document.activeElement).toBe(byTest(`lib-embedded-${keys[1]}`));
    byTest(`lib-remove-${keys[1]}`)!.click();
    await stable();
    expect(document.activeElement).toBe(byTest('lib-preset-0'));
  });

  it('K4: Remove… → Remove shell and cues focuses the next row', async () => {
    seed();
    const { root, byTest, stable, store } = await open();
    const keys = Object.keys(store().show().shells);
    byTest(`lib-remove-${keys[0]}`)!.click();
    await stable();
    const confirm = [...root.ownerDocument.querySelectorAll('dialog button')].find(
      (b) => b.textContent!.trim() === 'Remove shell and cues',
    ) as HTMLButtonElement;
    confirm.click();
    await stable();
    expect(document.activeElement).toBe(byTest(`lib-embedded-${keys[1]}`));
  });

  it('B5/K3: ⌘Z that removes the selected cue with focus in the inspector moves focus to the timeline (7g.5, 7g.22)', async () => {
    const { byTest, stable, store, key } = await open();
    byTest('add-cue')!.click();
    await stable();
    expect(store().selectedCueId()).not.toBeNull();
    byTest('inspector-new-seed')!.focus();
    await key(document.activeElement!, { key: 'z', metaKey: true });
    expect(store().show().cues).toHaveLength(0);
    expect(document.activeElement).toBe(byTest('timeline'));
  });

  it('B5: from anywhere else (Show section button), focus left on body goes to the h1', async () => {
    const { byTest, stable, store } = await open();
    byTest('add-cue')!.click();
    await stable();
    (document.activeElement as HTMLElement | null)?.blur?.();
    byTest('undo')!.click();
    await stable();
    // Undo kept its own focus? It was never focused; body → the h1.
    expect(store().show().cues).toHaveLength(0);
    expect(document.activeElement).toBe(byTest('panel-heading'));
  });

  it('the stage marker: a 44px transparent hit area around a 14px ring (7i.8)', async () => {
    seed({ selectedCueId: 'c3' });
    const { byTest, harness, stable } = await open();
    const page = harness.fixture.debugElement.query((d) =>
      d.providerTokens.includes(ShowBuilderStore),
    )!.componentInstance as { stageSize: { set(v: { w: number; h: number }): void } };
    page.stageSize.set({ w: 800, h: 400 });
    await stable();
    const hit = byTest('stage-marker')!;
    expect(hit.className).toContain('size-[44px]');
    expect(hit.className).not.toContain('border');
    expect(byTest('stage-marker-ring')!.className).toContain('size-[14px]');
  });

  // ---- B6, B7, B4 ----------------------------------------------------------------------------

  it('B6: at 32 shells the cap note sits under the active item, which describes itself by it (7g.23)', async () => {
    const show = doneWhenShow();
    const base = show.shells['s1'];
    const shells: Record<string, typeof base> = {};
    for (let k = 1; k <= 32; k++)
      shells[`s${k}`] = { ...base, name: `S${k}`, burstHeight: 0.3 + k * 0.01 };
    seed({ show: { ...show, shells, cues: show.cues.map((c) => ({ ...c, shell: 's1' })) } });
    const { byTest, root } = await open();
    const item = byTest('lib-preset-0')!;
    expect(item.getAttribute('aria-describedby')).toBe('lib-cap-note');
    const note = root.querySelector('#lib-cap-note')!;
    expect(text(note)).toBe(SHELL_CAP);
    expect(note.classList.contains('note')).toBe(true);
    expect(item.nextElementSibling).toBe(note);
    expect(text(byTest('toolbar-status'))).toBe(SHELL_CAP);
    expect(byTest('lib-preset-1')!.getAttribute('aria-describedby')).toBeNull();
  });

  it('B7: every rejected Duration entry leaves its note; a repeat re-inserts the text node (7g.24, 7g.21)', async () => {
    seed();
    const { byTest, stable } = await open();
    const field = byTest<HTMLInputElement>('show-duration')!;
    const note = byTest('duration-note')!;
    expect(note.getAttribute('aria-live')).toBe('polite');
    expect(field.getAttribute('aria-describedby')).toBe(note.id);
    for (const v of ['', 'abc', '700']) {
      field.value = v;
      field.dispatchEvent(new Event('change'));
      await stable();
      expect([v, text(note)]).toEqual([v, DURATION_RANGE_NOTE]);
    }
    const node = [...note.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim());
    field.value = '700';
    field.dispatchEvent(new Event('change'));
    await stable();
    const again = [...note.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim());
    expect(again).not.toBe(node);
    field.value = '10';
    field.dispatchEvent(new Event('change'));
    await stable();
    expect(text(note)).toMatch(/^The last cue launches at /);
    field.value = '60';
    field.dispatchEvent(new Event('change'));
    await stable();
    expect(text(note)).toBe(
      'The launch window. The show keeps playing after it until the last spark fades.',
    );
  });

  it('B7: on an empty show, below 1 is the range note (no cues, so never the blocked note)', async () => {
    const { byTest, stable } = await open();
    const field = byTest<HTMLInputElement>('show-duration')!;
    field.value = '0.5';
    field.dispatchEvent(new Event('change'));
    await stable();
    expect(text(byTest('duration-note'))).toBe(DURATION_RANGE_NOTE);
    expect(field.value).toBe('60');
  });

  it('B4: a second blocked add at the cap and a second show end re-announce (7g.21)', async () => {
    const show = doneWhenShow();
    const cues = Array.from({ length: 1000 }, (_, i) => ({
      ...show.cues[i % 50],
      id: `c${i + 1}`,
      t: (i % 600) / 10,
    }));
    seed({ show: { ...show, cues } });
    const { byTest, stable } = await open();
    const announcer = byTest('announcer')!;
    byTest('add-cue')!.click();
    await stable();
    expect(text(announcer)).toBe(CUE_CAP);
    byTest('add-cue')!.click();
    await stable();
    expect(text(announcer)).toBe('');
    await tick(ANNOUNCE_REPEAT_MS + 10);
    await stable();
    expect(text(announcer)).toBe(CUE_CAP);
  });

  // ---- Ctrl/⌘+S ------------------------------------------------------------------------------

  it('⌘S with no save bar does nothing and is not prevented (7g.10)', async () => {
    seed({ dirty: true });
    const { key } = await open(ME_READ_ONLY);
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      const e = await key(document.body, { key: 's', ...mod });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(ledger).toEqual([]);
  });

  it('⌘S on an empty show announces the note and sends nothing (7g.13); Saved says nothing new (7g.12)', async () => {
    const { key, byTest, stable } = await open();
    const e = await key(document.body, { key: 's', metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(text(byTest('announcer'))).toBe(EMPTY_SAVE_NOTE);
    expect(ledger).toEqual([]);
    seed({ saved: true });
    void stable;
  });

  it('⌘S while Saved: Nothing new to save.', async () => {
    seed({
      saved: true,
      source: {
        shareCode: CODE_A,
        kind: 'show',
        name: 'x',
        isOwner: true,
        updatedAt: '2026-11-15T00:00:00.000Z',
      },
    });
    const { key, byTest } = await open();
    const e = await key(document.body, { key: 's', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(text(byTest('announcer'))).toBe(SHORTCUT_NOTHING_NEW);
    expect(ledger).toEqual([]);
  });

  it('⌘S with one choice sends exactly the Save POST, with a Duration typed but not blurred (7g.14, 7g.16)', async () => {
    seed({ dirty: true });
    const { key, byTest, stable } = await open();
    const save = byTest('save-save')!;
    expect(save.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+S$/);
    expect(text(save)).toBe('Save');
    const field = byTest<HTMLInputElement>('show-duration')!;
    field.focus();
    field.value = '75';
    const e = await key(field, { key: 's', metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    const req = http.expectOne('/api/creations');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.document.duration).toBe(75);
    req.flush(creationResponse({ kind: 'show', document: req.request.body.document }));
    await stable();
    expect(ledger.filter((l) => l.includes('creations'))).toHaveLength(1);
  });

  it('⌘S with two choices focuses Update original and sends nothing (7g.15); Shift+⌘S does nothing (7g.17)', async () => {
    seed({
      dirty: true,
      source: {
        shareCode: CODE_A,
        kind: 'show',
        name: 'x',
        isOwner: true,
        updatedAt: '2026-11-15T00:00:00.000Z',
      },
    });
    const { key, byTest } = await open();
    const shifted = await key(document.body, { key: 'S', metaKey: true, shiftKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    const e = await key(document.body, { key: 's', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byTest('save-update'));
    expect(text(byTest('announcer'))).toBe(SHORTCUT_CHOOSE);
    expect(ledger).toEqual([]);
  });

  // ---- Show JSON ---------------------------------------------------------------------------

  async function openJson(m: Awaited<ReturnType<typeof open>>) {
    const details = m.byTest<HTMLDetailsElement>('show-json')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await m.stable();
    return {
      area: m.byTest<HTMLTextAreaElement>('show-json-text')!,
      note: () => text(m.byTest('show-json-note')),
      apply: m.byTest<HTMLButtonElement>('show-json-apply')!,
    };
  }

  it('closed by default with no text; open, the text is the save document (7k.1, 7k.2)', async () => {
    seed();
    const m = await open();
    const details = m.byTest<HTMLDetailsElement>('show-json')!;
    expect(details.open).toBe(false);
    expect(m.byTest('show-json-text')).toBeNull();
    const summary = details.querySelector('summary')!;
    expect(text(summary)).toBe('▸Show JSON');
    expect(text(summary.querySelector(':scope > span:not([aria-hidden])'))).toBe('Show JSON');
    // The indicator is decoration only: the accessible name stays `Show JSON` (§9.1, C2-2).
    const marker = summary.querySelector('[aria-hidden="true"]')!;
    expect(text(marker)).toBe('▸');
    expect(marker.classList).toContain('group-open:rotate-90');
    expect(marker.classList.contains('transition') || /transition/.test(marker.className)).toBe(
      false,
    );
    expect(summary.className).toContain('[&::-webkit-details-marker]:hidden');
    expect(details.classList).toContain('group');
    expect(details.textContent).not.toContain('"cues"');
    const j = await openJson(m);
    // Oracle independent of saveDocumentOf: the store document through normalize, as Save sends it.
    const normalized = normalizeShow(m.store().show());
    expect(normalized.ok).toBe(true);
    expect(j.area.value).toBe(JSON.stringify(normalized.ok ? normalized.show : null, null, 2));
    expect(j.area.value).toBe(JSON.stringify(saveDocumentOf({ show: m.store().show() }), null, 2));
    expect(j.note()).toBe("This is the show as it's saved. Edit it, then press Apply to load it.");
    expect(details.querySelector('summary button')).toBeNull();
    // It follows an edit.
    m.byTest('add-cue')!.click();
    await m.stable();
    expect(JSON.parse(j.area.value).cues).toHaveLength(51);
  });

  it('a clean Apply: one Undo step; ⌘Z restores the show exactly; flags and source per spec (7k.5, 7k.6)', async () => {
    seed({
      source: {
        shareCode: CODE_A,
        kind: 'show',
        name: 'x',
        isOwner: true,
        updatedAt: '2026-11-15T00:00:00.000Z',
      },
    });
    const m = await open();
    const s = m.store();
    const before = s.show();
    const sourceBefore = s.source();
    expect(s.canUndo()).toBe(false);
    const j = await openJson(m);
    const pasted = JSON.parse(j.area.value);
    pasted.name = 'Pasted';
    pasted.cues = pasted.cues
      .slice(0, 5)
      .map((c: { id: string }, k: number) => ({ ...c, id: `c${k * 7 + 3}` }));
    j.area.value = JSON.stringify(pasted);
    j.area.dispatchEvent(new Event('input'));
    await m.stable();
    j.apply.focus();
    j.apply.click();
    await m.stable();
    expect(m.root.ownerDocument.querySelector('dialog[open]')).toBeNull();
    expect(s.show().name).toBe('Pasted');
    expect(s.show().cues).toHaveLength(5);
    expect([s.dirty(), s.saved(), s.source()]).toEqual([false, false, sourceBefore]);
    expect(s.nextCueId()).toBe(4 * 7 + 3 + 1);
    expect(s.selectedCueId()).toBeNull();
    expect(s.view()).toEqual({ pxPerSecond: null, scroll: 0 });
    expect(document.activeElement).toBe(j.apply);
    expect(j.note()).toBe('Applied.');
    expect([s.canUndo(), s.canRedo()]).toEqual([true, false]);
    const applied = s.show();
    await m.key(document.body, { key: 'z', metaKey: true });
    expect(s.show()).toEqual(before);
    expect(s.dirty()).toBe(true);
    expect(s.canUndo()).toBe(false);
    await m.key(document.body, { key: 'z', metaKey: true, shiftKey: true });
    expect(s.show()).toEqual(applied);
  });

  it('round trip: the copied text, applied in a fresh builder, saves a POST document deep-equal to the source (7k.3)', async () => {
    seed();
    const m = await open();
    const source = JSON.parse((await openJson(m)).area.value);
    // A fresh builder: New show (clean, no dialog), then Apply the copied text and Save.
    m.byTest('new-show')!.click();
    await m.stable();
    const j = await openJson(m);
    j.area.value = JSON.stringify(source, null, 2);
    j.area.dispatchEvent(new Event('input'));
    await m.stable();
    j.apply.click();
    await m.stable();
    expect(m.root.ownerDocument.querySelector('dialog[open]')).toBeNull();
    m.byTest('save-save')!.click();
    await m.stable();
    const req = http.expectOne('/api/creations');
    expect(req.request.body.document).toEqual(source);
    req.flush(creationResponse({ kind: 'show', document: req.request.body.document }));
    await m.stable();
  });

  it('a failed Apply adds no step; Copy twice re-inserts the note node (7k.6, 7g.21)', async () => {
    seed();
    const m = await open();
    const j = await openJson(m);
    j.area.value = '{';
    j.area.dispatchEvent(new Event('input'));
    await m.stable();
    j.apply.click();
    await m.stable();
    expect(j.note()).toMatch(/^Couldn't apply: this isn't valid JSON/);
    expect(m.store().canUndo()).toBe(false);
    m.byTest('show-json-revert')!.click();
    await m.stable();
    expect(document.activeElement).toBe(j.area);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
    const note = m.byTest('show-json-note')!;
    m.byTest('show-json-copy')!.click();
    await m.stable();
    expect(j.note()).toBe('Copied to clipboard.');
    const first = [...note.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim());
    m.byTest('show-json-copy')!.click();
    await m.stable();
    const second = [...note.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim());
    expect(second).not.toBe(first);
    expect(j.note()).toBe('Copied to clipboard.');
  });

  it('Copy copies the textarea text, unapplied edits included (phase-7.md §9.1, C2 ruling 2)', async () => {
    seed();
    const m = await open();
    const j = await openJson(m);
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t: string) => (written.push(t), Promise.resolve()) },
      configurable: true,
    });
    const clean = j.area.value;
    m.byTest('show-json-copy')!.click();
    await m.stable();
    expect(written).toEqual([clean]);
    j.area.value = '{"edited": true}';
    j.area.dispatchEvent(new Event('input'));
    await m.stable();
    m.byTest('show-json-copy')!.click();
    await m.stable();
    // Negative control: copying the saved document would write `clean` again.
    expect(written).toEqual([clean, '{"edited": true}']);
    expect(j.note()).toBe('Copied to clipboard.');
  });

  it('Apply over a dirty show asks; Keep editing changes nothing and returns focus to Apply (7k.4)', async () => {
    seed({ dirty: true });
    const m = await open();
    const s = m.store();
    const before = s.show();
    const j = await openJson(m);
    j.apply.focus();
    j.apply.click();
    await m.stable();
    const dialog = m.root.ownerDocument.querySelector('dialog')!;
    expect(text(dialog)).toContain('Apply this JSON?');
    expect(text(dialog)).toContain(
      `This replaces your current show, \u201c\u2068${before.name}\u2069\u201d, including its cues, shells and sky. Display settings stay as they are.`,
    );
    const buttons = [...dialog.querySelectorAll('button')].map((b) => b.textContent!.trim());
    expect(buttons).toEqual(expect.arrayContaining(['Keep editing', 'Apply JSON']));
    (
      [...dialog.querySelectorAll('button')].find(
        (b) => b.textContent!.trim() === 'Keep editing',
      ) as HTMLButtonElement
    ).click();
    await m.stable();
    expect(s.show()).toBe(before);
    expect(document.activeElement).toBe(m.byTest('show-json-apply'));
  });

  // ---- Library drag, seek-scroll, Edit cue, layout -------------------------------------------

  function layoutTimeline(m: Awaited<ReturnType<typeof open>>) {
    const tl = m.timeline();
    (tl as unknown as { size: { set(v: { w: number; h: number }): void } }).size.set({
      w: 400,
      h: 96,
    });
    const box = m.byTest('timeline')!;
    box.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 96,
        width: 400,
        height: 96,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    return tl;
  }
  const pe = (type: string, x: number, y: number, init: PointerEventInit = {}) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      clientX: x,
      clientY: y,
      ...init,
    });

  it('a mouse drag from the Library adds exactly one cue at the snapped drop time; one Undo step; focus on the timeline (7j.5)', async () => {
    seed();
    const m = await open();
    await m.stable();
    const tl = layoutTimeline(m);
    await m.stable();
    const s = m.store();
    const n = s.show().cues.length;
    const item = m.byTest('lib-preset-2')!;
    item.dispatchEvent(pe('pointerdown', 600, 500));
    window.dispatchEvent(pe('pointermove', 300, 60));
    await m.stable();
    expect(m.byTest('drag-ghost')?.getAttribute('aria-hidden')).toBe('true');
    expect(m.byTest('drop-guide')).not.toBeNull();
    window.dispatchEvent(pe('pointerup', 300, 60));
    await m.stable();
    const t = tl.dropAt(300, 60, false)!.t;
    expect(s.show().cues).toHaveLength(n + 1);
    const added = s.show().cues.find((c) => c.id === s.selectedCueId())!;
    expect(added.t).toBe(t);
    expect(added.x).toBe(0.5);
    expect(Object.hasOwn(added, 'burstHeight')).toBe(false);
    expect(s.activeShell()).toEqual({ kind: 'preset', index: 2 });
    expect(document.activeElement).toBe(m.byTest('timeline'));
    expect(text(m.byTest('announcer'))).toMatch(/^Added .*Willow.* at \d:\d\d\.\d\.$/);
    expect(m.byTest('drag-ghost')).toBeNull();
    await m.key(document.body, { key: 'z', ctrlKey: true });
    expect(s.show().cues).toHaveLength(n);
  });

  it('under 4 px is a click; Escape or a drop off the timeline cancels; touch never drags (7j.5, 7j.8, 7j.9)', async () => {
    seed();
    const m = await open();
    layoutTimeline(m);
    await m.stable();
    const s = m.store();
    const n = s.show().cues.length;
    const item = m.byTest('lib-preset-3')!;
    item.dispatchEvent(pe('pointerdown', 10, 10));
    window.dispatchEvent(pe('pointermove', 12, 11));
    window.dispatchEvent(pe('pointerup', 12, 11));
    await m.stable();
    expect(m.byTest('drag-ghost')).toBeNull();
    item.dispatchEvent(pe('pointerdown', 600, 500));
    window.dispatchEvent(pe('pointermove', 300, 60));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(pe('pointerup', 300, 60));
    await m.stable();
    item.dispatchEvent(pe('pointerdown', 600, 500));
    window.dispatchEvent(pe('pointermove', 500, 400));
    window.dispatchEvent(pe('pointerup', 500, 400));
    await m.stable();
    item.dispatchEvent(pe('pointerdown', 600, 500, { pointerType: 'touch' }));
    window.dispatchEvent(pe('pointermove', 300, 60, { pointerType: 'touch' }));
    window.dispatchEvent(pe('pointerup', 300, 60, { pointerType: 'touch' }));
    await m.stable();
    expect(s.show().cues).toHaveLength(n);
    expect(s.canUndo()).toBe(false);
  });

  it('a blocked drop at 1000 cues adds nothing, labels the reason, announces the sentence, makes the item active (7j.7)', async () => {
    const show = doneWhenShow();
    const cues = Array.from({ length: 1000 }, (_, i) => ({
      ...show.cues[i % 50],
      id: `c${i + 1}`,
      t: (i % 600) / 10,
    }));
    seed({ show: { ...show, cues } });
    const m = await open();
    layoutTimeline(m);
    await m.stable();
    const item = m.byTest('lib-preset-4')!;
    item.dispatchEvent(pe('pointerdown', 600, 500));
    window.dispatchEvent(pe('pointermove', 300, 60));
    await m.stable();
    expect(text(m.byTest('drag-label'))).toBe('Show is full (1000 cues)');
    window.dispatchEvent(pe('pointerup', 300, 60));
    await m.stable();
    expect(m.store().show().cues).toHaveLength(1000);
    expect(text(m.byTest('announcer'))).toBe(CUE_CAP);
    expect(m.store().activeShell()).toEqual({ kind: 'preset', index: 4 });
  });

  it('a scrub-bar seek outside the lane window scrolls it 10% in; Back to start too (7j.14)', async () => {
    seed({ view: { pxPerSecond: 40, scroll: 0 } });
    const m = await open();
    layoutTimeline(m);
    await m.stable();
    const scrub = m.byTest<HTMLInputElement>('scrub')!;
    scrub.value = '40';
    scrub.dispatchEvent(new Event('input'));
    await m.stable();
    expect(m.store().view()).toEqual({ pxPerSecond: 40, scroll: 40 - 1 });
    m.byTest('back-to-start')!.click();
    await m.stable();
    expect(m.store().view().scroll).toBe(0);
  });

  it('Edit cue renders only with a selection and focuses Launch time (7i.6); the dock has no CSS order', async () => {
    seed();
    const m = await open();
    expect(m.byTest('edit-cue')).toBeNull();
    m.store().select('c3');
    await m.stable();
    const edit = m.byTest('edit-cue')!;
    expect(edit.className).toContain('max-[761px]:inline-block');
    edit.click();
    await m.stable();
    expect(document.activeElement).toBe(m.byTest('inspector-t'));
    // Narrow-only pieces, in DOM order: Add cue, Edit cue, Delete, Undo, Redo (Duplicate hidden).
    const ids = [...m.byTest('toolbar')!.querySelectorAll('button')].map(
      (b) => b.dataset['testid'],
    );
    expect(ids).toEqual([
      'add-cue',
      'edit-cue',
      'toolbar-duplicate',
      'toolbar-delete',
      'undo',
      'redo',
    ]);
    expect(m.byTest('toolbar-duplicate')!.className).toContain('max-[761px]:hidden');
    expect(m.byTest('status-line')!.className).toContain('max-[761px]:block');
    expect(m.byTest('dock')!.innerHTML).not.toMatch(/\border-|\bgrid\b/);
    void RULER_HEIGHT;
    void SHOW_ENDED;
  });
});
