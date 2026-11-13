import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ApiStatusService } from '../../core/api-status';
import { MeResponse } from '../../core/models';
import { SessionService } from '../../core/session';
import { StatusPageComponent } from './status-page';

@Component({ template: '' })
class BlankComponent {}

describe('StatusPageComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StatusPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: BlankComponent },
          { path: 'status', component: StatusPageComponent },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const text = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();

  const me = (canWrite: boolean): MeResponse => ({
    userId: 'u',
    displayName: 'Default user',
    isAuthenticated: false,
    canWrite,
  });

  it('issues no request of its own; shows the shared probe and session state', async () => {
    const fixture = TestBed.createComponent(StatusPageComponent);
    await fixture.whenStable();
    http.expectNone(() => true);
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el, 'health-status')).toBe('Checking…');

    TestBed.inject(ApiStatusService).check();
    http.expectOne('/health/live').flush('Healthy');
    TestBed.inject(SessionService).load().subscribe();
    http.expectOne('/api/me').flush(me(true));
    await fixture.whenStable();

    expect(el.querySelector('h1')?.textContent).toBe('Fireworks Sandbox');
    expect(text(el, 'health-status')).toBe('Healthy');
    expect(text(el, 'write-status')).toBe('Enabled');
  });

  it('shows an unavailable API and disabled saving', async () => {
    const fixture = TestBed.createComponent(StatusPageComponent);
    TestBed.inject(ApiStatusService).check();
    http.expectOne('/health/live').flush('x', { status: 502, statusText: 'Bad Gateway' });
    TestBed.inject(SessionService).load().subscribe();
    http.expectOne('/api/me').flush(me(false));
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(text(el, 'health-status')).toBe('Unavailable');
    expect(text(el, 'write-status')).toBe('Disabled on this deployment');
  });

  it('"Back to the designer" navigates in-app instead of reloading (Toad, 2c)', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/status');
    const fixture = TestBed.createComponent(StatusPageComponent);
    await fixture.whenStable();
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      '[data-testid="back-to-designer"]',
    )!;
    expect(link.getAttribute('href')).toBe('/');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    // A plain href would leave the default action (a full page load) in place.
    expect(click.defaultPrevented).toBe(true);
    await fixture.whenStable();
    expect(router.url).toBe('/');
  });
});
