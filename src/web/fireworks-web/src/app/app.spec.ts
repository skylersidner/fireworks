import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { NotificationService } from './core/notifications';

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const dialog = (el: HTMLElement) => el.querySelector('[role="dialog"]');

  it('shows no modal when /health/live succeeds', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/health/live').flush('Healthy');
    await fixture.whenStable();

    expect(dialog(fixture.nativeElement)).toBeNull();
  });

  it('shows the API-unavailable modal when the probe fails, and Try again recovers', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/health/live').flush('x', { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(dialog(el)?.textContent).toContain('API unavailable');

    el.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click();
    http.expectOne('/health/live').flush('Healthy');
    await fixture.whenStable();

    expect(dialog(el)).toBeNull();
  });

  it('renders toasts as text and dismisses them', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/health/live').flush('Healthy');
    TestBed.inject(NotificationService).error('<b>not html</b>');
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const toast = el.querySelector('aside span');
    expect(toast?.textContent).toBe('<b>not html</b>');
    expect(el.querySelector('aside b')).toBeNull();

    el.querySelector<HTMLButtonElement>('aside button')!.click();
    await fixture.whenStable();
    expect(el.querySelector('aside span')).toBeNull();
  });
});
