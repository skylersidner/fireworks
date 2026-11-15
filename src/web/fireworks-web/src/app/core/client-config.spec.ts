import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ClientConfigStore,
  DEFAULT_PLAYBACK,
  PLAYBACK_LIMITS,
  checkpointOptions,
  clampPlayback,
} from './client-config';
import { ClientConfigLoader } from './client-config-loader';
import { SUPPRESS_ERROR_TOAST } from './http-context-tokens';
import { httpErrorInterceptor } from './http-error-interceptor';
import type { ClientConfigResponse } from './models';
import { NotificationService } from './notifications';

const SERVED: ClientConfigResponse = {
  playback: {
    seekBudgetMs: 12,
    catchingUpDelayMs: 0,
    checkpointIntervalSeconds: 5,
    checkpointMemoryMiB: 16,
  },
};

describe('client config (playback knobs from appsettings)', () => {
  it('defaults equal the server appsettings: 25 ms, 300 ms, 10 s, 64 MiB', () => {
    expect(DEFAULT_PLAYBACK).toEqual({
      seekBudgetMs: 25,
      catchingUpDelayMs: 300,
      checkpointIntervalSeconds: 10,
      checkpointMemoryMiB: 64,
    });
    // The driver's own defaults are what the default config implies.
    expect(checkpointOptions(DEFAULT_PLAYBACK)).toEqual({
      checkpointSteps: 1200,
      checkpointBytes: 64 * 1024 * 1024,
    });
  });

  it('clamps out-of-range numbers to the contract ranges, low and high', () => {
    expect(
      clampPlayback({
        seekBudgetMs: 1,
        catchingUpDelayMs: -5,
        checkpointIntervalSeconds: 0,
        checkpointMemoryMiB: 2,
      }),
    ).toEqual({
      seekBudgetMs: 4,
      catchingUpDelayMs: 0,
      checkpointIntervalSeconds: 1,
      checkpointMemoryMiB: 8,
    });
    expect(
      clampPlayback({
        seekBudgetMs: 101,
        catchingUpDelayMs: 9999,
        checkpointIntervalSeconds: 61,
        checkpointMemoryMiB: 4096,
      }),
    ).toEqual({
      seekBudgetMs: 100,
      catchingUpDelayMs: 5000,
      checkpointIntervalSeconds: 60,
      checkpointMemoryMiB: 512,
    });
    expect(PLAYBACK_LIMITS.seekBudgetMs).toEqual({ min: 4, max: 100, fallback: 25 });
    // In range passes through untouched, edges included.
    expect(clampPlayback({ ...SERVED.playback, seekBudgetMs: 4 }).seekBudgetMs).toBe(4);
    expect(clampPlayback(SERVED.playback)).toEqual(SERVED.playback);
  });

  it('non-numeric values (strings, null, NaN, Infinity, missing) fall back to the default', () => {
    expect(
      clampPlayback({
        seekBudgetMs: '50',
        catchingUpDelayMs: null,
        checkpointIntervalSeconds: Number.NaN,
        checkpointMemoryMiB: Number.POSITIVE_INFINITY,
      }),
    ).toEqual(DEFAULT_PLAYBACK);
    expect(clampPlayback({ seekBudgetMs: 30 })).toEqual({ ...DEFAULT_PLAYBACK, seekBudgetMs: 30 });
    for (const bad of [undefined, null, 42, 'x', []]) {
      expect(clampPlayback(bad), String(bad)).toEqual(DEFAULT_PLAYBACK);
    }
  });

  describe('ClientConfigLoader (through the real error interceptor)', () => {
    let http: HttpTestingController;
    let store: ClientConfigStore;
    let loader: ClientConfigLoader;
    let notifications: NotificationService;

    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([httpErrorInterceptor])),
          provideHttpClientTesting(),
        ],
      });
      http = TestBed.inject(HttpTestingController);
      store = TestBed.inject(ClientConfigStore);
      loader = TestBed.inject(ClientConfigLoader);
      notifications = TestBed.inject(NotificationService);
    });
    afterEach(() => {
      http.verify();
      vi.restoreAllMocks();
    });

    function load(): { completed: () => boolean; errored: () => boolean } {
      let completed = false;
      let errored = false;
      loader
        .load()
        .subscribe({ complete: () => (completed = true), error: () => (errored = true) });
      return { completed: () => completed, errored: () => errored };
    }

    it('success: GET api/client-config, the served values land in the store', () => {
      expect(store.playback()).toEqual(DEFAULT_PLAYBACK);
      const run = load();
      const req = http.expectOne('/api/client-config');
      expect(req.request.method).toBe('GET');
      expect(req.request.context.get(SUPPRESS_ERROR_TOAST)).toBe(true);
      req.flush(SERVED);
      expect([run.completed(), run.errored()]).toEqual([true, false]);
      expect(store.playback()).toEqual(SERVED.playback);
    });

    it.each([
      [
        'a 500',
        (r: ReturnType<HttpTestingController['expectOne']>) =>
          r.flush('x', { status: 500, statusText: 'Error' }),
      ],
      [
        'a 404',
        (r: ReturnType<HttpTestingController['expectOne']>) =>
          r.flush('x', { status: 404, statusText: 'Not Found' }),
      ],
      [
        'a network error',
        (r: ReturnType<HttpTestingController['expectOne']>) => r.error(new ProgressEvent('error')),
      ],
    ])('failure (%s): defaults, completes without error, no toast', (_label, fail) => {
      const run = load();
      fail(http.expectOne('/api/client-config'));
      expect([run.completed(), run.errored()]).toEqual([true, false]);
      expect(store.playback()).toEqual(DEFAULT_PLAYBACK);
      expect(notifications.notifications()).toEqual([]);
    });

    it('a served value out of range is clamped; a non-numeric one takes the default', () => {
      load();
      http.expectOne('/api/client-config').flush({
        playback: { seekBudgetMs: 0.5, catchingUpDelayMs: '1', checkpointIntervalSeconds: 600 },
      });
      expect(store.playback()).toEqual({
        seekBudgetMs: 4,
        catchingUpDelayMs: 300,
        checkpointIntervalSeconds: 60,
        checkpointMemoryMiB: 64,
      });
    });

    it('a body with no playback object (or none at all) keeps the defaults', () => {
      store.setPlayback(SERVED.playback);
      load();
      http.expectOne('/api/client-config').flush({});
      expect(store.playback()).toEqual(DEFAULT_PLAYBACK);
      load();
      http.expectOne('/api/client-config').flush(null);
      expect(store.playback()).toEqual(DEFAULT_PLAYBACK);
    });
  });
});
