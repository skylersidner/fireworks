import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ManualDriver,
  PreviewLoopDriver,
  RandomShowDriver,
} from '../../../../../engine/loop/drivers';
import { ApiStatusService } from '../../../../core/api-status';
import { BROWSER_STORAGE, MATCH_MEDIA, REDUCED_MOTION_QUERY } from '../../../../core/browser';
import { FakeMatchMedia } from '../../../../testing/fake-match-media';
import { FakeStageRenderers } from '../../../../testing/fake-stage-renderer';
import { MemoryStorage } from '../../../../testing/memory-storage';
import {
  FireworksStageComponent,
  STAGE_RENDERER_FACTORY,
} from '../../shared/fireworks-stage/fireworks-stage';
import { DesignerPageComponent } from './designer-page';
import { FLASH_NOTICE_KEY } from './shell-designer.store';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('DesignerPageComponent', () => {
  let fakes: FakeStageRenderers;
  let media: FakeMatchMedia;
  let storage: MemoryStorage;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakes = new FakeStageRenderers();
    media = new FakeMatchMedia();
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [DesignerPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        { provide: MATCH_MEDIA, useValue: media.fn },
        { provide: BROWSER_STORAGE, useValue: storage },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  /**
   * Mounts the page. The flashing notice pauses playback, so by default it is stored as dismissed;
   * `notice: 'shown'` clears that, and `'as-stored'` leaves storage alone (a revisit).
   */
  async function mount(
    renderer: 'webgl' | 'canvas' = 'webgl',
    notice: 'dismissed' | 'shown' | 'as-stored' = 'dismissed',
  ) {
    if (notice === 'dismissed') storage.setItem(FLASH_NOTICE_KEY, '1');
    if (notice === 'shown') storage.removeItem(FLASH_NOTICE_KEY);
    const fixture = TestBed.createComponent(DesignerPageComponent);
    await fixture.whenStable();
    const fake = fakes.starts[fakes.starts.length - 1].resolve(renderer);
    await flush();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const stage = fixture.debugElement.query(
      (d) => d.componentInstance instanceof FireworksStageComponent,
    ).componentInstance as FireworksStageComponent;
    const q = <T extends Element = HTMLElement>(sel: string) => el.querySelector<T>(sel);
    const byTest = <T extends Element = HTMLElement>(id: string) => q<T>(`[data-testid="${id}"]`);
    const stable = () => fixture.whenStable();
    return { fixture, el, stage, fake, q, byTest, stable };
  }

  const space = (target: EventTarget, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };

  describe('layout and copy', () => {
    it('renders the panel sections in order with the 2c copy, and one live stage', async () => {
      const { el } = await mount();
      expect(el.querySelector('h1')?.textContent).toBe('Fireworks Sandbox');
      expect(el.textContent).toContain('Shell designer');
      expect(
        [...el.querySelectorAll('h2.section-heading')].map(
          (h) => h.textContent?.trim().split(/\s/)[0],
        ),
      ).toEqual(['Playback', 'Presets', 'Shell', 'Breaks', 'Sky', 'Display', 'Shell']);
      expect(el.querySelectorAll('app-fireworks-stage').length).toBe(1);
      expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Fireworks sky');
    });

    it('DOM order is panel, then stage, with the notice inside main right after the stage (§7.2)', async () => {
      const { el, byTest } = await mount('webgl', 'shown');
      const row = el.querySelector('aside')!.parentElement!;
      expect([...row.children].map((c) => c.tagName)).toEqual(['ASIDE', 'MAIN']);
      expect(row.classList).not.toContain('flex-row-reverse');
      expect(row.classList).toContain('max-[761px]:flex-col-reverse');
      expect(el.querySelector('aside h1')?.textContent).toBe('Fireworks Sandbox');
      const notice = byTest('flash-notice')!;
      expect(notice.parentElement?.tagName).toBe('MAIN');
      expect(notice.previousElementSibling?.tagName).toBe('APP-FIREWORKS-STAGE');
    });

    it('HUD reads "N particles · F fps" and "seed —" before a launch, aria-hidden', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { byTest, fake, stable } = await mount();
      expect(byTest('hud')?.getAttribute('aria-hidden')).toBe('true');
      fake.frame(16, 20);
      await stable();
      expect(byTest('hud')?.textContent).toMatch(/^0 particles · \d+ fps\nseed —$/);
    });

    it('drops the keyboard reference on a coarse pointer', async () => {
      media.set('(pointer: coarse)', true);
      const { byTest } = await mount();
      expect(byTest('launch')?.textContent?.trim()).toBe('Launch');
      expect(byTest('hint')?.textContent).not.toContain('Space');
    });

    it('shows the Canvas note only when Pixi fell back to Canvas', async () => {
      const webgl = await mount('webgl');
      expect(webgl.byTest('canvas-note')).toBeNull();
      webgl.fixture.destroy();
      const canvas = await mount('canvas');
      expect(canvas.byTest('canvas-note')?.textContent).toContain('drawing without the GPU');
    });
  });

  describe('playback', () => {
    it('opens in preview loop and auto-fires; under reduced motion it opens in Manual', async () => {
      const { stage, fake } = await mount();
      expect(stage.loop.driver).toBeInstanceOf(PreviewLoopDriver);
      fake.frame(16);
      expect(stage.loop.launchCount).toBe(1);
    });

    it('reduced motion: Manual, nothing fires, Reduce flashing reaches the renderer', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { stage, fake } = await mount();
      expect(stage.loop.driver).toBeInstanceOf(ManualDriver);
      fake.frame(16, 120);
      expect(stage.loop.launchCount).toBe(0);
      expect(fake.lastReduceFlashing).toBe(true);
    });

    it('Replay is disabled until the first launch; Launch fires', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { byTest, stage, stable } = await mount();
      expect(byTest<HTMLButtonElement>('replay')!.disabled).toBe(true);
      byTest('launch')!.click();
      await stable();
      expect(stage.loop.launchCount).toBe(1);
      expect(byTest<HTMLButtonElement>('replay')!.disabled).toBe(false);
    });

    it('a preset click loads it, selects Break 1, fires it now and holds the loop', async () => {
      const { el, stage, stable, fake } = await mount();
      fake.frame(16); // the loop's first fire
      const willow = [...el.querySelectorAll<HTMLButtonElement>('app-preset-bar button')].find(
        (b) => b.textContent?.trim() === 'Willow',
      )!;
      const launch = vi.spyOn(stage.sim, 'launch');
      willow.click();
      await stable();
      expect(launch.mock.calls[0][0].name).toBe('Willow');
      expect((stage.loop.driver as PreviewLoopDriver).remaining).toBeCloseTo(
        stage.sim.shellDuration(stage.loop.shell),
        6,
      );
      expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe(
        'Break 1',
      );
    });
  });

  describe('Space to launch (§6.2)', () => {
    async function manual() {
      media.set(REDUCED_MOTION_QUERY, true);
      return mount();
    }

    it('launches from the page body and prevents scrolling', async () => {
      const { stage } = await manual();
      const event = space(document.body);
      expect(event.defaultPrevented).toBe(true);
      expect(stage.loop.launchCount).toBe(1);
    });

    it.each([
      ['a button', 'app-preset-bar button'],
      ['a range input', 'input[type="range"]'],
      ['the name input', '#shell-name'],
      ['a select', 'select'],
      ['the textarea', 'textarea'],
      ['a tab', '[role="tab"]'],
      ['the switch', '[role="switch"]'],
    ])('is ignored on %s', async (_name, selector) => {
      const { q, stage } = await manual();
      const event = space(q(selector)!);
      expect(event.defaultPrevented).toBe(false);
      expect(stage.loop.launchCount).toBe(0);
    });

    it.each([{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { repeat: true }])(
      'is ignored with %o',
      async (init) => {
        const { stage } = await manual();
        space(document.body, init);
        expect(stage.loop.launchCount).toBe(0);
      },
    );

    it('stops listening when the page is destroyed', async () => {
      const { fixture, stage } = await manual();
      fixture.destroy();
      space(document.body);
      expect(stage.loop.launchCount).toBe(0);
    });
  });

  describe('replace confirmation', () => {
    it('over unsaved edits a preset asks; Keep editing changes nothing; confirm loads and fires', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { el, byTest, q, stage, stable } = await mount();
      const name = q<HTMLInputElement>('#shell-name')!;
      name.value = 'Mine';
      name.dispatchEvent(new Event('input'));
      await stable();

      const ring = () =>
        [...el.querySelectorAll<HTMLButtonElement>('app-preset-bar button')].find(
          (b) => b.textContent?.trim() === 'Ring',
        )!;
      // A real click focuses the button; jsdom's click() doesn't, so focus it as the browser would.
      ring().focus();
      ring().click();
      await stable();
      await flush();
      expect(byTest('confirm-dialog')).not.toBeNull();
      expect(byTest('confirm-dialog')?.getAttribute('role')).toBe('alertdialog');
      expect(q('#confirm-title')?.textContent).toBe('Load Ring?');
      expect(q('#confirm-body')?.textContent).toBe(
        'This replaces your current shell, \u201cMine\u201d, and its breaks, and goes back to Break 1. Sky and display settings stay as they are.',
      );
      expect(byTest('confirm-accept')?.textContent?.trim()).toBe('Load Ring');
      expect(stage.loop.launchCount).toBe(0);
      expect(document.activeElement).toBe(byTest('confirm-cancel'));
      // Space must not launch behind the dialog.
      space(document.body);
      expect(stage.loop.launchCount).toBe(0);

      byTest('confirm-cancel')!.click();
      await stable();
      await flush();
      expect(byTest('confirm-dialog')).toBeNull();
      expect(name.value).toBe('Mine');
      expect(document.activeElement?.textContent?.trim()).toBe('Ring');

      ring().click();
      await stable();
      byTest('confirm-accept')!.click();
      await stable();
      expect(byTest('confirm-dialog')).toBeNull();
      expect(stage.loop.launchCount).toBe(1);
      expect(q<HTMLInputElement>('#shell-name')!.value).toBe('Ring');
    });

    it('Toad repro: fresh load, Continue, Mode Manual, Willow loads without asking', async () => {
      const { el, byTest, q, stage, stable } = await mount('webgl', 'shown');
      byTest('flash-continue')!.click();
      await stable();
      const select = q<HTMLSelectElement>('app-playback-controls select')!;
      select.value = 'manual';
      select.dispatchEvent(new Event('change'));
      await stable();
      const launches = stage.loop.launchCount;
      [...el.querySelectorAll<HTMLButtonElement>('app-preset-bar button')]
        .find((b) => b.textContent?.trim() === 'Willow')!
        .click();
      await stable();
      await flush();
      expect(byTest('confirm-dialog')).toBeNull();
      expect(q<HTMLInputElement>('#shell-name')!.value).toBe('Willow');
      expect(stage.loop.launchCount).toBe(launches + 1);
    });

    it.each(['cancel', 'close'])('Escape (dialog %s event) is Keep editing', async (eventName) => {
      const { el, byTest, q, stable } = await mount();
      q<HTMLInputElement>('#shell-name')!.value = 'Mine';
      q('#shell-name')!.dispatchEvent(new Event('input'));
      await stable();
      [...el.querySelectorAll<HTMLButtonElement>('app-preset-bar button')][1].click();
      await stable();
      await flush();
      // Chrome may close on Escape without firing cancel, so both events must answer.
      byTest('confirm-dialog')!.dispatchEvent(new Event(eventName, { cancelable: true }));
      await stable();
      expect(byTest('confirm-dialog')).toBeNull();
      expect(q<HTMLInputElement>('#shell-name')!.value).toBe('Mine');
    });

    it.each([
      [
        'with sky',
        '{"sky":{"gravity":90},"breaks":[{}]}',
        'This replaces your current shell, \u201cMine\u201d, including its breaks and sky, with the shell in the JSON panel. Display settings stay as they are.',
      ],
      [
        'without sky',
        '{"breaks":[{}]}',
        'This replaces your current shell, \u201cMine\u201d, and its breaks with the shell in the JSON panel. Sky and display settings stay as they are.',
      ],
    ])('Apply while dirty asks with the body for JSON %s', async (_n, json, body) => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { byTest, q, stable } = await mount();
      const name = q<HTMLInputElement>('#shell-name')!;
      name.value = 'Mine';
      name.dispatchEvent(new Event('input'));
      const text = byTest<HTMLTextAreaElement>('json-text')!;
      text.value = json;
      text.dispatchEvent(new Event('input'));
      await stable();
      byTest('json-apply')!.click();
      await stable();
      expect(q('#confirm-title')?.textContent).toBe('Apply this JSON?');
      expect(q('#confirm-body')?.textContent).toBe(body);
      byTest('confirm-cancel')!.click();
      await stable();
    });
  });

  describe('break tabs (§8.2)', () => {
    it('is a tablist with roving tabindex; arrows select; Remove moves focus to the new tab', async () => {
      const { el, q, byTest, stable } = await mount();
      [...el.querySelectorAll<HTMLButtonElement>('app-preset-bar button')][9].click(); // Triple Break
      await stable();
      const tabs = () => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
      expect(q('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('break-tab-0');

      tabs()[0].focus();
      tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await stable();
      expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(tabs()[1]);
      expect(q('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('break-tab-1');
      // Delay shows on breaks 2-4 only.
      expect(el.querySelector('app-break-fields')?.textContent).toContain('Delay');

      tabs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await stable();
      expect(tabs()[2].getAttribute('aria-selected')).toBe('true');

      byTest('remove-break')!.click();
      await stable();
      expect(tabs()).toHaveLength(2);
      expect(document.activeElement).toBe(tabs()[1]);
      expect(byTest('announcer')?.textContent).toBe('Break 3 removed.');
    });

    it('Change at is disabled with a note while Changes to is No change', async () => {
      const { el, byTest, stable } = await mount();
      [...el.querySelectorAll<HTMLButtonElement>('app-preset-bar button')][4].click(); // Ring: no color2
      await stable();
      const changeAt = [...el.querySelectorAll('app-range-row')].find((r) =>
        r.textContent?.includes('Change at'),
      )!;
      expect(changeAt.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
      expect(byTest('change-at-note')?.textContent).toBe('Pick a second color to use this.');
    });
  });

  describe('API banner (§6.3)', () => {
    it('appears when the probe fails, shows Checking… on retry, and goes on recovery', async () => {
      const { byTest, stable } = await mount();
      expect(byTest('api-banner')).toBeNull();
      TestBed.inject(ApiStatusService).check();
      http.expectOne('/health/live').flush('x', { status: 503, statusText: 'Down' });
      await stable();
      expect(byTest('api-banner')?.getAttribute('role')).toBe('status');
      expect(byTest('api-banner')?.textContent).toContain("Can't reach the server right now.");

      byTest('api-retry')!.click();
      await stable();
      expect(byTest('api-retry')?.textContent?.trim()).toBe('Checking…');
      expect(byTest<HTMLButtonElement>('api-retry')!.disabled).toBe(true);
      http.expectOne('/health/live').flush('Healthy');
      await stable();
      expect(byTest('api-banner')).toBeNull();
    });

    it('the first check, before any failure, shows no banner', async () => {
      const { byTest, stable } = await mount();
      TestBed.inject(ApiStatusService).check();
      await stable();
      expect(byTest('api-banner')).toBeNull();
      http.expectOne('/health/live').flush('Healthy');
    });
  });

  describe('flashing notice and Reduce flashing (§7)', () => {
    const noticeText = (el: HTMLElement | null) => el!.textContent!.replace(/\s+/g, ' ').trim();

    it('shows on first visit with the mode sentence; focus on body moves to its first button', async () => {
      const { byTest } = await mount('webgl', 'shown');
      expect(byTest('flash-notice')?.getAttribute('role')).toBe('region');
      expect(byTest('flash-notice')?.getAttribute('aria-label')).toBe('Flashing lights notice');
      expect(noticeText(byTest('flash-notice-text'))).toBe(
        'Flashing lights. Fireworks start when you close this notice. Bursts flash, and some effects strobe. If flashing affects you, turn on Reduce flashing first. To stop the loop later, set Mode to Manual.',
      );
      expect(byTest('flash-turn-on')?.textContent?.trim()).toBe('Turn on Reduce flashing');
      expect(byTest('flash-continue')?.textContent?.trim()).toBe('Continue');
      expect(byTest('flash-notice')!.querySelectorAll('button')).toHaveLength(2);
      expect(document.activeElement).toBe(byTest('flash-turn-on'));
    });

    it('both buttons are described by the copy paragraph, which has a unique id', async () => {
      const { byTest } = await mount('webgl', 'shown');
      const id = byTest('flash-notice-text')!.id;
      expect(id).toMatch(/^flash-notice-text-\d+$/);
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
      expect(byTest('flash-turn-on')?.getAttribute('aria-describedby')).toBe(id);
      expect(byTest('flash-continue')?.getAttribute('aria-describedby')).toBe(id);
    });

    it('with Reduce flashing on, Continue is described by the copy paragraph too', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { byTest } = await mount('webgl', 'shown');
      const id = byTest('flash-notice-text')!.id;
      expect(id).toMatch(/^flash-notice-text-\d+$/);
      expect(byTest('flash-continue')?.getAttribute('aria-describedby')).toBe(id);
    });

    it('each notice instance gets its own id', async () => {
      const first = await mount('webgl', 'shown');
      const firstId = first.byTest('flash-notice-text')!.id;
      first.fixture.destroy();
      const second = await mount('webgl', 'shown');
      expect(second.byTest('flash-notice-text')!.id).not.toBe(firstId);
    });

    it('while it shows, the playback note says how to start; after dismiss it is the click sentence', async () => {
      const { byTest, stable } = await mount('webgl', 'shown');
      expect(byTest('playback-note')?.textContent?.trim()).toBe(
        'Close the flashing notice on the stage to start.',
      );
      byTest('flash-continue')!.click();
      await stable();
      expect(byTest('playback-note')?.textContent?.trim()).toBe(
        'Click anywhere in the sky to burst the current shell at that point.',
      );
    });

    it('focus already elsewhere is left alone', async () => {
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      try {
        await mount('webgl', 'shown');
        expect(document.activeElement).toBe(outside);
      } finally {
        outside.remove();
      }
    });

    it('the mode sentence follows Mode live, and Manual drops the loop sentence', async () => {
      const { byTest, q, stable } = await mount('webgl', 'shown');
      const select = q<HTMLSelectElement>('app-playback-controls select')!;
      select.value = 'manual';
      select.dispatchEvent(new Event('change'));
      await stable();
      const text = noticeText(byTest('flash-notice-text'));
      expect(text).toContain('You can launch fireworks once you close this notice.');
      expect(text).not.toContain('To stop the loop later');
    });

    it('"Turn on" turns it on, dismisses, and moves focus to Launch', async () => {
      const { byTest, q, fake, stable } = await mount('webgl', 'shown');
      byTest('flash-turn-on')!.click();
      await stable();
      expect(byTest('flash-notice')).toBeNull();
      expect(q<HTMLInputElement>('[role="switch"]')!.checked).toBe(true);
      expect(byTest('reduce-flashing-value')?.textContent?.trim()).toBe('On');
      expect(document.activeElement).toBe(byTest('launch'));
      fake.frame(16);
      expect(fake.lastReduceFlashing).toBe(true);
    });

    it('under reduced motion it says Reduce flashing is already on, with only Continue', async () => {
      media.set(REDUCED_MOTION_QUERY, true);
      const { byTest, el } = await mount('webgl', 'shown');
      expect(noticeText(byTest('flash-notice-text'))).toBe(
        'Flashing lights. You can launch fireworks once you close this notice. Reduce flashing is on, so strobe is off and burst flashes are dimmed. You can change this under Display.',
      );
      expect(byTest('flash-turn-on')).toBeNull();
      expect(document.activeElement).toBe(byTest('flash-continue'));
      expect(el.querySelector('#reduce-flashing-note')?.textContent).toContain(
        'On because your device asks for reduced motion.',
      );
    });

    it('Escape does nothing to it', async () => {
      const { byTest, stable } = await mount('webgl', 'shown');
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await stable();
      expect(byTest('flash-notice')).not.toBeNull();
    });

    it('stays dismissed on the next visit', async () => {
      const first = await mount('webgl', 'shown');
      first.byTest('flash-continue')!.click();
      await first.stable();
      first.fixture.destroy();
      const second = await mount('webgl', 'as-stored');
      expect(second.byTest('flash-notice')).toBeNull();
    });
  });

  describe('the notice holds playback (§7.2, Skyler 2026-11-13)', () => {
    it('while it shows nothing fires: loop, Launch, Space, a sky click, a preset', async () => {
      const { el, byTest, stage, fake, stable } = await mount('webgl', 'shown');
      fake.frame(16, 600);
      const launchBtn = byTest<HTMLButtonElement>('launch')!;
      const replayBtn = byTest<HTMLButtonElement>('replay')!;
      expect([launchBtn.disabled, replayBtn.disabled]).toEqual([true, true]);
      expect(launchBtn.title).toBe('Close the flashing notice to start.');
      expect(replayBtn.title).toBe('Close the flashing notice to start.');
      launchBtn.click();
      const key = space(document.body);
      expect(key.defaultPrevented).toBe(false);
      fake.nextWorldPoint = { x: 420, y: 250 };
      el.querySelector('.stage-host')!.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true }),
      );
      [...el.querySelectorAll<HTMLButtonElement>('app-preset-bar button')][2].click(); // Willow
      await stable();
      fake.frame(16, 60);
      expect(stage.loop.launchCount).toBe(0);
      expect(stage.sim.particles.n).toBe(0);
      // The preset still loaded; it waits for the hold to end.
      expect(stage.loop.shell.name).toBe('Willow');
      expect(replayBtn.disabled).toBe(true);
    });

    it('a successful Apply loads but does not fire', async () => {
      const { byTest, stage, fake, stable } = await mount('webgl', 'shown');
      const text = byTest<HTMLTextAreaElement>('json-text')!;
      text.value = JSON.stringify({ name: 'Held', breaks: [{}] });
      text.dispatchEvent(new Event('input'));
      await stable();
      byTest('json-apply')!.click();
      await stable();
      fake.frame(16, 60);
      expect(stage.loop.shell.name).toBe('Held');
      expect(stage.loop.launchCount).toBe(0);
    });

    it('the loop and Auto show timers do not advance while held', async () => {
      const loop = await mount('webgl', 'shown');
      const loopDriver = loop.stage.loop.driver as PreviewLoopDriver;
      const loopBefore = loopDriver.remaining;
      loop.fake.frame(16, 600);
      expect(loopDriver.remaining).toBe(loopBefore);
      loop.fixture.destroy();

      const { q, stage, fake, stable } = await mount('webgl', 'shown');
      const select = q<HTMLSelectElement>('app-playback-controls select')!;
      select.value = 'show';
      select.dispatchEvent(new Event('change'));
      await stable();
      const driver = stage.loop.driver as RandomShowDriver;
      expect(driver).toBeInstanceOf(RandomShowDriver);
      const before = driver.remaining;
      fake.frame(16, 600);
      expect(driver.remaining).toBe(before);
      expect(stage.loop.launchCount).toBe(0);
    });

    it.each([
      ['Continue', 'flash-continue'],
      ['Turn on Reduce flashing', 'flash-turn-on'],
    ])('"%s" ends the hold: the loop fires its first burst on the next frame', async (_n, id) => {
      const { byTest, stage, fake, stable } = await mount('webgl', 'shown');
      fake.frame(16, 120);
      expect(stage.loop.launchCount).toBe(0);
      byTest(id)!.click();
      await stable();
      expect(byTest<HTMLButtonElement>('launch')!.disabled).toBe(false);
      expect(byTest<HTMLButtonElement>('launch')!.title).toBe('');
      fake.frame(16);
      expect(stage.loop.launchCount).toBe(1);
    });

    it('the first burst after "Turn on Reduce flashing" is already reduced', async () => {
      const { byTest, stage, fake, stable } = await mount('webgl', 'shown');
      const seen: boolean[] = [];
      const render = fake.render.bind(fake);
      fake.render = (sim, persistence, reduce = false) => {
        if (sim.particles.n > 0) seen.push(reduce);
        render(sim, persistence, reduce);
      };
      byTest('flash-turn-on')!.click();
      await stable();
      fake.frame(16, 30);
      expect(stage.loop.launchCount).toBe(1);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((r) => r)).toBe(true);
    });

    it('the Display switch is usable while held and does not end the hold', async () => {
      const { byTest, q, stage, fake, stable } = await mount('webgl', 'shown');
      q<HTMLInputElement>('[role="switch"]')!.click();
      await stable();
      expect(byTest('flash-notice')).not.toBeNull();
      expect(byTest('flash-notice-text')?.textContent).toContain('Reduce flashing is on');
      fake.frame(16, 60);
      expect(stage.loop.launchCount).toBe(0);
    });

    it('storage that throws: shown and held on every load', async () => {
      storage.failReads = true;
      storage.failWrites = true;
      const first = await mount('webgl', 'as-stored');
      first.byTest('flash-continue')!.click();
      await first.stable();
      first.fixture.destroy();
      const { byTest, stage, fake } = await mount('webgl', 'as-stored');
      expect(byTest('flash-notice')).not.toBeNull();
      fake.frame(16, 120);
      expect(stage.loop.launchCount).toBe(0);
    });
  });

  describe('name field (2c.5)', () => {
    it('clearing and retyping is never rewritten; the counter appears at 70', async () => {
      const { q, byTest, stable } = await mount();
      const name = q<HTMLInputElement>('#shell-name')!;
      expect(name.maxLength).toBe(80);
      name.focus();
      name.value = '';
      name.dispatchEvent(new Event('input'));
      await stable();
      expect(name.value).toBe('');
      name.value = 'a'.repeat(72);
      name.dispatchEvent(new Event('input'));
      await stable();
      expect(byTest('name-counter')?.textContent).toBe('72/80');
    });
  });
});
