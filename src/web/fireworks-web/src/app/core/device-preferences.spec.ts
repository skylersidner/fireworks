import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../testing/memory-storage';
import { BROWSER_STORAGE } from './browser';
import {
  DevicePreferencesService,
  FLASH_NOTICE_KEY,
  REDUCE_FLASHING_KEY,
} from './device-preferences';

/** Device-wide flashing preferences (Skyler, 2026-11-14; phase-5.md §8.3). */
describe('DevicePreferencesService', () => {
  let storage: MemoryStorage;
  const create = () => {
    TestBed.configureTestingModule({
      providers: [{ provide: BROWSER_STORAGE, useValue: storage }],
    });
    return TestBed.inject(DevicePreferencesService);
  };

  beforeEach(() => (storage = new MemoryStorage()));

  it('reads the stored choice: on, off, or absent (follow the OS)', () => {
    storage.setItem(REDUCE_FLASHING_KEY, 'on');
    expect(create().reduceFlashingChoice()).toBe(true);
    TestBed.resetTestingModule();
    storage.setItem(REDUCE_FLASHING_KEY, 'off');
    expect(create().reduceFlashingChoice()).toBe(false);
    TestBed.resetTestingModule();
    storage.setItem(REDUCE_FLASHING_KEY, 'yes please');
    expect(create().reduceFlashingChoice()).toBeNull();
  });

  it('a legacy draft choice is adopted only when the device has none', () => {
    const prefs = create();
    prefs.adoptLegacyReduceFlashing(null);
    expect(storage.getItem(REDUCE_FLASHING_KEY)).toBeNull();
    prefs.adoptLegacyReduceFlashing(true);
    expect(storage.getItem(REDUCE_FLASHING_KEY)).toBe('on');
    prefs.adoptLegacyReduceFlashing(false);
    expect(prefs.reduceFlashingChoice()).toBe(true);
  });

  it('the notice dismissal is read from storage each time; refused storage never remembers it', () => {
    const prefs = create();
    expect(prefs.flashNoticeDismissed()).toBe(false);
    prefs.dismissFlashNotice();
    expect(storage.getItem(FLASH_NOTICE_KEY)).toBe('1');
    expect(prefs.flashNoticeDismissed()).toBe(true);
    storage.clear();
    storage.failWrites = true;
    prefs.dismissFlashNotice();
    expect(prefs.flashNoticeDismissed()).toBe(false);
  });
});
