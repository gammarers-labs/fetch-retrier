import {
  DEFAULT_RETRYABLE_HTTP_STATUSES,
  defaultShouldRetry,
  fetchRetrier,
  FetchRetrierAbortError,
  FetchRetrierAlreadyAbortedError,
  FetchRetrierHttpError,
  FetchRetrierInvalidOptionsError,
  FetchRetrierNetworkError,
  parseRetryAfterMs,
  RequestOptions,
} from '../src';

const baseOptions: RequestOptions = {
  retries: 3,
  timeoutMs: 5000,
  baseBackoffMs: 10,
};

const headersWith = (entries: Record<string, string>): Headers => {
  return {
    get: (name: string): string | null => {
      const key = Object.keys(entries).find((k) => k.toLowerCase() === name.toLowerCase());
      return key === undefined ? null : entries[key];
    },
  } as Headers;
};

describe('fetchRetrier', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should return the response when res.ok is true', async () => {
    const mockRes = {
      ok: true,
      status: 200,
      text: () => Promise.resolve('ok'),
    } as unknown as Response;
    globalThis.fetch = jest.fn().mockResolvedValue(mockRes);

    const res = await fetchRetrier('https://example.com', baseOptions);

    expect(res).toBe(mockRes);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com', {
      signal: expect.any(AbortSignal),
    });
  });

  it('should pass headers option to fetch', async () => {
    const mockRes = { ok: true, status: 200, text: () => Promise.resolve('') } as unknown as Response;
    globalThis.fetch = jest.fn().mockResolvedValue(mockRes);

    await fetchRetrier('https://example.com', {
      ...baseOptions,
      headers: { 'X-Custom': 'value', 'Authorization': 'Bearer token' },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com', {
      headers: { 'X-Custom': 'value', 'Authorization': 'Bearer token' },
      signal: expect.any(AbortSignal),
    });
  });

  it('should succeed after retry when status is 429', async () => {
    const successRes = { ok: true, status: 200, text: () => Promise.resolve('') } as unknown as Response;
    const retryRes = { ok: false, status: 429, text: () => Promise.resolve('rate limited') } as unknown as Response;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(retryRes)
      .mockResolvedValueOnce(successRes);

    const res = await fetchRetrier('https://example.com', baseOptions);

    expect(res).toBe(successRes);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on default retriable status codes', async () => {
    for (const status of DEFAULT_RETRYABLE_HTTP_STATUSES) {
      globalThis.fetch = originalFetch;
      const successRes = { ok: true, status: 200, text: () => Promise.resolve('') } as unknown as Response;
      const retryRes = { ok: false, status, text: () => Promise.resolve('error') } as unknown as Response;
      globalThis.fetch = jest
        .fn()
        .mockResolvedValueOnce(retryRes)
        .mockResolvedValueOnce(successRes);

      const res = await fetchRetrier('https://example.com', baseOptions);

      expect(res).toBe(successRes);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    }
  });

  it('should extend defaultShouldRetry with additional status codes', async () => {
    const successRes = { ok: true, status: 200, text: () => Promise.resolve('') } as unknown as Response;
    const retryRes = { ok: false, status: 418, text: () => Promise.resolve('teapot') } as unknown as Response;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(retryRes)
      .mockResolvedValueOnce(successRes);

    const res = await fetchRetrier('https://example.com', {
      ...baseOptions,
      shouldRetry: (response, body) => defaultShouldRetry(response, body) || response.status === 418,
    });

    expect(res).toBe(successRes);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw FetchRetrierHttpError after max retries on retriable status', async () => {
    const retryRes = { ok: false, status: 503, text: () => Promise.resolve('unavailable') } as unknown as Response;
    globalThis.fetch = jest.fn().mockResolvedValue(retryRes);

    let caught: unknown;
    try {
      await fetchRetrier('https://example.com', { ...baseOptions, retries: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FetchRetrierHttpError);
    expect((caught as FetchRetrierHttpError).status).toBe(503);
    expect((caught as FetchRetrierHttpError).body).toBe('unavailable');
    expect((caught as FetchRetrierHttpError).message).toBe('HTTP 503');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw FetchRetrierHttpError immediately on non-retriable status (e.g. 4xx)', async () => {
    const badRes = { ok: false, status: 400, text: () => Promise.resolve('bad request') } as unknown as Response;
    globalThis.fetch = jest.fn().mockResolvedValue(badRes);

    let caught: unknown;
    try {
      await fetchRetrier('https://example.com', baseOptions);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FetchRetrierHttpError);
    expect((caught as FetchRetrierHttpError).status).toBe(400);
    expect((caught as FetchRetrierHttpError).body).toBe('bad request');
    expect((caught as FetchRetrierHttpError).message).toBe('Non-retriable HTTP error: 400');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('should use custom shouldRetry predicate', async () => {
    const retryRes = { ok: false, status: 418, text: () => Promise.resolve('teapot') } as unknown as Response;
    const successRes = { ok: true, status: 200, text: () => Promise.resolve('') } as unknown as Response;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(retryRes)
      .mockResolvedValueOnce(successRes);

    const shouldRetry = jest.fn((res: Response) => res.status === 418);

    const res = await fetchRetrier('https://example.com', {
      ...baseOptions,
      shouldRetry,
    });

    expect(res).toBe(successRes);
    expect(shouldRetry).toHaveBeenCalledWith(retryRes, 'teapot');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw without retry when custom shouldRetry returns false', async () => {
    const retryRes = { ok: false, status: 503, text: () => Promise.resolve('') } as unknown as Response;
    globalThis.fetch = jest.fn().mockResolvedValue(retryRes);

    let caught: unknown;
    try {
      await fetchRetrier('https://example.com', {
        ...baseOptions,
        shouldRetry: () => false,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FetchRetrierHttpError);
    expect((caught as FetchRetrierHttpError).status).toBe(503);
    expect((caught as FetchRetrierHttpError).body).toBe('');
    expect((caught as FetchRetrierHttpError).message).toBe('Non-retriable HTTP error: 503');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on timeout (AbortError) and throw FetchRetrierAbortError after last attempt', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    globalThis.fetch = jest.fn().mockRejectedValue(abortError);

    await expect(fetchRetrier('https://example.com', { ...baseOptions, retries: 2 })).rejects.toThrow(
      FetchRetrierAbortError,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on TypeError (network error) and throw FetchRetrierNetworkError after last attempt', async () => {
    const cause = new TypeError('fetch failed');
    globalThis.fetch = jest.fn().mockRejectedValue(cause);

    let caught: unknown;
    try {
      await fetchRetrier('https://example.com', { ...baseOptions, retries: 2 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FetchRetrierNetworkError);
    expect((caught as FetchRetrierNetworkError).cause).toBe(cause);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw FetchRetrierAlreadyAbortedError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = jest.fn();

    await expect(
      fetchRetrier('https://example.com', { ...baseOptions, signal: controller.signal }),
    ).rejects.toBeInstanceOf(FetchRetrierAlreadyAbortedError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(0);
  });

  it('should pass init options (method, body, credentials) to fetch', async () => {
    const mockRes = { ok: true, status: 200, text: () => Promise.resolve('') } as unknown as Response;
    globalThis.fetch = jest.fn().mockResolvedValue(mockRes);

    const body = JSON.stringify({ name: 'test' });
    await fetchRetrier('https://example.com/items', {
      ...baseOptions,
      init: {
        method: 'POST',
        body,
        credentials: 'include',
        redirect: 'follow',
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/items', {
      method: 'POST',
      body,
      credentials: 'include',
      redirect: 'follow',
      signal: expect.any(AbortSignal),
    });
  });

  it('should let top-level headers override init.headers', async () => {
    const mockRes = { ok: true, status: 200, text: () => Promise.resolve('') } as unknown as Response;
    globalThis.fetch = jest.fn().mockResolvedValue(mockRes);

    await fetchRetrier('https://example.com', {
      ...baseOptions,
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
      },
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': '1' },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': '1' },
      signal: expect.any(AbortSignal),
    });
  });

  it('should throw other errors immediately without retry', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Something else'));

    await expect(fetchRetrier('https://example.com', baseOptions)).rejects.toThrow('Something else');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['retries', { retries: 0 }, 'retries must be >= 1'],
    ['retries (negative)', { retries: -1 }, 'retries must be >= 1'],
    ['timeoutMs (zero)', { timeoutMs: 0 }, 'timeoutMs must be > 0'],
    ['timeoutMs (negative)', { timeoutMs: -100 }, 'timeoutMs must be > 0'],
    ['baseBackoffMs (negative)', { baseBackoffMs: -1 }, 'baseBackoffMs must be >= 0'],
  ])('should throw FetchRetrierInvalidOptionsError for invalid %s', async (_label, overrides, message) => {
    globalThis.fetch = jest.fn();

    let caught: unknown;
    try {
      await fetchRetrier('https://example.com', { ...baseOptions, ...overrides });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FetchRetrierInvalidOptionsError);
    expect((caught as FetchRetrierInvalidOptionsError).message).toBe(message);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('should allow baseBackoffMs of 0', async () => {
    const mockRes = { ok: true, status: 200, text: () => Promise.resolve('') } as unknown as Response;
    globalThis.fetch = jest.fn().mockResolvedValue(mockRes);

    await fetchRetrier('https://example.com', { ...baseOptions, baseBackoffMs: 0 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('should wait Retry-After delta-seconds before HTTP retry', async () => {
    jest.useFakeTimers();
    const retryRes = {
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limited'),
      headers: headersWith({ 'Retry-After': '3' }),
    } as unknown as Response;
    const successRes = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      headers: headersWith({}),
    } as unknown as Response;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(retryRes)
      .mockResolvedValueOnce(successRes);

    const promise = fetchRetrier('https://example.com', baseOptions);
    await jest.advanceTimersByTimeAsync(2999);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    const res = await promise;

    expect(res).toBe(successRes);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('should wait Retry-After HTTP-date before HTTP retry', async () => {
    jest.useFakeTimers();
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT');
    jest.setSystemTime(now);
    const retryRes = {
      ok: false,
      status: 503,
      text: () => Promise.resolve('unavailable'),
      headers: headersWith({ 'Retry-After': 'Wed, 21 Oct 2015 07:28:02 GMT' }),
    } as unknown as Response;
    const successRes = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      headers: headersWith({}),
    } as unknown as Response;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(retryRes)
      .mockResolvedValueOnce(successRes);

    const promise = fetchRetrier('https://example.com', baseOptions);
    await jest.advanceTimersByTimeAsync(1999);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    const res = await promise;

    expect(res).toBe(successRes);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('should fall back to full jitter when Retry-After is invalid', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const retryRes = {
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limited'),
      headers: headersWith({ 'Retry-After': 'not-a-valid-value' }),
    } as unknown as Response;
    const successRes = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      headers: headersWith({}),
    } as unknown as Response;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(retryRes)
      .mockResolvedValueOnce(successRes);

    // fullJitter(100, 1) with Math.random() === 0.5 → floor(0.5 * 200) = 100
    const promise = fetchRetrier('https://example.com', {
      ...baseOptions,
      baseBackoffMs: 100,
    });
    await jest.advanceTimersByTimeAsync(100);
    const res = await promise;

    expect(res).toBe(successRes);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe('parseRetryAfterMs', () => {
  it.each([
    ['delta-seconds', '5', 1_000_000, 5000],
    ['delta-seconds zero', '0', 1_000_000, 0],
    ['delta-seconds with surrounding whitespace', ' 2 ', 1_000_000, 2000],
    ['HTTP-date in the future', 'Wed, 21 Oct 2015 07:28:05 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'), 5000],
    ['HTTP-date in the past', 'Wed, 21 Oct 2015 07:27:00 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'), 0],
  ])('should parse %s', (_label, value, nowMs, expected) => {
    expect(parseRetryAfterMs(value, nowMs)).toBe(expected);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['non-integer delta', '1.5'],
    ['negative delta', '-1'],
    ['invalid date', 'not-a-date'],
  ])('should return undefined for %s', (_label, value) => {
    expect(parseRetryAfterMs(value, 0)).toBeUndefined();
  });
});
