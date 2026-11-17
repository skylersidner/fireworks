import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { CreationsService, parseRetryAfter, toCreationError } from './creations';
import { SUPPRESS_ERROR_TOAST } from './http-context-tokens';
import { CreationResponse } from './models';
import { SHARE_CODE_PATTERN, isShareCode } from './share-code';

const CODE = 'Ab3dEf7h';
const DOC = { version: 1, name: 'Peony', breaks: [{ pattern: 'peony' }] };

function response(overrides: Partial<CreationResponse> = {}): CreationResponse {
  return {
    shareCode: CODE,
    kind: 'shell',
    name: 'Peony',
    schemaVersion: 1,
    document: DOC,
    isOwner: true,
    remixedFrom: null,
    createdAt: '2026-11-13T21:20:26.65593+00:00',
    updatedAt: '2026-11-13T21:20:26.65593+00:00',
    ...overrides,
  };
}

describe('CreationsService', () => {
  let service: CreationsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CreationsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Every method: URL, verb, body, and the toast suppression (schema.md §2.3). */
  const CALLS: [string, (s: CreationsService) => Observable<unknown>, string, string, unknown][] = [
    [
      'create',
      (s) => s.create('shell', DOC),
      'POST',
      '/api/creations',
      { kind: 'shell', document: DOC },
    ],
    ['getByShareCode', (s) => s.getByShareCode(CODE), 'GET', `/api/creations/${CODE}`, null],
    [
      'update',
      (s) => s.update(CODE, DOC, 't0'),
      'PUT',
      `/api/creations/${CODE}`,
      { document: DOC },
    ],
    ['delete', (s) => s.delete(CODE), 'DELETE', `/api/creations/${CODE}`, null],
    ['remix', (s) => s.remix(CODE, DOC), 'POST', `/api/creations/${CODE}/remix`, { document: DOC }],
    ['listMine', (s) => s.listMine(), 'GET', '/api/me/creations', null],
  ];

  it.each(CALLS)(
    '%s sends exactly its request, toast suppressed',
    (_n, call, method, url, body) => {
      call(service).subscribe();
      const req = http.expectOne(url);
      expect(req.request.method).toBe(method);
      expect(req.request.body).toEqual(body);
      expect(req.request.context.get(SUPPRESS_ERROR_TOAST)).toBe(true);
      req.flush(null);
    },
  );

  it('PUT sends If-Match as the token in quotes, one strong tag (schema.md §11.4)', () => {
    service.update(CODE, DOC, '2026-11-13T21:20:26.65593+00:00').subscribe();
    const req = http.expectOne(`/api/creations/${CODE}`);
    expect(req.request.headers.getAll('If-Match')).toEqual(['"2026-11-13T21:20:26.65593+00:00"']);
    req.flush(null);
  });

  it('PUT and remix bodies carry no kind (it would be an unknown-property 400)', () => {
    service.update(CODE, DOC, 't0').subscribe();
    service.remix(CODE, DOC).subscribe();
    for (const req of http.match(() => true)) {
      expect(Object.keys(req.request.body as object)).toEqual(['document']);
      req.flush(response());
    }
  });

  it.each([
    [{}, '/api/me/creations'],
    [{ page: 2 }, '/api/me/creations?page=2'],
    [
      { page: 3, pageSize: 24, kind: 'shell' as const },
      '/api/me/creations?page=3&pageSize=24&kind=shell',
    ],
    [{ kind: 'show' as const }, '/api/me/creations?kind=show'],
  ])('listMine %j → %s', (query, url) => {
    service.listMine(query).subscribe();
    http.expectOne(url).flush({ items: [], page: 1, pageSize: 24, totalCount: 0 });
  });

  it.each([
    'abcdefgl',
    'abcdefgI',
    'abcdefgO',
    'abcdefg0',
    'Ab3dEf7',
    'Ab3dEf7hJ',
    'abcdefgh\n',
    '../me/x',
    '',
  ])('a malformed code %j is a 404 with no request, on every item method', (code) => {
    const errors: unknown[] = [];
    service.getByShareCode(code).subscribe({ error: (e) => errors.push(e) });
    service.update(code, DOC, 't0').subscribe({ error: (e) => errors.push(e) });
    service.delete(code).subscribe({ error: (e) => errors.push(e) });
    service.remix(code, DOC).subscribe({ error: (e) => errors.push(e) });
    http.expectNone(() => true);
    expect(errors.map((e) => toCreationError(e))).toEqual(
      Array(4).fill({ kind: 'not-found', status: 404 }),
    );
  });

  it('a GET document in jsonb key order equals what was sent: compare parsed values, not text', () => {
    // Postgres jsonb sorts keys by length, then bytes (schema.md §1).
    const sent = { version: 1, name: 'Peony', burstHeight: 0.65, angleJitter: 4, breaks: [] };
    const jsonbOrder = JSON.parse(
      '{"name":"Peony","breaks":[],"version":1,"angleJitter":4,"burstHeight":0.65}',
    );
    let got: CreationResponse | undefined;
    service.getByShareCode(CODE).subscribe((r) => (got = r));
    http.expectOne(`/api/creations/${CODE}`).flush(response({ document: jsonbOrder }));
    expect(got!.document).toEqual(sent);
    expect(JSON.stringify(got!.document)).not.toBe(JSON.stringify(sent));
  });
});

describe('share codes (schema.md §9)', () => {
  it('accept the Base58 alphabet only, exactly 8, case-sensitive', () => {
    expect(SHARE_CODE_PATTERN.source).toBe('^[1-9A-HJ-NP-Za-km-z]{8}$');
    expect(isShareCode('123456789'.slice(0, 8))).toBe(true);
    expect(isShareCode('ABCDEFGH')).toBe(true);
    expect(isShareCode('abcdefgh')).toBe(true);
    for (const bad of ['0', 'O', 'I', 'l', String.fromCharCode(0x212a), '-', '_'])
      expect(isShareCode(`abcdefg${bad}`)).toBe(false);
    expect(isShareCode(12345678)).toBe(false);
    expect(isShareCode(null)).toBe(false);
  });
});

describe('toCreationError', () => {
  const err = (status: number, error: unknown = null, headers?: HttpHeaders) =>
    new HttpErrorResponse({ status, error, headers, url: '/api/creations' });

  it('400 keeps message, the well-formed issues and truncated', () => {
    const body = {
      message: 'The document is invalid.',
      errors: [
        {
          path: 'breaks[0].stars',
          code: 'out-of-range',
          message: 'breaks[0].stars: 401 is outside 4..400.',
        },
        { path: 'foo', code: 'unknown-property', message: 'foo: unknown property.' },
      ],
      truncated: true,
    };
    expect(toCreationError(err(400, body))).toEqual({ kind: 'validation', status: 400, ...body });
  });

  it('400 without the §2.4 body (a { message } only 400, or junk) still maps, with no issues', () => {
    expect(toCreationError(err(400, { message: 'bad' }))).toEqual({
      kind: 'validation',
      status: 400,
      message: 'bad',
      errors: [],
      truncated: false,
    });
    expect(toCreationError(err(400, 'not json'))).toEqual({
      kind: 'validation',
      status: 400,
      message: null,
      errors: [],
      truncated: false,
    });
  });

  it('400 drops malformed issues and reads only an explicit true as truncated', () => {
    const body = {
      message: 1,
      errors: [null, 'x', { path: 'a', code: 'type' }, { path: 'b', code: 'enum', message: 'm' }],
      truncated: 'true',
    };
    expect(toCreationError(err(400, body))).toEqual({
      kind: 'validation',
      status: 400,
      message: null,
      errors: [{ path: 'b', code: 'enum', message: 'm' }],
      truncated: false,
    });
  });

  it.each([
    [401, { kind: 'unauthorized', status: 401 }],
    [403, { kind: 'forbidden', status: 403 }],
    [412, { kind: 'precondition-failed', status: 412 }],
    [428, { kind: 'precondition-required', status: 428 }],
    [404, { kind: 'not-found', status: 404 }],
    [413, { kind: 'too-large', status: 413 }],
    [0, { kind: 'network', status: 0 }],
    [415, { kind: 'unexpected', status: 415 }],
    [409, { kind: 'unexpected', status: 409 }],
    [500, { kind: 'unexpected', status: 500 }],
  ])('%i maps by status', (status, expected) => {
    expect(toCreationError(err(status, { message: 'whatever the body says' }))).toEqual(expected);
  });

  it('429 reads Retry-After seconds, and null when it is absent', () => {
    const headers = new HttpHeaders({ 'Retry-After': '37' });
    expect(toCreationError(err(429, null, headers))).toEqual({
      kind: 'rate-limited',
      status: 429,
      retryAfterSeconds: 37,
    });
    expect(toCreationError(err(429))).toEqual({
      kind: 'rate-limited',
      status: 429,
      retryAfterSeconds: null,
    });
  });

  it('a non-HTTP error is unexpected with no status', () => {
    expect(toCreationError(new Error('boom'))).toEqual({ kind: 'unexpected', status: null });
    expect(toCreationError(undefined)).toEqual({ kind: 'unexpected', status: null });
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');

  it.each([
    ['0', 0],
    ['60', 60],
    [' 5 ', 5],
    ['Sat, 14 Nov 2026 12:00:30 GMT', 30],
    ['Sat, 14 Nov 2026 11:00:00 GMT', 0],
    ['', null],
    ['-1', null],
    ['1.5', null],
    ['soon', null],
    ['2026', 2026],
    ['2026-11-14', null],
  ])('%j → %j', (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });

  it('null header → null', () => expect(parseRetryAfter(null, now)).toBeNull());
});
