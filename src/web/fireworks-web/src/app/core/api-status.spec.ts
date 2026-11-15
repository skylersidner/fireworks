import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiStatusService } from './api-status';
import { SessionService } from './session';

describe('ApiStatusService', () => {
  let service: ApiStatusService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiStatusService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts checking, and reports available when the probe succeeds', () => {
    expect(service.status()).toBe('checking');
    service.check();
    http.expectOne('/health/live').flush('Healthy');
    expect(service.status()).toBe('available');
  });

  it('reports unavailable on failure, and a retry recovers', () => {
    service.check();
    http.expectOne('/health/live').flush('x', { status: 502, statusText: 'Bad Gateway' });
    expect(service.status()).toBe('unavailable');

    service.check();
    expect(service.status()).toBe('checking');
    http.expectOne('/health/live').flush('Healthy');
    expect(service.status()).toBe('available');
  });

  it('ignores a second check while one is in flight (one probe, not two)', () => {
    service.check();
    service.check();
    const pending = http.match('/health/live');
    expect(pending.length).toBe(1);
    pending[0].flush('Healthy');
  });

  describe('bannerStatus (probe and api/me; Skyler, 2026-11-14)', () => {
    const me = { userId: 'u', displayName: null, isAuthenticated: false, canWrite: true };

    it('is checking while api/me is in flight, unavailable when it fails, available when both pass', () => {
      service.check();
      http.expectOne('/health/live').flush('Healthy');
      TestBed.inject(SessionService).load().subscribe();
      expect([service.status(), service.bannerStatus()]).toEqual(['available', 'checking']);
      http.expectOne('/api/me').flush('x', { status: 500, statusText: 'Boom' });
      expect([service.status(), service.bannerStatus()]).toEqual(['available', 'unavailable']);

      service.retry();
      expect(service.bannerStatus()).toBe('checking');
      http.expectOne('/health/live').flush('Healthy');
      expect(service.bannerStatus()).toBe('checking');
      http.expectOne('/api/me').flush(me);
      expect(service.bannerStatus()).toBe('available');
      expect(TestBed.inject(SessionService).canWrite()).toBe(true);
    });

    it('a failed probe is unavailable even while api/me is still loading', () => {
      TestBed.inject(SessionService).load().subscribe();
      service.check();
      http.expectOne('/health/live').flush('x', { status: 503, statusText: 'Down' });
      expect(service.bannerStatus()).toBe('unavailable');
      http.expectOne('/api/me').flush(me);
      expect(service.bannerStatus()).toBe('unavailable');
    });
  });
});
