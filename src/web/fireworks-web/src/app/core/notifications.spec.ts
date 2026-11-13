import { TestBed } from '@angular/core/testing';
import { ERROR_TOAST_MS, NotificationService, SUCCESS_TOAST_MS } from './notifications';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => vi.useRealTimers());

  it('auto-dismisses a success toast after 4 s', () => {
    expect(SUCCESS_TOAST_MS).toBe(4000);
    service.success('Saved');
    expect(service.notifications()).toEqual([{ id: 1, kind: 'success', message: 'Saved' }]);

    vi.advanceTimersByTime(3999);
    expect(service.notifications().length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(service.notifications().length).toBe(0);
  });

  it('keeps an error toast 8 s', () => {
    expect(ERROR_TOAST_MS).toBe(8000);
    service.error('Nope');
    vi.advanceTimersByTime(7999);
    expect(service.notifications().length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(service.notifications().length).toBe(0);
  });

  it('pauses while held and resumes with the time that was left', () => {
    service.error('Nope');
    vi.advanceTimersByTime(3000);
    service.pause(1);
    service.pause(1); // hover and focus
    vi.advanceTimersByTime(60_000);
    expect(service.notifications().length).toBe(1);
    service.resume(1);
    vi.advanceTimersByTime(60_000);
    expect(service.notifications().length).toBe(1);
    service.resume(1);
    vi.advanceTimersByTime(4999);
    expect(service.notifications().length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(service.notifications().length).toBe(0);
  });

  it('dismisses one notification by id, and its timer with it', () => {
    service.error('A');
    service.error('B');
    service.dismiss(1);
    expect(service.notifications().map((n) => n.message)).toEqual(['B']);
    service.resume(1);
    service.pause(1);
    expect(vi.getTimerCount()).toBe(1);
  });
});
