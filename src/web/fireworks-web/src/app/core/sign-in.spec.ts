// @vitest-environment jsdom
import {
  LOGIN_PATH,
  SIGN_IN_INTENT_KEY,
  SIGN_IN_INTENT_MAX_AGE_MS,
  isSafeInternalUrl,
  loginUrl,
  setSignInNavigationForTesting,
  startSignIn,
  takeSignInIntent,
  writeSignInIntent,
} from './sign-in';

/**
 * The client half of Boo A5, A6 and A41 (phase-8-auth.md §6.1; phase-8.md §5.4, §6.1). The rule
 * table is the server's `SafeReturnUrl` cases (Fireworks.Api.Tests/Auth/IfMatchTests.cs), row for
 * row: the client must never pass on what the server would refuse, nor refuse what it keeps.
 */
describe('sign-in navigation and the return marker', () => {
  afterEach(() => sessionStorage.clear());

  it.each([
    [null, false],
    ['', false],
    ['/', true],
    ['//evil.example', false],
    ['/\\evil.example', false],
    ['/x\\y', false],
    ['/\t/evil.example', false],
    ['/a\u007f', false],
    ['/a\u0000', false],
    ['/api', false],
    ['/apiary', false],
    ['/Api/me', false],
    ['/%61pi/auth/logout', false],
    ['/%2F%2Fevil.example', false],
    ['/%5Cevil', false],
    ['/%zz', true],
    ['https://evil.example', false],
    ['~/x', false],
    ['/c/abcdefgh?x=1', true],
    ['/s/abc?next=//evil', true],
    ['/show#a', true],
    ['/mine?page=2', true],
    [`/${'a'.repeat(2047)}`, true],
    [`/${'a'.repeat(2048)}`, false],
  ])('isSafeInternalUrl(%j) is %s (the server table)', (url, safe) => {
    expect(isSafeInternalUrl(url)).toBe(safe);
  });

  it('loginUrl encodes the path as one query value, and replaces an unsafe one with /', () => {
    expect(loginUrl('/')).toBe(`${LOGIN_PATH}?returnUrl=%2F`);
    expect(loginUrl('/mine?page=2&x=y#z')).toBe(
      `${LOGIN_PATH}?returnUrl=%2Fmine%3Fpage%3D2%26x%3Dy%23z`,
    );
    expect(loginUrl('//evil.example')).toBe(`${LOGIN_PATH}?returnUrl=%2F`);
    expect(LOGIN_PATH).toBe('/api/auth/login/google');
  });

  it('startSignIn: flush, then the marker, then exactly one navigation (A6, §5.4)', () => {
    const order: string[] = [];
    const restore = setSignInNavigationForTesting((u) => {
      order.push(`navigate ${u}`);
      order.push(`marker ${sessionStorage.getItem(SIGN_IN_INTENT_KEY) !== null}`);
    });
    try {
      startSignIn({
        from: 'save',
        returnPath: '/show',
        beforeLeave: () =>
          order.push(`flush marker ${sessionStorage.getItem(SIGN_IN_INTENT_KEY) !== null}`),
      });
    } finally {
      restore();
    }
    expect(order).toEqual([
      'flush marker false',
      `navigate ${LOGIN_PATH}?returnUrl=%2Fshow`,
      'marker true',
    ]);
  });

  it('a throwing flush still navigates (the debounced draft is on disk)', () => {
    const navigations: string[] = [];
    const restore = setSignInNavigationForTesting((u) => navigations.push(u));
    try {
      startSignIn({
        from: 'nav',
        returnPath: '/',
        beforeLeave: () => {
          throw new Error('x');
        },
      });
    } finally {
      restore();
    }
    expect(navigations).toEqual([`${LOGIN_PATH}?returnUrl=%2F`]);
  });

  it('the marker holds only from, path and at; it is read once and deleted (§6.1)', () => {
    writeSignInIntent('save', '/show', 1000);
    expect(JSON.parse(sessionStorage.getItem(SIGN_IN_INTENT_KEY)!)).toEqual({
      from: 'save',
      path: '/show',
      at: 1000,
    });
    expect(takeSignInIntent('/show', 2000)).toEqual({ from: 'save', path: '/show', at: 1000 });
    expect(sessionStorage.getItem(SIGN_IN_INTENT_KEY)).toBeNull();
    expect(takeSignInIntent('/show', 2000)).toBeNull();
  });

  it('a marker for another page, too old, from the future or malformed is deleted and ignored', () => {
    const now = 10 * SIGN_IN_INTENT_MAX_AGE_MS;
    const cases: [string, string][] = [
      [JSON.stringify({ from: 'save', path: '/show', at: now }), '/'],
      [JSON.stringify({ from: 'save', path: '/', at: now - SIGN_IN_INTENT_MAX_AGE_MS }), '/'],
      [JSON.stringify({ from: 'save', path: '/', at: now + 1 }), '/'],
      [JSON.stringify({ from: 'auto-save', path: '/', at: now }), '/'],
      [JSON.stringify({ from: 'save', path: 7, at: now }), '/'],
      ['not json', '/'],
      ['null', '/'],
    ];
    for (const [raw, path] of cases) {
      sessionStorage.setItem(SIGN_IN_INTENT_KEY, raw);
      expect(takeSignInIntent(path, now), raw).toBeNull();
      expect(sessionStorage.getItem(SIGN_IN_INTENT_KEY)).toBeNull();
    }
    // Just inside the window, and the query doesn't matter.
    writeSignInIntent('nav', '/mine?page=3', now - SIGN_IN_INTENT_MAX_AGE_MS + 1);
    expect(takeSignInIntent('/mine', now)?.from).toBe('nav');
  });

  it("/signin reads any page's marker (path null)", () => {
    writeSignInIntent('save', '/show', 5);
    expect(takeSignInIntent(null, 6)?.from).toBe('save');
  });
});
