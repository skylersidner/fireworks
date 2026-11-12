import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HealthService } from './health';

describe('HealthService', () => {
  let service: HealthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HealthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('targets the same-origin liveness endpoint', () => {
    expect(service.endpoint).toBe('/health/live');
  });

  it('GETs /health/live as text and returns the body', () => {
    let body: string | undefined;
    service.getLiveness().subscribe((response) => (body = response));

    const req = http.expectOne('/health/live');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('text');
    req.flush('Healthy');

    expect(body).toBe('Healthy');
  });
});
