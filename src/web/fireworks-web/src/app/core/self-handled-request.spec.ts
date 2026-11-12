import { HttpParams, HttpRequest } from '@angular/common/http';
import { isSelfHandledRequest } from './self-handled-request';

const get = (url: string, params?: HttpParams) =>
  new HttpRequest<unknown>('GET', url, params ? { params } : undefined);

describe('isSelfHandledRequest', () => {
  it.each([
    '/health/live',
    '/health/live?probe=1',
    '/health/live#x',
    'https://fireworks.example/health/live',
  ])('exempts the liveness probe: %s', (url) => {
    expect(isSelfHandledRequest(get(url))).toBe(true);
  });

  it('exempts the liveness probe with HttpParams', () => {
    expect(isSelfHandledRequest(get('/health/live', new HttpParams().set('a', 'b')))).toBe(true);
  });

  it.each([
    '/api/creations?next=/health/live',
    '/api/creations#/health/live',
    '/api/health/live',
    '/health/live/extra',
    '/health/liveness',
    '/health',
    'https://evil.example/x?u=https://fireworks.example/health/live',
  ])('does not exempt anything else: %s', (url) => {
    expect(isSelfHandledRequest(get(url))).toBe(false);
  });

  it('does not exempt a request whose HttpParams mention the probe path', () => {
    const params = new HttpParams().set('next', '/health/live');
    expect(isSelfHandledRequest(get('/api/creations', params))).toBe(false);
  });
});
