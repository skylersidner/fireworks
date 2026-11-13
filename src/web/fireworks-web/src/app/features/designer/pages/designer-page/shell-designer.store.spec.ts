import { Injector, createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PRESETS } from '../../../../../engine/model/presets';
import { BROWSER_STORAGE, MATCH_MEDIA, REDUCED_MOTION_QUERY } from '../../../../core/browser';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { JSON_NOTE_APPLIED, JSON_NOTE_DEFAULT, JSON_NOTE_EDITED } from '../../shared/designer-copy';
import { DRAFT_KEY, editableFrom, serializeDraft } from '../../shared/designer-draft';
import { DRAFT_DEBOUNCE_MS, FLASH_NOTICE_KEY, ShellDesignerStore } from './shell-designer.store';

describe('ShellDesignerStore', () => {
  let storage: MemoryStorage;
  let media: FakeMatchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new MemoryStorage();
    media = new FakeMatchMedia();
    TestBed.configureTestingModule({
      providers: [
        { provide: BROWSER_STORAGE, useValue: storage },
        { provide: MATCH_MEDIA, useValue: media.fn },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  /** A store in its own injector, the way a page instance gets one (destroy = leave the page). */
  function create() {
    const injector = createEnvironmentInjector(
      [ShellDesignerStore],
      TestBed.inject(EnvironmentInjector),
    );
    const store = injector.get(ShellDesignerStore);
    TestBed.tick();
    return { store, destroy: () => injector.destroy(), injector: injector as Injector };
  }

  function settle() {
    TestBed.tick();
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
  }

  const savedDraft = () => JSON.parse(storage.getItem(DRAFT_KEY) ?? 'null');

  describe('first visit', () => {
    it('opens on Peony in preview loop, tab 1, display defaults, not dirty', () => {
      const { store } = create();
      expect(store.shell().name).toBe('Peony');
      expect(store.shell().breaks[0]).toMatchObject({
        color1: 'red',
        color2: 'gold',
        changeAt: 0.65,
      });
      expect(store.sky()).toEqual({ gravity: 160, wind: 0 });
      expect(store.mode()).toBe('loop');
      expect(store.activeBreak()).toBe(0);
      expect(store.quality()).toEqual({ persistence: 0.78, starBudget: 1, reduceFlashing: false });
      expect(store.dirty()).toBe(false);
      expect(store.flashNoticeVisible()).toBe(true);
      expect(store.playbackPaused()).toBe(true);
    });

    it('under OS reduced motion: Manual, and Reduce flashing on (from the device)', () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { store } = create();
      expect(store.mode()).toBe('manual');
      expect(store.reduceFlashing()).toBe(true);
      expect(store.reduceFlashingFromDevice()).toBe(true);
      expect(store.quality().reduceFlashing).toBe(true);
    });

    it('an OS change mid-session moves the default only while the visitor has not chosen', () => {
      const { store } = create();
      media.set(REDUCED_MOTION_QUERY, true);
      expect(store.reduceFlashing()).toBe(true);
      store.setReduceFlashing(false);
      media.set(REDUCED_MOTION_QUERY, false);
      media.set(REDUCED_MOTION_QUERY, true);
      expect(store.reduceFlashing()).toBe(false);
      expect(store.mode()).toBe('loop');
    });

    it('an OS reduced-motion change never sets dirty (an app-made change)', () => {
      const { store } = create();
      media.set(REDUCED_MOTION_QUERY, true);
      expect(store.reduceFlashing()).toBe(true);
      media.set(REDUCED_MOTION_QUERY, false);
      settle();
      expect(store.dirty()).toBe(false);
      expect(store.loadPreset(2).status).toBe('loaded');
    });
  });

  describe('normalize between the form and the shell (2c.4, 2c.5)', () => {
    it('an out-of-range form value reaches store.shell clamped; the model keeps what was typed', () => {
      const { store } = create();
      store.form.breaks[0].stars().value.set(9999);
      expect(store.shell().breaks[0].stars).toBe(400);
      expect(store.model().breaks[0].stars).toBe(9999);
    });

    it('clearing the name never rewrites the field; only the shell gets the fallback', () => {
      const { store } = create();
      store.form.name().value.set('');
      expect(store.form.name().value()).toBe('');
      expect(store.shell().name).toBe('Custom');
      store.form.name().value.set('M');
      expect(store.form.name().value()).toBe('M');
    });

    it('Change at is disabled exactly while Changes to is No change (D6)', () => {
      const { store } = create();
      expect(store.form.breaks[0].changeAt().disabled()).toBe(false);
      store.form.breaks[0].color2().value.set('none');
      expect(store.form.breaks[0].changeAt().disabled()).toBe(true);
    });

    it('the JSON always carries sky, and gravity edits show in it (P21, F6)', () => {
      const { store } = create();
      store.form.sky.gravity().value.set(300);
      expect(JSON.parse(store.shellJson()).sky).toEqual({ gravity: 300, wind: 0 });
    });
  });

  describe('breaks', () => {
    it('add copies the LAST break with delay 0.6 and selects it; disabled at 4', () => {
      const { store } = create();
      store.loadPreset(9);
      store.selectBreak(0);
      store.addBreak();
      expect(store.shell().breaks).toHaveLength(4);
      expect(store.shell().breaks[3]).toEqual({ ...store.shell().breaks[2], delay: 0.6 });
      expect(store.activeBreak()).toBe(3);
      expect(store.announcement()).toBe('Break 4 added.');
      store.addBreak();
      expect(store.shell().breaks).toHaveLength(4);
    });

    it('remove drops the ACTIVE break and selects the one before; never below 1', () => {
      const { store } = create();
      store.loadPreset(9);
      store.selectBreak(1);
      store.removeBreak();
      expect(store.shell().breaks.map((b) => b.pattern)).toEqual(['peony', 'peony']);
      expect(store.shell().breaks[1].effect).toBe('crackle');
      expect(store.activeBreak()).toBe(0);
      expect(store.announcement()).toBe('Break 2 removed.');
      store.removeBreak();
      store.removeBreak();
      expect(store.shell().breaks).toHaveLength(1);
    });
  });

  describe('presets and Apply while dirty (Skyler 2026-11-13)', () => {
    it('a preset keeps sky and display, selects tab 1, and clears shellDirty', () => {
      const { store } = create();
      store.form.sky.wind().value.set(30);
      store.displayForm.mode().value.set('manual');
      store.form.name().value.set('Mine');
      expect(store.loadPreset(2).status).toBe('needs-confirm');
      const outcome = store.confirmReplace();
      expect(outcome.status).toBe('loaded');
      expect(store.shell().name).toBe('Willow');
      expect(store.sky()).toEqual({ gravity: 160, wind: 30 });
      expect(store.mode()).toBe('manual');
      expect(store.activeBreak()).toBe(0);
      expect(store.shellDirty()).toBe(false);
      // The kept sky is still the visitor's sky.
      expect(store.skyDirty()).toBe(true);
      expect(store.loadPreset(3).status).toBe('loaded');
    });

    it.each([
      ['a shell field', (s: ShellDesignerStore) => s.form.breaks[0].color1().value.set('blue')],
      ['the name', (s: ShellDesignerStore) => s.form.name().value.set('Mine')],
      ['adding a break', (s: ShellDesignerStore) => s.addBreak()],
    ])('a shell change sets shellDirty only, and a preset asks first: %s', (_name, change) => {
      const { store } = create();
      expect(store.dirty()).toBe(false);
      change(store);
      expect(store.shellDirty()).toBe(true);
      expect(store.skyDirty()).toBe(false);
      const before = store.shellJson();
      expect(store.loadPreset(4)).toEqual({ status: 'needs-confirm' });
      expect(store.pendingReplace()).toEqual({ kind: 'preset', index: 4, name: 'Ring' });
      expect(store.shellJson()).toBe(before);
    });

    it.each([
      ['the mode', (s: ShellDesignerStore) => s.displayForm.mode().value.set('manual')],
      ['motion blur', (s: ShellDesignerStore) => s.displayForm.persistence().value.set(0.1)],
      ['the star budget', (s: ShellDesignerStore) => s.displayForm.starBudget().value.set(0.4)],
      ['Reduce flashing', (s: ShellDesignerStore) => s.setReduceFlashing(true)],
      [
        'the active tab',
        (s: ShellDesignerStore) => (s.loadPreset(9), s.selectBreak(2), s.selectBreak(1)),
      ],
    ])('a display or tab change never sets a flag, and nothing asks: %s', (_name, change) => {
      const { store } = create();
      change(store);
      settle();
      expect(store.shellDirty()).toBe(false);
      expect(store.skyDirty()).toBe(false);
      expect(savedDraft()).toMatchObject({ shellDirty: false, skyDirty: false });
      expect(store.loadPreset(2).status).toBe('loaded');
      store.editJson('{"sky":{"gravity":250},"breaks":[{}]}');
      expect(store.applyJson().status).toBe('loaded');
    });

    it('Toad repro: Continue, Mode Manual, then Willow loads without asking', () => {
      const { store } = create();
      store.dismissFlashNotice(false);
      store.displayForm.mode().value.set('manual');
      expect(store.loadPreset(2).status).toBe('loaded');
      expect(store.shell().name).toBe('Willow');
    });

    it('a sky change sets skyDirty only: a preset and sky-less JSON load, JSON with sky asks', () => {
      const { store } = create();
      store.form.sky.gravity().value.set(200);
      expect(store.skyDirty()).toBe(true);
      expect(store.shellDirty()).toBe(false);
      expect(store.loadPreset(4).status).toBe('loaded');
      expect(store.sky()).toEqual({ gravity: 200, wind: 0 });
      store.editJson('{"name":"NoSky","breaks":[{}]}');
      expect(store.applyJson().status).toBe('loaded');
      expect(store.sky()).toEqual({ gravity: 200, wind: 0 });
      expect(store.skyDirty()).toBe(true);
      store.editJson('{"name":"Sky","sky":{"gravity":250},"breaks":[{}]}');
      expect(store.applyJson().status).toBe('needs-confirm');
      expect(store.pendingReplace()).toMatchObject({ kind: 'json', hasSky: true });
      store.confirmReplace();
      expect(store.sky()).toEqual({ gravity: 250, wind: 0 });
      expect(store.skyDirty()).toBe(false);
      expect(store.shellDirty()).toBe(false);
    });

    it('a clean Apply with sky clears skyDirty; a shell edit then asks even for sky-less JSON', () => {
      const { store } = create();
      store.editJson('{"sky":{"wind":5},"breaks":[{}]}');
      expect(store.applyJson().status).toBe('loaded');
      expect(store.dirty()).toBe(false);
      store.form.angleJitter().value.set(9);
      store.editJson('{"breaks":[{}]}');
      expect(store.applyJson().status).toBe('needs-confirm');
    });

    it('dirty is a flag: setting a field back keeps it dirty', () => {
      const { store } = create();
      store.form.breaks[0].color1().value.set('blue');
      store.form.breaks[0].color1().value.set('red');
      expect(store.dirty()).toBe(true);
      expect(store.loadPreset(1).status).toBe('needs-confirm');
    });

    it('a load clears dirty even when nothing read dirty in between', () => {
      const { store } = create();
      store.form.name().value.set('Mine');
      store.editJson(JSON.stringify(PRESETS[3]));
      // Dirty, so confirm; the load's own writes must not leave it dirty.
      expect(store.applyJson().status).toBe('needs-confirm');
      store.confirmReplace();
      expect(store.dirty()).toBe(false);
      expect(store.loadPreset(1).status).toBe('loaded');
      expect(store.dirty()).toBe(false);
    });

    it('selecting the tab already active, editing JSON text, or a failed Apply is not a change', () => {
      const { store } = create();
      store.selectBreak(0);
      store.editJson('{ nope');
      expect(store.applyJson().status).toBe('rejected');
      expect(store.dirty()).toBe(false);
    });

    it('a failed Apply keeps dirty', () => {
      const { store } = create();
      store.form.name().value.set('Mine');
      store.editJson('{ nope');
      store.applyJson();
      expect(store.dirty()).toBe(true);
    });

    it('cancel keeps everything', () => {
      const { store } = create();
      store.form.name().value.set('Mine');
      store.loadPreset(1);
      store.cancelReplace();
      expect(store.pendingReplace()).toBeNull();
      expect(store.shell().name).toBe('Mine');
    });

    it('Apply over edits validates first: invalid JSON never asks, it just explains', () => {
      const { store } = create();
      store.form.name().value.set('Mine');
      store.editJson('{ nope');
      expect(store.applyJson().status).toBe('rejected');
      expect(store.pendingReplace()).toBeNull();
      expect(store.jsonNote()).toMatch(
        /^Couldn't apply: this isn't valid JSON \(.+\)\. Nothing changed\.$/,
      );
      store.editJson('{"breaks":[{"pattern":"willow"}]}');
      store.applyJson();
      expect(store.jsonNote()).toBe(
        'Couldn\'t apply: Pattern (Break 1) "willow" isn\'t one of Peony, Ring, Palm, Heart. Nothing changed.',
      );
      expect(store.shell().name).toBe('Mine');
    });

    it('a pending Apply records whether the JSON has sky (picks the §6.4 body)', () => {
      const { store } = create();
      store.form.name().value.set('Mine');
      store.editJson('{"breaks":[{}]}');
      store.applyJson();
      expect(store.pendingReplace()).toMatchObject({ kind: 'json', hasSky: false });
      store.cancelReplace();
      store.editJson('{"sky":{},"breaks":[{}]}');
      store.applyJson();
      expect(store.pendingReplace()).toMatchObject({ kind: 'json', hasSky: true });
    });

    it('a valid Apply over edits waits, and the confirm loads with the adjusted note', () => {
      const { store } = create();
      store.form.name().value.set('Mine');
      store.editJson('{"name":"J","breaks":[{"stars":9999}]}');
      expect(store.applyJson().status).toBe('needs-confirm');
      expect(store.jsonNote()).toBe(JSON_NOTE_EDITED);
      const outcome = store.confirmReplace();
      expect(outcome.status === 'loaded' && outcome.shell.breaks[0].stars).toBe(400);
      expect(store.jsonEdits()).toBeNull();
      expect(store.jsonNote()).toBe('Applied, with 1 value adjusted: Stars (Break 1).');
      expect(store.dirty()).toBe(false);
    });
  });

  describe('JSON panel state (D8)', () => {
    it('keeps unapplied text across field edits; revert restores the shell', () => {
      const { store } = create();
      expect(store.jsonNote()).toBe(JSON_NOTE_DEFAULT);
      store.editJson('{"breaks":[{}]} ');
      store.form.angleJitter().value.set(9);
      expect(store.jsonText()).toBe('{"breaks":[{}]} ');
      expect(store.jsonNote()).toBe(JSON_NOTE_EDITED);
      expect(store.hasJsonEdits()).toBe(true);
      store.revertJson();
      expect(store.jsonText()).toBe(store.shellJson());
      expect(store.jsonNote()).toBe(JSON_NOTE_DEFAULT);
    });

    it('a clean Apply says "Applied." until the next edit', () => {
      const { store } = create();
      store.editJson(JSON.stringify(PRESETS[3]));
      expect(store.applyJson().status).toBe('loaded');
      expect(store.shell().name).toBe('Palm');
      expect(store.jsonNote()).toBe(JSON_NOTE_APPLIED);
      store.form.burstHeight().value.set(0.5);
      expect(store.jsonNote()).toBe(JSON_NOTE_DEFAULT);
    });

    it('Apply without sky keeps the current sky; with sky it takes it', () => {
      const { store } = create();
      store.form.sky.wind().value.set(-12);
      expect(store.loadPreset(0).status).toBe('loaded');
      store.editJson('{"breaks":[{}]}');
      expect(store.applyJson().status).toBe('loaded');
      expect(store.sky()).toEqual({ gravity: 160, wind: -12 });
      store.editJson('{"sky":{"gravity":90},"breaks":[{}]}');
      expect(store.applyJson().status).toBe('needs-confirm');
      store.confirmReplace();
      expect(store.sky()).toEqual({ gravity: 90, wind: 0 });
    });
  });

  describe('autosave (2c.9–2c.12)', () => {
    it('writes within the debounce after a change, and only then', () => {
      const { store } = create();
      expect(storage.writes).toEqual([]);
      store.form.name().value.set('Saved one');
      TestBed.tick();
      vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1);
      expect(storage.writes).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(storage.writes).toHaveLength(1);
      expect(savedDraft().shell.name).toBe('Saved one');
      expect(savedDraft().shell).toEqual(JSON.parse(store.shellJson()));
    });

    it('idle time writes nothing', () => {
      create();
      for (let k = 0; k < 40; k++) settle();
      vi.advanceTimersByTime(10_000);
      expect(storage.writes).toEqual([]);
    });

    it('a burst of edits is one write', () => {
      const { store } = create();
      for (let v = 10; v < 60; v++) {
        store.form.breaks[0].stars().value.set(v);
        TestBed.tick();
        vi.advanceTimersByTime(10);
      }
      settle();
      expect(storage.writes).toHaveLength(1);
    });

    it('leaving the page flushes a pending write', () => {
      const { store, destroy } = create();
      store.form.name().value.set('Quick');
      TestBed.tick();
      destroy();
      expect(savedDraft().shell.name).toBe('Quick');
    });

    it('pagehide flushes a pending write', () => {
      const { store } = create();
      store.form.name().value.set('Hidden');
      TestBed.tick();
      window.dispatchEvent(new Event('pagehide'));
      expect(savedDraft().shell.name).toBe('Hidden');
    });

    it('restores shell, sky, tab, display, choice and dirty (2c.10 as ruled)', () => {
      const first = create();
      first.store.loadPreset(9);
      first.store.form.name().value.set('Kept');
      first.store.addBreak();
      first.store.form.breaks[1].color1().value.set('purple');
      first.store.form.sky.gravity().value.set(300);
      first.store.displayForm.mode().value.set('show');
      first.store.displayForm.starBudget().value.set(0.5);
      first.store.setReduceFlashing(true);
      first.store.selectBreak(1);
      settle();
      first.destroy();

      const { store } = create();
      expect(store.shell().name).toBe('Kept');
      expect(store.shell().breaks).toHaveLength(4);
      expect(store.shell().breaks[1].color1).toBe('purple');
      expect(store.sky().gravity).toBe(300);
      expect(store.activeBreak()).toBe(1);
      expect(store.mode()).toBe('show');
      expect(store.quality()).toEqual({ persistence: 0.78, starBudget: 0.5, reduceFlashing: true });
      expect(store.shellDirty()).toBe(true);
      expect(store.skyDirty()).toBe(true);
      expect(savedDraft()).toMatchObject({ shellDirty: true, skyDirty: true });
      expect(store.loadPreset(0).status).toBe('needs-confirm');
    });

    it('a sky-only change survives a reload as skyDirty only', () => {
      const first = create();
      first.store.form.sky.wind().value.set(-20);
      settle();
      first.destroy();

      const { store } = create();
      expect(store.shellDirty()).toBe(false);
      expect(store.skyDirty()).toBe(true);
      expect(store.loadPreset(3).status).toBe('loaded');
      store.editJson('{"sky":{},"breaks":[{}]}');
      expect(store.applyJson().status).toBe('needs-confirm');
    });

    it('a pre-split draft with dirty true restores shell- and sky-dirty', () => {
      const {
        shellDirty: _a,
        skyDirty: _b,
        ...rest
      } = JSON.parse(
        serializeDraft({
          shell: editableFrom(PRESETS[0]),
          activeBreak: 0,
          display: { mode: 'loop', persistence: 0.78, starBudget: 1, reduceFlashing: null },
          shellDirty: false,
          skyDirty: false,
        }),
      );
      storage.setItem(DRAFT_KEY, JSON.stringify({ ...rest, dirty: true }));
      const { store } = create();
      expect(store.shellDirty()).toBe(true);
      expect(store.skyDirty()).toBe(true);
      expect(store.loadPreset(3).status).toBe('needs-confirm');
    });

    it('a clean state restores clean: a preset loads without asking after reload', () => {
      const first = create();
      first.store.form.name().value.set('Edited');
      first.store.loadPreset(9);
      first.store.confirmReplace();
      settle();
      expect(savedDraft()).toMatchObject({
        shellDirty: false,
        skyDirty: false,
        shell: { name: 'Triple Break' },
      });
      first.destroy();

      const { store } = create();
      expect(store.shell().name).toBe('Triple Break');
      expect(store.dirty()).toBe(false);
      expect(store.loadPreset(0).status).toBe('loaded');
    });

    it('under reduced motion it opens in Manual every load, and never writes that Manual back', () => {
      const first = create();
      first.store.displayForm.mode().value.set('show');
      settle();
      first.destroy();

      media.set(REDUCED_MOTION_QUERY, true);
      const second = create();
      expect(second.store.mode()).toBe('manual');
      second.store.form.name().value.set('edit');
      settle();
      expect(savedDraft().display.mode).toBe('show');
      second.destroy();

      media.set(REDUCED_MOTION_QUERY, false);
      expect(create().store.mode()).toBe('show');
    });

    it('the forced Manual never sets dirty', () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { store } = create();
      expect(store.mode()).toBe('manual');
      settle();
      expect(store.dirty()).toBe(false);
      expect(storage.writes).toEqual([]);
      expect(store.loadPreset(2).status).toBe('loaded');
    });

    it('Reduce flashing is stored only once chosen', () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { store } = create();
      store.form.name().value.set('x');
      settle();
      expect(savedDraft().display.reduceFlashing).toBeNull();
      store.setReduceFlashing(true);
      settle();
      expect(savedDraft().display.reduceFlashing).toBe(true);
    });

    it.each([
      'not json',
      'null',
      '[]',
      '{}',
      JSON.stringify({ shell: { ...PRESETS[0], version: 2 } }),
      JSON.stringify({ shell: { ...PRESETS[0], breaks: [{ pattern: 'willow' }] } }),
    ])('a corrupt draft opens on Peony and the next edit overwrites it: %s', (text) => {
      storage.setItem(DRAFT_KEY, text);
      storage.writes.length = 0;
      const { store } = create();
      expect(store.shell().name).toBe('Peony');
      // Dropped whole, dirty flag included (2c.11): a preset loads without asking.
      expect(store.dirty()).toBe(false);
      store.form.angleJitter().value.set(7);
      settle();
      expect(savedDraft().shell.angleJitter).toBe(7);
    });

    it('a draft with stars 9999 restores clamped to 400', () => {
      const shell = editableFrom(PRESETS[0]);
      (shell.breaks[0] as { stars: number }).stars = 9999;
      storage.setItem(
        DRAFT_KEY,
        serializeDraft({
          shell,
          activeBreak: 0,
          display: { mode: 'loop', persistence: 0.78, starBudget: 1, reduceFlashing: null },
          shellDirty: false,
          skyDirty: false,
        }),
      );
      expect(create().store.shell().breaks[0].stars).toBe(400);
    });

    it('storage that throws on read and write: the designer still edits', () => {
      storage.failReads = true;
      storage.failWrites = true;
      const { store, destroy } = create();
      expect(store.shell().name).toBe('Peony');
      expect(store.flashNoticeVisible()).toBe(true);
      store.form.name().value.set('works');
      settle();
      store.dismissFlashNotice(false);
      expect(store.shell().name).toBe('works');
      expect(() => destroy()).not.toThrow();
    });
  });

  describe('flashing notice (§7.2)', () => {
    it('dismissal is remembered; "Turn on" also turns Reduce flashing on', () => {
      const first = create();
      first.store.dismissFlashNotice(true);
      expect(first.store.flashNoticeVisible()).toBe(false);
      expect(first.store.reduceFlashing()).toBe(true);
      expect(storage.getItem(FLASH_NOTICE_KEY)).toBe('1');
      first.destroy();
      expect(create().store.flashNoticeVisible()).toBe(false);
    });

    it('pauses playback until dismissed, by either button', () => {
      for (const turnOn of [false, true]) {
        storage.removeItem(FLASH_NOTICE_KEY);
        const { store, destroy } = create();
        expect(store.playbackPaused()).toBe(true);
        store.dismissFlashNotice(turnOn);
        expect(store.playbackPaused()).toBe(false);
        destroy();
      }
    });

    it('the Display switch does not end the hold (the panel stays usable, §7.2)', () => {
      const { store } = create();
      store.setReduceFlashing(true);
      expect(store.flashNoticeVisible()).toBe(true);
      expect(store.playbackPaused()).toBe(true);
      expect(storage.getItem(FLASH_NOTICE_KEY)).toBeNull();
    });

    it('"Turn on Reduce flashing" records the choice but never sets dirty (§6.4)', () => {
      const { store } = create();
      store.dismissFlashNotice(true);
      expect(store.reduceFlashingChoice()).toBe(true);
      expect(store.dirty()).toBe(false);
      expect(store.loadPreset(2).status).toBe('loaded');
      settle();
      expect(savedDraft()).toMatchObject({
        shellDirty: false,
        skyDirty: false,
        display: { reduceFlashing: true },
      });
    });

    it('"Turn on Reduce flashing" keeps an existing dirty flag', () => {
      const { store } = create();
      store.form.name().value.set('Mine');
      store.dismissFlashNotice(true);
      expect(store.dirty()).toBe(true);
    });

    it('when storage throws it shows, and pauses, on every load', () => {
      storage.failReads = true;
      storage.failWrites = true;
      const first = create();
      first.store.dismissFlashNotice(false);
      expect(first.store.playbackPaused()).toBe(false);
      first.destroy();
      expect(create().store.playbackPaused()).toBe(true);
    });
  });
});
