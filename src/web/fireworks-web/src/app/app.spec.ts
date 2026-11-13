import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { ApiStatusService } from './core/api-status';
import { NotificationService } from './core/notifications';

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('probes /health/live once and never blocks the page when it fails (no modal)', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/health/live').flush('x', { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(TestBed.inject(ApiStatusService).status()).toBe('unavailable');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.querySelector('[aria-modal]')).toBeNull();
    expect(TestBed.inject(NotificationService).notifications()).toEqual([]);
  });

  it('renders toasts as text and dismisses them; errors are alerts, successes polite', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/health/live').flush('Healthy');
    const notifications = TestBed.inject(NotificationService);
    notifications.error('<b>not html</b>');
    notifications.success('Saved');
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const error = el.querySelector('[data-kind="error"]')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.querySelector('span')?.textContent).toBe('<b>not html</b>');
    expect(el.querySelector('aside b')).toBeNull();
    expect(el.querySelector('[aria-live="polite"] [data-kind="success"]')).not.toBeNull();

    error.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(el.querySelector('[data-kind="error"]')).toBeNull();
  });

  it('pauses an error toast while it is hovered', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/health/live').flush('Healthy');
    const notifications = TestBed.inject(NotificationService);
    const pause = vi.spyOn(notifications, 'pause');
    const resume = vi.spyOn(notifications, 'resume');
    notifications.error('Nope');
    await fixture.whenStable();

    const error = (fixture.nativeElement as HTMLElement).querySelector('[data-kind="error"]')!;
    error.dispatchEvent(new MouseEvent('mouseenter'));
    error.dispatchEvent(new MouseEvent('mouseleave'));
    expect(pause).toHaveBeenCalledWith(1);
    expect(resume).toHaveBeenCalledWith(1);
  });
});
