import type { HttpInterceptorFn } from '@angular/common/http';
import type { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { editableFrom } from '../features/designer/shared/designer-draft';
import { PRESETS } from '../../engine/model/presets';
import type { CreationResponse, MeResponse } from '../core/models';
import { SessionService } from '../core/session';

/** Valid §9 share codes for specs. */
export const CODE_A = 'Ab3dEf7h';
export const CODE_B = 'Zz9yXw8v';
export const CODE_C = 'Qq1wEe2r';

/** `api/me` shapes: writes on before Phase 8, writes off, and the Phase 8 signed-in shape. */
export const ME_TEST_WINDOW: MeResponse = {
  userId: '00000000-0000-0000-0000-000000000001',
  displayName: null,
  isAuthenticated: false,
  canWrite: true,
};
export const ME_READ_ONLY: MeResponse = { ...ME_TEST_WINDOW, canWrite: false };
export const ME_SIGNED_IN: MeResponse = { ...ME_TEST_WINDOW, isAuthenticated: true };

/** A saved shell as `GET api/creations/{code}` returns it. */
export function creationResponse(overrides: Partial<CreationResponse> = {}): CreationResponse {
  const document = overrides.document ?? editableFrom(PRESETS[2]);
  return {
    shareCode: CODE_A,
    kind: 'shell',
    name: (document as { name?: string }).name ?? 'Willow',
    schemaVersion: 1,
    document,
    isOwner: true,
    remixedFrom: null,
    createdAt: '2026-11-14T10:00:00.123456+00:00',
    updatedAt: '2026-11-14T10:00:00.123456+00:00',
    ...overrides,
  };
}

/**
 * Starts `api/me` and answers it: a `MeResponse`, `'error'` (status 0), or `'pending'` (left open;
 * the returned function answers it later).
 */
export function settleSession(
  http: HttpTestingController,
  me: MeResponse | 'error' | 'pending',
): (later: MeResponse | 'error') => void {
  TestBed.inject(SessionService).load().subscribe();
  const answer = (value: MeResponse | 'error') => {
    const req = http.expectOne('/api/me');
    if (value === 'error') req.error(new ProgressEvent('error'), { status: 0, statusText: '' });
    else req.flush(value);
  };
  if (me !== 'pending') answer(me);
  return answer;
}

/** Records every request as `METHOD url` (with query), for exact call ledgers. */
export function recorder(ledger: string[]): HttpInterceptorFn {
  return (req, next) => {
    ledger.push(`${req.method} ${req.urlWithParams}`);
    return next(req);
  };
}
