import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { App } from './app';
import { appConfig } from './app.config';
import { BROWSER_STORAGE } from './core/browser';
import { ClientConfigStore, DEFAULT_PLAYBACK } from './core/client-config';
import { ClientConfigResponse, MeResponse } from './core/models';
import { NotificationService } from './core/notifications';
import { SessionService } from './core/session';
import { STAGE_RENDERER_FACTORY } from './shared/fireworks-stage/fireworks-stage';
import { FakeStageRenderers } from './testing/fake-stage-renderer';
import { MemoryStorage } from './testing/memory-storage';

/**
 * Cold start through the REAL appConfig (its initializer, router and interceptor chain) and the
 * root App: the requests the app issues before anyone touches it.
 *
 * Exact call ledger (standing decision, testing §2). Since 2c the only `/health/live` caller is
 * ApiStatusService (started by App, read by the designer banner and `/status`), `api/me`
 * comes only from the session initializer, and `api/client-config` only from ClientConfigLoader's
 * initializer (Phase 6 follow-up). The designer adds nothing (acceptance 2c.8). The test
 * compares the complete sorted multiset per route, so a page that probes again, a designer that
 * loads the session, or a dropped initializer all fail here.
 */
describe('App cold start (real appConfig)', () => {
  const me: MeResponse = {
    userId: '00000000-0000-0000-0000-000000000001',
    displayName: 'Default user',
    isAuthenticated: false,
    canWrite: true,
  };
  const served: ClientConfigResponse = {
    playback: {
      seekBudgetMs: 40,
      catchingUpDelayMs: 500,
      checkpointIntervalSeconds: 20,
      checkpointMemoryMiB: 128,
    },
  };
  const answer = (url: string) =>
    url === '/api/me' ? me : url === '/api/client-config' ? served : 'Healthy';

  async function coldStart(url: string) {
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: STAGE_RENDERER_FACTORY, useValue: new FakeStageRenderers().factory },
        { provide: BROWSER_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl(url);
    await fixture.whenStable();
    return { http, fixture };
  }

  it.each(['/', '/status'])(
    '%s issues exactly GET /api/me, GET /api/client-config and GET /health/live once each',
    async (url) => {
      const { http, fixture } = await coldStart(url);

      const pending = http.match(() => true);
      const ledger = pending.map((r) => `${r.request.method} ${r.request.urlWithParams}`).sort();
      expect(ledger).toEqual(['GET /api/client-config', 'GET /api/me', 'GET /health/live']);
      // Rendered while all three are pending: the config does not block the first render.
      expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).not.toBeNull();
      // And no initializer is holding bootstrap open on a pending request (Toad): an initializer
      // that returns its Observable keeps ApplicationInitStatus.done false until it settles.
      expect(TestBed.inject(ApplicationInitStatus).done).toBe(true);
      expect(TestBed.inject(ClientConfigStore).playback()).toEqual(DEFAULT_PLAYBACK);

      for (const req of pending) req.flush(answer(req.request.url));
      await fixture.whenStable();
      expect(TestBed.inject(SessionService).canWrite()).toBe(true);
      expect(TestBed.inject(ClientConfigStore).playback()).toEqual(served.playback);
      http.verify();
    },
  );

  it('/status shows the probe and the session it was given', async () => {
    const { http, fixture } = await coldStart('/status');
    for (const req of http.match(() => true)) req.flush(answer(req.request.url));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="health-status"]')?.textContent?.trim()).toBe('Healthy');
    expect(el.querySelector('[data-testid="write-status"]')?.textContent?.trim()).toBe('Enabled');
  });

  it('with the API down, / shows one banner and no toast, modal or URL (designer-2c.md §6.3)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { http, fixture } = await coldStart('/');
    for (const req of http.match(() => true)) {
      req.flush('down', { status: 503, statusText: 'Unavailable' });
    }
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid="api-banner"]').length).toBe(1);
    expect(el.querySelector('[role="dialog"], [aria-modal="true"]')).toBeNull();
    expect(TestBed.inject(NotificationService).notifications()).toEqual([]);
    expect(el.textContent).not.toMatch(/\/api\/|\/health/);
    // The config request failed too: defaults, silently (no toast, above; no banner of its own).
    expect(TestBed.inject(ClientConfigStore).playback()).toEqual(DEFAULT_PLAYBACK);
    vi.restoreAllMocks();
  });
});
