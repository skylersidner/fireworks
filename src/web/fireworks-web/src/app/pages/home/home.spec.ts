import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MeResponse } from '../../core/models';
import { SessionService } from '../../core/session';
import { FakeCanaryScene } from '../../testing/fake-canary-scene';
import { HomePageComponent } from './home';
import { CANARY_SCENE_FACTORY } from './pixi-canary/pixi-canary';

describe('HomePageComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [HomePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CANARY_SCENE_FACTORY, useValue: new FakeCanaryScene().factory },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  const text = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="${id}"]`)?.textContent?.trim();

  const me = (canWrite: boolean): MeResponse => ({
    userId: 'u',
    displayName: 'Default user',
    isAuthenticated: false,
    canWrite,
  });

  it('shows the title, healthy API and enabled saving when canWrite is true', async () => {
    const session = TestBed.inject(SessionService);
    session.load().subscribe();
    http.expectOne('/api/me').flush(me(true));

    const fixture = TestBed.createComponent(HomePageComponent);
    http.expectOne('/health/live').flush('Healthy');
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Fireworks Sandbox');
    expect(text(el, 'health-status')).toBe('Healthy');
    expect(text(el, 'write-status')).toBe('Enabled');
  });

  it('shows disabled saving when canWrite is false and an unavailable API', async () => {
    TestBed.inject(SessionService).load().subscribe();
    http.expectOne('/api/me').flush(me(false));

    const fixture = TestBed.createComponent(HomePageComponent);
    http.expectOne('/health/live').flush('x', { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(text(el, 'health-status')).toBe('Unavailable');
    expect(text(el, 'write-status')).toBe('Disabled on this deployment');
  });
});
