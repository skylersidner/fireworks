import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { App } from './app';
import { appConfig } from './app.config';
import { MeResponse } from './core/models';
import { SessionService } from './core/session';
import { CANARY_SCENE_FACTORY } from './pages/home/pixi-canary/pixi-canary';
import { FakeCanaryScene } from './testing/fake-canary-scene';

/**
 * Cold start through the REAL appConfig (its initializer, router and interceptor chain), the root
 * App and the home route: the requests the app issues before anyone touches it.
 *
 * Exact call ledger (standing decision, testing §2): `/health/live` is reached by two code paths
 * (App's availability probe and the home page's status line) and `api/me` by the session
 * initializer. The test compares the complete sorted multiset, so a dropped initializer, a second
 * `session.load()` from a page, or a third health probe all fail here, while the per-component
 * specs (each built without appConfig) cannot see them.
 */
describe('App cold start (real appConfig)', () => {
  const me: MeResponse = {
    userId: '00000000-0000-0000-0000-000000000001',
    displayName: 'Default user',
    isAuthenticated: false,
    canWrite: true,
  };

  it('issues exactly GET /api/me once and GET /health/live twice, then reports canWrite', async () => {
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: CANARY_SCENE_FACTORY, useValue: new FakeCanaryScene().factory },
      ],
    });
    const http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();

    const pending = http.match(() => true);
    const ledger = pending.map((r) => `${r.request.method} ${r.request.urlWithParams}`).sort();
    expect(ledger).toEqual(['GET /api/me', 'GET /health/live', 'GET /health/live']);

    for (const req of pending) {
      req.flush(req.request.url === '/api/me' ? me : 'Healthy');
    }
    await fixture.whenStable();

    expect(TestBed.inject(SessionService).canWrite()).toBe(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="health-status"]')?.textContent?.trim()).toBe('Healthy');
    expect(el.querySelector('[data-testid="write-status"]')?.textContent?.trim()).toBe('Enabled');
    http.verify();
  });
});
