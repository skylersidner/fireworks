import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notifications';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => vi.useRealTimers());

  it('adds and auto-dismisses notifications after 4s', () => {
    service.success('Saved');
    expect(service.notifications()).toEqual([{ id: 1, kind: 'success', message: 'Saved' }]);

    vi.advanceTimersByTime(3999);
    expect(service.notifications().length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(service.notifications().length).toBe(0);
  });

  it('dismisses one notification by id', () => {
    service.error('A');
    service.error('B');
    service.dismiss(1);
    expect(service.notifications().map((n) => n.message)).toEqual(['B']);
  });
});
