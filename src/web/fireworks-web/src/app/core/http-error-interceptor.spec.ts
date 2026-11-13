import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SUPPRESS_ERROR_TOAST } from './http-context-tokens';
import { GENERIC_ERROR_MESSAGE, httpErrorInterceptor } from './http-error-interceptor';
import { NotificationService } from './notifications';

describe('httpErrorInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  let notifications: NotificationService;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([httpErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    notifications = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('toasts the generic message (no method, URL or status), logs the detail, and rethrows', () => {
    let errored = false;
    client.post('/api/creations?x=1', {}).subscribe({ error: () => (errored = true) });
    http.expectOne('/api/creations?x=1').flush('x', { status: 503, statusText: 'Unavailable' });

    expect(errored).toBe(true);
    expect(notifications.notifications().map((n) => n.message)).toEqual([GENERIC_ERROR_MESSAGE]);
    expect(GENERIC_ERROR_MESSAGE).toBe(
      'Something went wrong talking to the server. Try again in a moment.',
    );
    expect(console.error).toHaveBeenCalledWith('HTTP 503 POST /api/creations?x=1');
  });

  it('toasts a network failure with the same generic message', () => {
    client.get('/api/creations').subscribe({ error: () => undefined });
    http.expectOne('/api/creations').error(new ProgressEvent('error'));

    expect(notifications.notifications().map((n) => n.message)).toEqual([GENERIC_ERROR_MESSAGE]);
  });

  it('does not toast the self-handled session load (api/me)', () => {
    client.get('/api/me').subscribe({ error: () => undefined });
    http.expectOne('/api/me').flush('x', { status: 503, statusText: 'Unavailable' });

    expect(notifications.notifications()).toEqual([]);
  });

  it('does not toast the self-handled liveness probe', () => {
    client.get('/health/live', { responseType: 'text' }).subscribe({ error: () => undefined });
    http.expectOne('/health/live').flush('x', { status: 503, statusText: 'Unavailable' });

    expect(notifications.notifications()).toEqual([]);
  });

  it('does not toast when SUPPRESS_ERROR_TOAST is set', () => {
    const context = new HttpContext().set(SUPPRESS_ERROR_TOAST, true);
    client.get('/api/x', { context }).subscribe({ error: () => undefined });
    http.expectOne('/api/x').flush('x', { status: 400, statusText: 'Bad Request' });

    expect(notifications.notifications()).toEqual([]);
  });
});
