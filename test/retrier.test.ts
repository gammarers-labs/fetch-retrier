import {
  fetchRetrier,
  FetchRetrierAbortError,
  FetchRetrierAlreadyAbortedError,
  FetchRetrierHttpError,
  FetchRetrierNetworkError,
  RequestOptions,
} from '../src';

const baseOptions: RequestOptions = {
  retries: 3,
  timeoutMs: 5000,
  baseBackoffMs: 10,
};

describe('fetchRetrier', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
      headers: undefined,
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

  it('should retry on retriable status codes 500, 502, 503, 504', async () => {
    const statuses = [500, 502, 503, 504];
    for (const status of statuses) {
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

    await expect(
      fetchRetrier('https://example.com', {
        ...baseOptions,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('Non-retriable HTTP error: 503');
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

  it('should throw other errors immediately without retry', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Something else'));

    await expect(fetchRetrier('https://example.com', baseOptions)).rejects.toThrow('Something else');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
