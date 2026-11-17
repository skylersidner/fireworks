import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MeResponse } from './models';
import { SessionService } from './session';

describe('SessionService', () => {
  let service: SessionService;
  let http: HttpTestingController;

  const me = (canWrite: boolean): MeResponse => ({
    userId: '00000000-0000-0000-0000-000000000001',
    displayName: 'Default user',
    isAuthenticated: false,
    canWrite,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SessionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts loading, with no user and canWrite false', () => {
    expect(service.status()).toBe('loading');
    expect(service.currentUser()).toBeNull();
    expect(service.canWrite()).toBe(false);
  });

  it('sets canWrite true when api/me reports canWrite: true', () => {
    let completed = false;
    service.load().subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/api/me');
    expect(req.request.method).toBe('GET');
    req.flush(me(true));

    expect(completed).toBe(true);
    expect(service.status()).toBe('ready');
    expect(service.currentUser()).toEqual(me(true));
    expect(service.canWrite()).toBe(true);
  });

  it('sets canWrite false when api/me reports canWrite: false', () => {
    service.load().subscribe();
    http.expectOne('/api/me').flush(me(false));

    expect(service.status()).toBe('ready');
    expect(service.currentUser()?.userId).toBe(me(false).userId);
    expect(service.canWrite()).toBe(false);
  });

  it('treats a missing canWrite as false, never truthy-by-accident', () => {
    service.load().subscribe();
    http.expectOne('/api/me').flush({ userId: null, displayName: null, isAuthenticated: false });

    expect(service.canWrite()).toBe(false);
  });

  it('on failure: completes without erroring, user null, canWrite false', () => {
    let errored = false;
    let completed = false;
    service.load().subscribe({ error: () => (errored = true), complete: () => (completed = true) });

    http.expectOne('/api/me').flush('boom', { status: 500, statusText: 'Server Error' });

    expect(errored).toBe(false);
    expect(completed).toBe(true);
    expect(service.status()).toBe('unavailable');
    expect(service.currentUser()).toBeNull();
    expect(service.canWrite()).toBe(false);
  });

  it('drops a previously granted canWrite when a reload fails', () => {
    service.load().subscribe();
    http.expectOne('/api/me').flush(me(true));
    expect(service.canWrite()).toBe(true);

    service.load().subscribe();
    http.expectOne('/api/me').error(new ProgressEvent('error'));
    expect(service.canWrite()).toBe(false);
  });

  describe('Phase 8 (phase-8-auth.md §6.1)', () => {
    const ada: MeResponse = {
      userId: 'u1',
      displayName: '  Ada Lovelace ',
      isAuthenticated: true,
      canWrite: true,
      signedInWith: 'google',
    };

    it('isAuthenticated, displayName (trimmed), signedInWith; absent signedInWith reads null', () => {
      service.load().subscribe();
      http.expectOne('/api/me').flush(ada);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.displayName()).toBe('Ada Lovelace');
      expect(service.signedInWith()).toBe('google');
      service.load().subscribe();
      http.expectOne('/api/me').flush({ ...me(false), signedInWith: undefined });
      expect(service.isAuthenticated()).toBe(false);
      expect(service.displayName()).toBe('');
      expect(service.signedInWith()).toBeNull();
    });

    it('settled() emits once the first load settles, either way, and replays to late subscribers', () => {
      let early = 0;
      service.settled().subscribe(() => early++);
      service.load().subscribe();
      expect(early).toBe(0);
      http.expectOne('/api/me').error(new ProgressEvent('error'));
      expect(early).toBe(1);
      let late = 0;
      let completed = false;
      service.settled().subscribe({ next: () => late++, complete: () => (completed = true) });
      expect([late, completed]).toEqual([1, true]);
    });

    it('signOut: POST api/auth/logout, then one api/me; emits true; the generic toast is suppressed', () => {
      service.load().subscribe();
      http.expectOne('/api/me').flush(ada);
      const out: boolean[] = [];
      service.signOut().subscribe((ok) => out.push(ok));
      const logout = http.expectOne('/api/auth/logout');
      expect(logout.request.method).toBe('POST');
      logout.flush(null, { status: 204, statusText: 'No Content' });
      expect(out).toEqual([]);
      http.expectOne('/api/me').flush(me(false));
      expect(out).toEqual([true]);
      expect(service.isAuthenticated()).toBe(false);
    });

    it('signOut failing: false, no api/me, the session unchanged', () => {
      service.load().subscribe();
      http.expectOne('/api/me').flush(ada);
      const out: boolean[] = [];
      service.signOut().subscribe((ok) => out.push(ok));
      http.expectOne('/api/auth/logout').error(new ProgressEvent('error'));
      expect(out).toEqual([false]);
      expect(service.isAuthenticated()).toBe(true);
    });
  });
});
