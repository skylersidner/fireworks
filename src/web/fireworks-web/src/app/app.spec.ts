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

  // K7 (phase-7.md §3.2; acceptance 7g.9): a removed toast hands focus on.
  describe('toast × focus (K7)', () => {
    async function setup() {
      const fixture = TestBed.createComponent(App);
      document.body.appendChild(fixture.nativeElement);
      fixture.detectChanges();
      http.expectOne('/health/live').flush('Healthy');
      const el = fixture.nativeElement as HTMLElement;
      const h1 = document.createElement('h1');
      h1.tabIndex = -1;
      el.prepend(h1);
      const notifications = TestBed.inject(NotificationService);
      const xs = () => [...el.querySelectorAll<HTMLButtonElement>('[data-testid="toast-dismiss"]')];
      const done = async () => {
        await fixture.whenStable();
        await new Promise((r) => setTimeout(r));
        await fixture.whenStable();
      };
      return { fixture, el, h1, notifications, xs, done };
    }

    it('× on a toast focuses the next toast’s ×, then the h1', async () => {
      const { fixture, h1, notifications, xs, done } = await setup();
      notifications.success('One');
      notifications.success('Two');
      await done();
      xs()[0].focus();
      xs()[0].click();
      await done();
      expect(xs()).toHaveLength(1);
      expect(document.activeElement).toBe(xs()[0]);
      xs()[0].click();
      await done();
      expect(document.activeElement).toBe(h1);
      fixture.nativeElement.remove();
    });

    it('a focused toast that times out hands focus on too; an unfocused one moves nothing', async () => {
      vi.useFakeTimers();
      try {
        const { fixture, h1, notifications, xs } = await setup();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        notifications.success('One');
        fixture.detectChanges();
        outside.focus();
        vi.advanceTimersByTime(5000);
        fixture.detectChanges();
        vi.advanceTimersByTime(10);
        expect(document.activeElement).toBe(outside);
        notifications.success('Two');
        fixture.detectChanges();
        xs()[0].focus();
        vi.advanceTimersByTime(5000);
        fixture.detectChanges();
        vi.advanceTimersByTime(10);
        fixture.detectChanges();
        expect(document.activeElement).toBe(h1);
        outside.remove();
        fixture.nativeElement.remove();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
