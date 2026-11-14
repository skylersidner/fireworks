import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { App } from './app';
import { appConfig } from './app.config';
import { BROWSER_STORAGE } from './core/browser';
import { MeResponse } from './core/models';
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
 * ApiStatusService (started by App, read by the designer banner and `/status`), and `api/me`
 * comes only from the session initializer. The designer adds nothing (acceptance 2c.8). The test
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
    '%s issues exactly GET /api/me once and GET /health/live once',
    async (url) => {
      const { http, fixture } = await coldStart(url);

      const pending = http.match(() => true);
      const ledger = pending.map((r) => `${r.request.method} ${r.request.urlWithParams}`).sort();
      expect(ledger).toEqual(['GET /api/me', 'GET /health/live']);

      for (const req of pending) {
        req.flush(req.request.url === '/api/me' ? me : 'Healthy');
      }
      await fixture.whenStable();
      expect(TestBed.inject(SessionService).canWrite()).toBe(true);
      http.verify();
    },
  );

  it('/status shows the probe and the session it was given', async () => {
    const { http, fixture } = await coldStart('/status');
    for (const req of http.match(() => true)) {
      req.flush(req.request.url === '/api/me' ? me : 'Healthy');
    }
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
    vi.restoreAllMocks();
  });
});
