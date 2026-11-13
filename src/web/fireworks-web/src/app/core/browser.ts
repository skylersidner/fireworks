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
