import { TestBed } from '@angular/core/testing';
import { MemoryStorage } from '../testing/memory-storage';
import { BROWSER_STORAGE } from './browser';
import {
  DevicePreferencesService,
  FLASH_NOTICE_KEY,
  MOTION_BLUR_KEY,
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

  describe('Motion blur (device-wide; Skyler, 2026-11-14)', () => {
    it.each([
      ['0.4', 0.4, 0.4],
      ['0', 0, 0],
      ['5', 0.92, 0.92],
      ['-1', 0, 0],
      ['blurry', null, 0.78],
      ['', null, 0.78],
    ])('stored %j reads as choice %j, renders %j', (text, choice, value) => {
      storage.setItem(MOTION_BLUR_KEY, text);
      const prefs = create();
      expect(prefs.motionBlurChoice()).toBe(choice);
      expect(prefs.motionBlur()).toBe(value);
    });

    it('absent is the default and writes nothing; a set is stored clamped', () => {
      const prefs = create();
      expect(prefs.motionBlurChoice()).toBeNull();
      expect(prefs.motionBlur()).toBe(0.78);
      expect(storage.getItem(MOTION_BLUR_KEY)).toBeNull();
      prefs.setMotionBlur(0.3);
      expect(storage.getItem(MOTION_BLUR_KEY)).toBe('0.3');
      prefs.setMotionBlur(2);
      expect(prefs.motionBlur()).toBe(0.92);
      prefs.setMotionBlur(Number.NaN);
      expect(storage.getItem(MOTION_BLUR_KEY)).toBe('0.92');
    });

    it('a legacy draft value is adopted only when the device has none', () => {
      const prefs = create();
      prefs.adoptLegacyMotionBlur(undefined);
      expect(storage.getItem(MOTION_BLUR_KEY)).toBeNull();
      prefs.adoptLegacyMotionBlur(0.25);
      expect(storage.getItem(MOTION_BLUR_KEY)).toBe('0.25');
      prefs.adoptLegacyMotionBlur(0.6);
      expect(prefs.motionBlur()).toBe(0.25);
    });

    it('refused storage keeps the value for the page only', () => {
      storage.failWrites = true;
      const prefs = create();
      prefs.setMotionBlur(0.1);
      expect(prefs.motionBlur()).toBe(0.1);
      expect(storage.getItem(MOTION_BLUR_KEY)).toBeNull();
    });
  });
});
