import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../../app.routes';
import { TimelineDriver } from '../../../../../engine/loop/timeline-driver';
import { BROWSER_STORAGE, MATCH_MEDIA } from '../../../../core/browser';
import { FLASH_NOTICE_KEY } from '../../../../core/device-preferences';
import {
  FireworksStageComponent,
  STAGE_RENDERER_FACTORY,
} from '../../../../shared/fireworks-stage/fireworks-stage';
import {
  CODE_A,
  CODE_B,
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
import { PRESETS } from '../../../../../engine/model/presets';
import { DRAFT_KEY, editableFrom, serializeDraft } from '../../../designer/shared/designer-draft';
import { EMPTY_SAVE_NOTE, NOTICE_HOLDS_PLAY } from '../../shared/show-copy';
import { SHOW_DRAFT_KEY, readShowDraft, serializeShowDraft } from '../../shared/show-draft';
import { ShowBuilderStore } from './show-builder.store';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const LIST = '/api/me/creations?page=1&pageSize=24&kind=shell';

/** The Show Builder at `/show` and `/c/` for shows (phase-6.md; acceptance 6c, 6f.2, 6g). */
describe('Show Builder /show', () => {
  let storage: MemoryStorage;
  let http: HttpTestingController;
  let ledger: string[];
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage = new MemoryStorage();
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
      vi.restoreAllMocks();
      TestBed.resetTestingModule();
    }
  });

  async function open(url = '/show', opts: { flush?: () => void } = {}) {
    settleSession(http, ME_TEST_WINDOW);
    ledger.length = 0;
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(url);
    const stable = async () => {
      await tick();
      await harness.fixture.whenStable();
      await tick();
      await harness.fixture.whenStable();
    };
    await stable();
    opts.flush?.();
    await stable();
    http.match(LIST).forEach((r) => r.flush({ items: [], page: 1, pageSize: 24, totalCount: 0 }));
    await stable();
    const root = harness.fixture.nativeElement as HTMLElement;
    const byTest = <T extends HTMLElement = HTMLElement>(id: string) =>
      root.querySelector<T>(`[data-testid="${id}"]`);
    const fake = fakes.starts.length ? fakes.starts[0].resolve('webgl') : null;
    await stable();
    const stageDebug = harness.fixture.debugElement.query(
      (d) => d.componentInstance instanceof FireworksStageComponent,
    );
    const stage = stageDebug?.componentInstance as FireworksStageComponent | undefined;
    const store = () =>
      harness.fixture.debugElement
        .query((d) => d.providerTokens.includes(ShowBuilderStore))
        ?.injector.get(ShowBuilderStore);
    const key = async (target: Element, init: KeyboardEventInit) => {
      const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      await stable();
      return e;
    };
    return { harness, root, byTest, stable, fake, stage, store, key };
  }

  it('is a lazy route with one live stage, opens paused at 0:00 and never auto-plays (§14.1)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    storage.setItem(
      SHOW_DRAFT_KEY,
      serializeShowDraft({ ...readShowDraftSeed(), show: doneWhenShow() }),
    );
    const { root, fake, stage, byTest } = await open();
    expect(root.querySelectorAll('app-fireworks-stage')).toHaveLength(1);
    expect(stage!.loop.driver).toBeInstanceOf(TimelineDriver);
    fake!.frame(16, 120);
    expect((stage!.loop.driver as TimelineDriver).step).toBe(0);
    expect(stage!.sim.particles.n).toBe(0);
    expect(byTest('play')!.textContent!.trim()).toBe('Play');
    expect(byTest('time')!.textContent).toMatch(/^0:00\.0 \/ about \d:\d\d$/);
    // The first test pays the lazy route. Warm-up no longer spends real clock here: the step
    // clock (`provideStepClock`) charges 6 ms per shadow step, so each of the 120 frames runs 2.
    // Timed out at 5 s under the full suite's load before that (Toad, Phase 7 C3); load-only.
  }, 20_000);

  it('the notice holds Play and sky clicks; Continue moves focus to Play (§14.1)', async () => {
    const { byTest, stage, store, stable } = await open();
    expect(byTest<HTMLButtonElement>('play')!.disabled).toBe(true);
    expect(byTest('play')!.getAttribute('title')).toBe('Close the flashing notice to play.');
    expect(byTest('toolbar-status')!.textContent!.trim()).toBe(NOTICE_HOLDS_PLAY);
    stage!['onPointerDown'](new PointerEvent('pointerdown'));
    await stable();
    expect(store()!.show().cues).toHaveLength(0);
    byTest('flash-continue')!.click();
    await stable();
    expect(document.activeElement).toBe(byTest('play'));
    stage!['onPointerDown'](new PointerEvent('pointerdown'));
    await stable();
    expect(store()!.show().cues).toHaveLength(1);
  });

  it('an empty show: Save is visible but disabled, with the note, and sends nothing (6f.2)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const { byTest, stable } = await open();
    ledger.length = 0;
    const save = byTest<HTMLButtonElement>('save-save')!;
    expect(save.disabled).toBe(true);
    expect(byTest('save-note')!.textContent!.trim()).toBe(EMPTY_SAVE_NOTE);
    save.click();
    await stable();
    expect(ledger).toEqual([]);
    expect(byTest('empty-lane')!.textContent!.trim()).toBe(
      'No cues yet. Pick a shell in the Library, then press Add cue or click the sky.',
    );
  });

  it('Add cue, keys on the timeline, Undo; selection and zoom never dirty (§4.4)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const { byTest, store, key, stable } = await open();
    byTest('lib-preset-2')!.click();
    await stable();
    expect(store()!.dirty()).toBe(false);
    byTest('add-cue')!.click();
    await stable();
    const s = store()!;
    expect(s.show().cues).toEqual([
      { id: 'c1', t: 0, shell: 's1', x: 0.5, seed: expect.any(Number) },
    ]);
    expect(s.show().shells['s1'].name).toBe('Willow');
    expect(byTest('announcer')!.textContent!.trim()).toBe('Added \u2068Willow\u2069 at 0:00.0.');
    expect(byTest<HTMLButtonElement>('save-save')!.disabled).toBe(false);
    const timeline = byTest('timeline')!;
    await key(timeline, { key: 'Escape' });
    expect(s.selectedCueId()).toBeNull();
    await key(timeline, { key: 'Home' });
    expect(s.selectedCueId()).toBe('c1');
    await key(timeline, { key: '.' });
    expect(s.show().cues[0].t).toBeCloseTo(0.1, 9);
    await key(timeline, { key: 'd' });
    expect(s.show().cues.map((c) => c.id)).toEqual(['c1', 'c2']);
    await key(timeline, { key: 'Delete' });
    expect(s.show().cues.map((c) => c.id)).toEqual(['c1']);
    await key(timeline, { key: 'a' });
    expect(s.show().cues.map((c) => c.id)).toEqual(['c1', 'c3']);
    // ⌘/Ctrl+Z on the page undoes; inside a text field it's the field's own undo (Peach N6).
    const name = byTest<HTMLInputElement>('show-name')!;
    const inField = await key(name, { key: 'z', metaKey: true });
    expect(inField.defaultPrevented).toBe(false);
    expect(s.show().cues).toHaveLength(2);
    const onPage = await key(document.body, { key: 'z', ctrlKey: true });
    expect(onPage.defaultPrevented).toBe(true);
    expect(s.show().cues.map((c) => c.id)).toEqual(['c1']);
    await key(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(s.show().cues.map((c) => c.id)).toEqual(['c1', 'c3']);
    // ⌘Z (macOS) undoes on the page too, and ⌘⇧Z redoes (Toad, Phase 6 review).
    const meta = await key(document.body, { key: 'z', metaKey: true });
    expect(meta.defaultPrevented).toBe(true);
    expect(s.show().cues.map((c) => c.id)).toEqual(['c1']);
    await key(document.body, { key: 'z', metaKey: true, shiftKey: true });
    expect(s.show().cues.map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  // Toad, Phase 6 review-fix (Peach N6; p6-spec §18 Q1): both modifiers, Undo and Redo, in the text
  // field and in the number fields, pressed from the focused field itself.
  it('⌘/Ctrl+Z and Shift+⌘/Ctrl+Z inside Name, Duration or Launch time never touch the show (N6)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const { byTest, store, key, stable } = await open();
    byTest('lib-preset-2')!.click();
    await stable();
    byTest('add-cue')!.click();
    await stable();
    byTest('add-cue')!.click();
    await stable();
    const s = store()!;
    s.undo();
    await stable();
    // One step to undo (the first add) and one to redo (the second add).
    expect([s.show().cues.map((c) => c.id), s.canUndo(), s.canRedo()]).toEqual([
      ['c1'],
      true,
      true,
    ]);
    s.select('c1');
    await stable();
    const shown = s.show();
    for (const id of ['show-name', 'show-duration', 'inspector-t']) {
      const field = byTest<HTMLInputElement>(id)!;
      expect(field).not.toBeNull();
      field.focus();
      expect(document.activeElement).toBe(field);
      for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
        for (const shiftKey of [false, true]) {
          const e = await key(field, { key: shiftKey ? 'Z' : 'z', shiftKey, ...mod });
          expect([id, mod, shiftKey, e.defaultPrevented]).toEqual([id, mod, shiftKey, false]);
          expect(s.show()).toBe(shown);
        }
      }
    }
    // Negative control: the same keys from the page do reach the show.
    await key(document.body, { key: 'z', ctrlKey: true });
    expect(s.show().cues).toEqual([]);
  });

  // Skyler, 2026-11-14 (Phase 6 gate; p6-spec §18 Q1): N6 covers every native form control the
  // builder uses, not only text fields. Focus on a select, range or checkbox keeps ⌘/Ctrl+Z.
  it('⌘/Ctrl+Z and Shift+⌘/Ctrl+Z on a select, range or checkbox never touch the show (N6)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const { root, byTest, store, key, stable } = await open();
    byTest('lib-preset-2')!.click();
    await stable();
    byTest('add-cue')!.click();
    await stable();
    byTest('add-cue')!.click();
    await stable();
    const s = store()!;
    s.undo();
    await stable();
    expect([s.show().cues.map((c) => c.id), s.canUndo(), s.canRedo()]).toEqual([
      ['c1'],
      true,
      true,
    ]);
    s.select('c1');
    await stable();
    const shown = s.show();
    const controls: [string, HTMLElement | null][] = [
      ['select', byTest('inspector-shell')],
      ['range (inspector)', root.querySelector('[data-testid="inspector-x"] input[type="range"]')],
      ['range (scrub)', byTest('scrub')],
      ['checkbox', byTest('inspector-own-height')],
      ['switch', byTest('reduce-flashing')],
    ];
    for (const [label, control] of controls) {
      expect([label, control !== null]).toEqual([label, true]);
      control!.focus();
      expect([label, document.activeElement === control]).toEqual([label, true]);
      for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
        for (const shiftKey of [false, true]) {
          const e = await key(control!, { key: shiftKey ? 'Z' : 'z', shiftKey, ...mod });
          expect([label, mod, shiftKey, e.defaultPrevented]).toEqual([label, mod, shiftKey, false]);
          expect(s.show()).toBe(shown);
        }
      }
    }
    // Negative control: the same key from a button (not a form control) undoes the show.
    const button = byTest('add-cue')!;
    button.focus();
    const e = await key(button, { key: 'z', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(s.show().cues).toEqual([]);
  });

  it('a show link loads a dirty working copy into the builder; the designer draft is untouched (6g.1)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    storage.setItem(DRAFT_KEY, '{"designer":"keep"}');
    const doc = doneWhenShow();
    const { store, harness, stable } = await open(`/c/${CODE_A}`, {
      flush: () =>
        http
          .expectOne(`/api/creations/${CODE_A}`)
          .flush(creationResponse({ kind: 'show', document: doc, name: doc.name })),
    });
    expect(TestBed.inject(Router).url).toBe('/show');
    const s = store()!;
    expect(s.show().cues).toEqual(doc.cues);
    expect(s.show().sky).toEqual(doc.sky);
    expect([s.dirty(), s.saved(), s.source()?.shareCode, s.source()?.kind]).toEqual([
      true,
      false,
      CODE_A,
      'show',
    ]);
    await tick(600);
    await stable();
    expect(storage.getItem(DRAFT_KEY)).toBe('{"designer":"keep"}');
    expect(readShowDraft(storage)?.source?.shareCode).toBe(CODE_A);
    void harness;
  });

  // Toad, Phase 6 review: 6g.3's other half. Only the builder's dirty flag counts for a show link.
  it('a show link over a dirty designer and a clean builder loads at once; the designer draft is byte-identical (6g.3)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    const designer = serializeDraft({
      shell: editableFrom(PRESETS[9]),
      activeBreak: 1,
      display: { mode: 'show' as const, persistence: 0.5, starBudget: 1, reduceFlashing: false },
      shellDirty: true,
      skyDirty: true,
      saved: false,
      source: null,
    });
    storage.setItem(DRAFT_KEY, designer);
    storage.setItem(SHOW_DRAFT_KEY, serializeShowDraft({ ...readShowDraftSeed(), dirty: false }));
    const doc = doneWhenShow();
    doc.name = 'Linked show';
    const { root, store, stable } = await open(`/c/${CODE_B}`, {
      flush: () =>
        http
          .expectOne(`/api/creations/${CODE_B}`)
          .flush(
            creationResponse({ kind: 'show', shareCode: CODE_B, document: doc, name: doc.name }),
          ),
    });
    expect(root.ownerDocument.querySelector('dialog[open]')).toBeNull();
    expect(store()!.pending()).toBeNull();
    expect(store()!.show().name).toBe('Linked show');
    expect(store()!.source()?.shareCode).toBe(CODE_B);
    await tick(600);
    await stable();
    expect(storage.getItem(DRAFT_KEY)).toBe(designer);
    expect(TestBed.inject(Router).url).toBe('/show');
  });

  it('over a dirty builder a show link asks; Keep editing leaves the builder draft byte-identical (6g.3)', async () => {
    storage.setItem(FLASH_NOTICE_KEY, '1');
    storage.setItem(SHOW_DRAFT_KEY, serializeShowDraft({ ...readShowDraftSeed(), dirty: true }));
    const before = storage.getItem(SHOW_DRAFT_KEY);
    const { root, stable } = await open(`/c/${CODE_B}`, {
      flush: () =>
        http
          .expectOne(`/api/creations/${CODE_B}`)
          .flush(creationResponse({ kind: 'show', shareCode: CODE_B, document: doneWhenShow() })),
    });
    const dialog = root.ownerDocument.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Open \u201c\u2068Done-when 60s\u2069\u201d?');
    const keep = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent!.trim() === 'Keep editing',
    )!;
    keep.click();
    await stable();
    await tick(600);
    expect(storage.getItem(SHOW_DRAFT_KEY)).toBe(before);
    expect(TestBed.inject(Router).url).toBe('/show');
  });
});

function readShowDraftSeed() {
  return {
    show: doneWhenShow(),
    nextCueId: 51,
    selectedCueId: null,
    activeShell: { kind: 'preset' as const, index: 0 },
    view: { pxPerSecond: null, scroll: 0 },
    dirty: false,
    saved: false,
    source: null,
  };
}
