import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { BROWSER_STORAGE, MATCH_MEDIA, REDUCED_MOTION_QUERY } from './core/browser';
import { STAGE_RENDERER_FACTORY } from './shared/fireworks-stage/fireworks-stage';
import { ME_TEST_WINDOW, settleSession } from './testing/creation-fixtures';
import { FakeMatchMedia } from './testing/fake-match-media';
import { FakeStageRenderers } from './testing/fake-stage-renderer';
import { MemoryStorage } from './testing/memory-storage';
import { provideStepClock } from './testing/stage-clock';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const SWITCH = 'input[role="switch"]';

interface Sight {
  readonly id: string | null;
  readonly checked: boolean;
}

/**
 * Under reduce with empty storage, the Reduce flashing switch on `/` and `/show` reads checked
 * from the moment it exists (Toad's end-review verification: on a loaded machine the designer's
 * switch first read unchecked, then flipped; the gate's 7h.1 first sight).
 *
 * `RouterOutlet.activateWith` emits `activate` right after `createComponent`, before any change
 * detection: the page's creation-mode DOM is in the document and its bindings are not. A switch
 * created in creation mode is unchecked at that moment, and stays so until the next zoneless tick,
 * a macrotask later. The hook below reads the DOM at exactly that point.
 */
@Component({
  imports: [RouterOutlet],
  template: `<router-outlet (activate)="onActivate()" />`,
})
class RootComponent {
  readonly sights: Sight[] = [];
  activations = 0;
  onActivate(): void {
    this.activations++;
    for (const el of document.querySelectorAll<HTMLInputElement>(SWITCH)) {
      this.sights.push({ id: el.id || el.dataset['testid'] || null, checked: el.checked });
    }
  }
}

describe('Reduce flashing switch, first render under reduce', () => {
  let http: HttpTestingController;
  let fakes: FakeStageRenderers;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fakes = new FakeStageRenderers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        { provide: STAGE_RENDERER_FACTORY, useValue: fakes.factory },
        provideStepClock(),
        {
          provide: MATCH_MEDIA,
          useValue: new FakeMatchMedia({ [REDUCED_MOTION_QUERY]: true }).fn,
        },
        { provide: BROWSER_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  async function visit(url: string) {
    settleSession(http, ME_TEST_WINDOW);
    const fixture = TestBed.createComponent(RootComponent);
    fixture.autoDetectChanges();
    await TestBed.inject(Router).navigateByUrl(url);
    expect(fixture.componentInstance.activations).toBe(1);
    const at = [...fixture.componentInstance.sights];
    for (let i = 0; i < 3; i++) {
      await tick();
      await fixture.whenStable();
      http
        .match(() => true)
        .forEach((r) => r.flush({ items: [], page: 1, pageSize: 24, totalCount: 0 }));
    }
    const settled = [...document.querySelectorAll<HTMLInputElement>(SWITCH)].map((el) => ({
      id: el.id || el.dataset['testid'] || null,
      checked: el.checked,
    }));
    fixture.destroy();
    return { at, settled };
  }

  for (const [url, id] of [
    ['/', 'reduce-flashing'],
    ['/show', 'reduce-flashing'],
  ] as const) {
    it(`${url}: no switch exists unchecked at activation, and the settled switch is checked`, async () => {
      const { at, settled } = await visit(url);
      expect(at.filter((s) => !s.checked)).toEqual([]);
      expect(settled.find((s) => s.id === id)?.checked).toBe(true);
    });
  }
});
