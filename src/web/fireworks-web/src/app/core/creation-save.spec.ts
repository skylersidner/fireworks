import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  CreationSource,
  SaveOutcome,
  fallbackPlan,
  planSave,
  saveChoices,
  saveCreation,
  sourceFrom,
  type SaveChoice,
} from './creation-save';
import { CreationError, CreationsService } from './creations';
import { CreationResponse } from './models';

/**
 * Save on a working copy (schema.md §11.2, §11.4). Every request-level spec asserts the complete
 * call ledger, not just that the expected call happened (toad-exact-call-ledger-over-positive-
 * assertions.md): Save has four paths onto three endpoints, plus a fallback.
 */

const SRC = 'Ab3dEf7h';
const NEW = 'Zz9yXw8v';
const DOC = { version: 1, name: 'Edited', breaks: [{ pattern: 'ring' }] };

function record(overrides: Partial<CreationResponse> = {}): CreationResponse {
  return {
    shareCode: SRC,
    kind: 'shell',
    name: 'Peony',
    schemaVersion: 1,
    document: { version: 1, name: 'Peony', breaks: [] },
    isOwner: true,
    remixedFrom: null,
    createdAt: '2026-11-13T21:20:26.1+00:00',
    updatedAt: '2026-11-13T21:20:26.1+00:00',
    ...overrides,
  };
}

const owned: CreationSource = sourceFrom(record());
const notOwned: CreationSource = sourceFrom(record({ isOwner: false }));
const notFound: CreationError = { kind: 'not-found', status: 404 };

describe('save decision (pure)', () => {
  it('sourceFrom keeps exactly shareCode, kind, isOwner, updatedAt and name (Y1)', () => {
    expect(sourceFrom(record({ remixedFrom: 'Qq1wEe2r' }))).toEqual({
      shareCode: SRC,
      kind: 'shell',
      isOwner: true,
      updatedAt: '2026-11-13T21:20:26.1+00:00',
      name: 'Peony',
    });
  });

  it('offers one Save for fresh work and non-owners, two choices for an owner', () => {
    expect(saveChoices(null)).toEqual(['save']);
    expect(saveChoices(notOwned)).toEqual(['save']);
    expect(saveChoices(owned)).toEqual(['update', 'saveAsNew']);
  });

  it.each<[string, CreationSource | null, SaveChoice, unknown]>([
    ['fresh work', null, 'save', { request: 'create' }],
    ['owner, Update original', owned, 'update', { request: 'update', shareCode: SRC }],
    ['owner, Save as new', owned, 'saveAsNew', { request: 'remix', shareCode: SRC }],
    ['non-owner', notOwned, 'save', { request: 'remix', shareCode: SRC }],
  ])('%s → %j', (_name, source, choice, plan) => {
    expect(planSave(source, choice, 'shell')).toEqual(plan);
  });

  it.each<[string, CreationSource | null, SaveChoice]>([
    ['update on fresh work', null, 'update'],
    ['saveAsNew on fresh work', null, 'saveAsNew'],
    ['update for a non-owner', notOwned, 'update'],
    ['saveAsNew for a non-owner', notOwned, 'saveAsNew'],
    ['a bare save for an owner (a choice is required)', owned, 'save'],
  ])('rejects a choice that was not offered: %s', (_name, source, choice) => {
    expect(() => planSave(source, choice, 'shell')).toThrow(/isn't offered/);
  });

  it("rejects saving a shell over a show's source", () => {
    expect(() => planSave({ ...owned, kind: 'show' }, 'update', 'shell')).toThrow(/show/);
  });

  it('only a 404 from remix falls back to a plain create; a PUT 404 asks first (phase-5.md §6)', () => {
    expect(fallbackPlan({ request: 'update', shareCode: SRC }, notFound)).toBeNull();
    expect(fallbackPlan({ request: 'remix', shareCode: SRC }, notFound)).toEqual({
      request: 'create',
    });
    expect(fallbackPlan({ request: 'create' }, notFound)).toBeNull();
    const others: CreationError[] = [
      { kind: 'validation', status: 400, message: null, errors: [], truncated: false },
      { kind: 'forbidden', status: 403 },
      { kind: 'too-large', status: 413 },
      { kind: 'rate-limited', status: 429, retryAfterSeconds: 5 },
      { kind: 'network', status: 0 },
      { kind: 'unexpected', status: 500 },
    ];
    for (const e of others) {
      expect(fallbackPlan({ request: 'update', shareCode: SRC }, e)).toBeNull();
      expect(fallbackPlan({ request: 'remix', shareCode: SRC }, e)).toBeNull();
    }
  });
});

describe('saveCreation (call ledger)', () => {
  let service: CreationsService;
  let http: HttpTestingController;
  let ledger: string[];

  const recorder: HttpInterceptorFn = (req, next) => {
    ledger.push(`${req.method} ${req.url}`);
    return next(req);
  };

  beforeEach(() => {
    ledger = [];
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([recorder])), provideHttpClientTesting()],
    });
    service = TestBed.inject(CreationsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function run(source: CreationSource | null, choice: SaveChoice): SaveOutcome[] {
    const outcomes: SaveOutcome[] = [];
    saveCreation(service, { source, choice, kind: 'shell', document: DOC }).subscribe({
      next: (o) => outcomes.push(o),
      error: () => outcomes.push('ERRORED' as never),
    });
    return outcomes;
  }

  const fail404 = (url: string) =>
    http
      .expectOne(url)
      .flush(
        { message: 'No creation has that share code.' },
        { status: 404, statusText: 'Not Found' },
      );

  it('fresh work: exactly one POST api/creations with { kind, document }; source = the new record', () => {
    const outcomes = run(null, 'save');
    const req = http.expectOne('/api/creations');
    expect(req.request.body).toEqual({ kind: 'shell', document: DOC });
    req.flush(record({ shareCode: NEW, updatedAt: 't1' }), { status: 201, statusText: 'Created' });

    expect(ledger).toEqual(['POST /api/creations']);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ ok: true, request: 'create', fellBack: false });
    expect(outcomes[0].ok && outcomes[0].source).toEqual({
      shareCode: NEW,
      kind: 'shell',
      isOwner: true,
      updatedAt: 't1',
      name: 'Peony',
    });
  });

  it('owner, Update original: exactly one PUT; source.updatedAt refreshed, same code', () => {
    const outcomes = run(owned, 'update');
    const req = http.expectOne(`/api/creations/${SRC}`);
    expect(req.request.body).toEqual({ document: DOC });
    req.flush(record({ updatedAt: '2026-11-13T21:20:27.000001+00:00' }));

    expect(ledger).toEqual([`PUT /api/creations/${SRC}`]);
    expect(outcomes[0]).toMatchObject({
      ok: true,
      request: 'update',
      fellBack: false,
      source: { ...owned, updatedAt: '2026-11-13T21:20:27.000001+00:00' },
    });
  });

  it('owner, Save as new: exactly one POST …/remix; source = the new record', () => {
    const outcomes = run(owned, 'saveAsNew');
    http
      .expectOne(`/api/creations/${SRC}/remix`)
      .flush(record({ shareCode: NEW, remixedFrom: SRC, updatedAt: 't2' }), {
        status: 201,
        statusText: 'Created',
      });

    expect(ledger).toEqual([`POST /api/creations/${SRC}/remix`]);
    expect(outcomes[0]).toMatchObject({
      ok: true,
      request: 'remix',
      source: { shareCode: NEW, isOwner: true },
    });
  });

  it('non-owner (stubbed isOwner: false GET): exactly one POST …/remix and no PUT (schema.md §11.5)', () => {
    // The working copy's source comes from a GET answered with isOwner: false, as /c/:code builds it.
    let source: CreationSource | null = null;
    service.getByShareCode(SRC).subscribe((r) => (source = sourceFrom(r)));
    http.expectOne(`/api/creations/${SRC}`).flush(record({ isOwner: false }));
    expect(saveChoices(source)).toEqual(['save']);
    ledger = [];

    const outcomes = run(source, 'save');
    const req = http.expectOne(`/api/creations/${SRC}/remix`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ document: DOC });
    req.flush(record({ shareCode: NEW, isOwner: true, remixedFrom: SRC }), {
      status: 201,
      statusText: 'Created',
    });

    expect(ledger).toEqual([`POST /api/creations/${SRC}/remix`]);
    expect(ledger.filter((l) => l.startsWith('PUT '))).toEqual([]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ ok: true, request: 'remix', fellBack: false });
    expect(outcomes[0].ok && outcomes[0].source.shareCode).toBe(NEW);
  });

  it('a 404 from PUT ends there: one request, a not-found failure for the caller to ask about', () => {
    const outcomes = run(owned, 'update');
    fail404(`/api/creations/${SRC}`);

    expect(ledger).toEqual([`PUT /api/creations/${SRC}`]);
    expect(outcomes).toEqual([
      { ok: false, request: 'update', fellBack: false, error: { kind: 'not-found', status: 404 } },
    ]);
  });

  it('a response share code that fails the §9 pattern is a failure, never a source (Boo C4)', () => {
    const outcomes = run(null, 'save');
    http
      .expectOne('/api/creations')
      .flush(record({ shareCode: 'ab/../x1' }), { status: 201, statusText: 'Created' });
    expect(outcomes).toEqual([
      { ok: false, request: 'create', fellBack: false, error: { kind: 'unexpected', status: 200 } },
    ]);
  });

  it.each([
    ['owner, Save as new', owned, 'saveAsNew' as const],
    ['non-owner', notOwned, 'save' as const],
  ])(
    '%s: a 404 from remix falls back to one plain POST, not a second remix',
    (_n, source, choice) => {
      const outcomes = run(source, choice);
      fail404(`/api/creations/${SRC}/remix`);
      http
        .expectOne('/api/creations')
        .flush(record({ shareCode: NEW }), { status: 201, statusText: 'Created' });

      expect(ledger).toEqual([`POST /api/creations/${SRC}/remix`, 'POST /api/creations']);
      expect(outcomes[0]).toMatchObject({ ok: true, request: 'create', fellBack: true });
    },
  );

  it('a 404 from the fallback POST ends there: two requests, a failure with fellBack', () => {
    const outcomes = run(owned, 'saveAsNew');
    fail404(`/api/creations/${SRC}/remix`);
    fail404('/api/creations');

    expect(ledger).toEqual([`POST /api/creations/${SRC}/remix`, 'POST /api/creations']);
    expect(outcomes).toEqual([
      { ok: false, request: 'create', fellBack: true, error: { kind: 'not-found', status: 404 } },
    ]);
  });

  it('a fresh-work 404 does not retry', () => {
    const outcomes = run(null, 'save');
    fail404('/api/creations');
    expect(ledger).toEqual(['POST /api/creations']);
    expect(outcomes).toEqual([
      { ok: false, request: 'create', fellBack: false, error: { kind: 'not-found', status: 404 } },
    ]);
  });

  it.each([
    [
      400,
      { message: 'm', errors: [{ path: 'name', code: 'type', message: 'x' }], truncated: false },
    ],
    [403, { message: 'Writes are off.' }],
    [413, null],
    [429, null],
    [500, null],
  ])('a %i from PUT is a failure value with no fallback request', (status, body) => {
    const outcomes = run(owned, 'update');
    http.expectOne(`/api/creations/${SRC}`).flush(body, { status, statusText: 'x' });
    expect(ledger).toEqual([`PUT /api/creations/${SRC}`]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      ok: false,
      request: 'update',
      fellBack: false,
      error: { status },
    });
  });

  it('a network failure (status 0) from remix is a failure value with no fallback', () => {
    const outcomes = run(owned, 'saveAsNew');
    http.expectOne(`/api/creations/${SRC}/remix`).error(new ProgressEvent('error'));
    expect(ledger).toEqual([`POST /api/creations/${SRC}/remix`]);
    expect(outcomes).toEqual([
      { ok: false, request: 'remix', fellBack: false, error: { kind: 'network', status: 0 } },
    ]);
  });

  it('a caller bug throws before any request', () => {
    expect(() => run(notOwned, 'update')).toThrow();
    expect(ledger).toEqual([]);
  });
});
