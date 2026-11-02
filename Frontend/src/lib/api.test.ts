import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, buildQuery, getAccessToken, newIdempotencyKey, setAccessToken, setSessionLostHandler } from './api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const calls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(null);
    setSessionLostHandler(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the bearer token and credentials, and builds the query string', async () => {
    setAccessToken('tok');
    fetchMock.mockResolvedValue(json({ ok: true }));
    await api('/centres', { query: { status: 'ACTIVE', search: '', page: 2, none: undefined } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/centres?status=ACTIVE&page=2');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.credentials).toBe('include');
  });

  it('serialises a JSON body with the right header', async () => {
    fetchMock.mockResolvedValue(json({}));
    await api('/payments', { method: 'POST', body: { amount: '10.00' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"amount":"10.00"}');
  });

  it('turns an API error body into an ApiError with code, details and reference', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'OVER_ALLOCATION_PAYMENT', message: 'Cannot commit', details: [{ field: 'amount', message: 'too much' }], correlationId: 'abc' } }, 422));
    const error = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: 'OVER_ALLOCATION_PAYMENT', correlationId: 'abc' });
    expect(error.details[0].message).toBe('too much');
  });

  it('refreshes once on 401 and retries the request with the new token', async () => {
    setAccessToken('old');
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401))
      .mockResolvedValueOnce(json({ accessToken: 'new', user: {} }))
      .mockResolvedValueOnce(json({ items: [] }));
    const result = await api('/payments');
    expect(result).toEqual({ items: [] });
    expect(calls(fetchMock)).toEqual(['GET /api/v1/payments', 'POST /api/v1/auth/refresh', 'GET /api/v1/payments']);
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new');
    expect(getAccessToken()).toBe('new');
  });

  it('shares one refresh between concurrent 401s', async () => {
    setAccessToken('old');
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) { refreshes += 1; return json({ accessToken: 'new', user: {} }); }
      const token = (init?.headers as Record<string, string>)?.Authorization;
      return token === 'Bearer new' ? json({ ok: true }) : json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401);
    });
    await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(refreshes).toBe(1);
  });

  it('signals session loss and throws when the refresh fails', async () => {
    const lost = vi.fn();
    setSessionLostHandler(lost);
    setAccessToken('old');
    fetchMock
      .mockResolvedValueOnce(json({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401))
      .mockResolvedValueOnce(json({ error: { code: 'UNAUTHENTICATED', message: 'gone' } }, 401));
    await expect(api('/payments')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('does not try to refresh when the sign-in call itself returns 401', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' } }, 401));
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ message: 'Invalid email or password' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for 204 and a blob when asked', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await api('/auth/logout', { method: 'POST' })).toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response('a,b', { status: 200 }));
    const blob = await api<Blob>('/imports/template', { blob: true });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(3);
  });

  it('buildQuery skips empty values', () => {
    expect(buildQuery({ a: 1, b: '', c: null, d: false })).toBe('?a=1&d=false');
    expect(buildQuery({})).toBe('');
  });
});

describe('idempotency keys', () => {
  afterEach(() => vi.unstubAllGlobals());
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('produces a UUID v4 and a fresh one each time', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(UUID);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it('still works where crypto.randomUUID is unavailable (plain HTTP origins)', () => {
    const real = globalThis.crypto; // capture before the global is replaced
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => real.getRandomValues(array) });
    expect(newIdempotencyKey()).toMatch(UUID);
  });
});
