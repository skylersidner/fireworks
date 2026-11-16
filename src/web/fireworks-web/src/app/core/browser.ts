import { DestroyRef, InjectionToken, inject, signal, type Signal } from '@angular/core';

/**
 * localStorage, or null when the browser refuses it (a sandboxed iframe or some privacy modes
 * throw on the property read itself). Callers still wrap every getItem/setItem: quota and
 * security errors are thrown per call. Specs provide an in-memory or throwing stub.
 */
export const BROWSER_STORAGE = new InjectionToken<Storage | null>('BROWSER_STORAGE', {
  factory: () => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  },
});

/** `window.matchMedia`, or a function returning null where it doesn't exist (jsdom). */
export const MATCH_MEDIA = new InjectionToken<(query: string) => MediaQueryList | null>(
  'MATCH_MEDIA',
  {
    factory: () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? (query: string) => window.matchMedia(query)
        : () => null,
  },
);

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/** `window.devicePixelRatio`, read on each call (it changes with zoom and between screens). */
export const DEVICE_PIXEL_RATIO = new InjectionToken<() => number>('DEVICE_PIXEL_RATIO', {
  factory: () => () => (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1),
});

/**
 * The canvas resolution rule (phase-7.md §5.1, R2): the device pixel ratio, capped at 1.5 when the
 * primary pointer is coarse (a phone or tablet GPU) and at 2 otherwise. Width plays no part. The
 * one function for the Pixi stage and every timeline canvas.
 */
export function canvasResolution(dpr: number, coarse: boolean): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(ratio, coarse ? 1.5 : 2);
}

/**
 * `canvasResolution` for this device now: reads the ratio and `(pointer: coarse)` on each call, so
 * a redraw (or a renderer rebuild) picks up a change. Hosts pass the value into the engine, which
 * never calls matchMedia. Call in an injection context.
 */
export const CANVAS_RESOLUTION = new InjectionToken<() => number>('CANVAS_RESOLUTION', {
  factory: () => {
    const match = inject(MATCH_MEDIA);
    const dpr = inject(DEVICE_PIXEL_RATIO);
    return () => canvasResolution(dpr(), match(COARSE_POINTER_QUERY)?.matches ?? false);
  },
});

/**
 * A media query as a signal that follows changes, unsubscribed with the injection context's
 * DestroyRef. False when matchMedia is unavailable. Call in an injection context.
 */
export function mediaQuery(query: string): Signal<boolean> {
  const list = inject(MATCH_MEDIA)(query);
  const matches = signal(list?.matches ?? false);
  if (list) {
    const onChange = (event: MediaQueryListEvent) => matches.set(event.matches);
    list.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => list.removeEventListener('change', onChange));
  }
  return matches.asReadonly();
}

/** getItem that never throws. */
export function readStorage(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** setItem that never throws. Returns false when the write was refused. */
export function writeStorage(storage: Storage | null, key: string, value: string): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** macOS and iOS: ⌘ rather than Ctrl in copy and `aria-keyshortcuts`. */
export function isApplePlatform(): boolean {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return /Mac|iPhone|iPad|iPod/.test(nav?.platform || nav?.userAgent || '');
}

/**
 * Ctrl/⌘+S (phase-7.md §3.3, R1): either modifier on any platform, never with Alt or Shift (Shift+⌘S
 * isn't Save as new: one shortcut, one meaning).
 */
export function isSaveShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 's'
  );
}
