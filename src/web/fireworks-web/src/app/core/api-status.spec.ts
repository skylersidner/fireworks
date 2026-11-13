import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiStatusService } from './api-status';

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
});
