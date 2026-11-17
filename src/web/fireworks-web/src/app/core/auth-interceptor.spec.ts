import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { authInterceptor } from './auth-interceptor';
import { httpErrorInterceptor } from './http-error-interceptor';
import { NotificationService } from './notifications';
import { SessionService } from './session';

/** phase-8-auth.md §6.1: a 401 reloads the session once, swallows the generic toast, never retries (A41). */
describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let ledger: string[];

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ledger = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withInterceptors([
            httpErrorInterceptor,
            authInterceptor,
            (req, next) => {
              ledger.push(`${req.method} ${req.url}`);
              return next(req);
            },
          ]),
        ),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('a 401 from an /api call: one api/me reload, no retry, no generic toast', () => {
    const session = TestBed.inject(SessionService);
    session.load().subscribe();
    http
      .expectOne('/api/me')
      .flush({ userId: 'u', displayName: 'A', isAuthenticated: true, canWrite: true });
    ledger.length = 0;
    let failed = 0;
    client.put('/api/creations/Ab3dEf7h', {}).subscribe({ error: () => failed++ });
    http.expectOne('/api/creations/Ab3dEf7h').flush(null, { status: 401, statusText: 'x' });
    http
      .expectOne('/api/me')
      .flush({ userId: null, displayName: null, isAuthenticated: false, canWrite: false });
    expect(ledger).toEqual(['PUT /api/creations/Ab3dEf7h', 'GET /api/me']);
    expect(failed).toBe(1);
    expect(session.canWrite()).toBe(false);
    expect(TestBed.inject(NotificationService).notifications()).toEqual([]);
  });

  it('a reload already in flight is not doubled', () => {
    TestBed.inject(SessionService).load().subscribe();
    client.get('/api/me/creations').subscribe({ error: () => undefined });
    http.expectOne('/api/me/creations').flush(null, { status: 401, statusText: 'x' });
    expect(http.match('/api/me')).toHaveLength(1);
  });

  it('a 401 from api/me itself, or a non-/api 401, does not reload; other statuses do not either', () => {
    client.get('/api/me').subscribe({ error: () => undefined });
    http.expectOne('/api/me').flush(null, { status: 401, statusText: 'x' });
    client.get('/health/live').subscribe({ error: () => undefined });
    http.expectOne('/health/live').flush(null, { status: 401, statusText: 'x' });
    client.get('/api/creations/Ab3dEf7h').subscribe({ error: () => undefined });
    http.expectOne('/api/creations/Ab3dEf7h').flush(null, { status: 403, statusText: 'x' });
    expect(ledger).toEqual(['GET /api/me', 'GET /health/live', 'GET /api/creations/Ab3dEf7h']);
    // Only the 403 toasts: api/me and /health/live are self-handled.
    expect(TestBed.inject(NotificationService).notifications().length).toBe(1);
  });
});
