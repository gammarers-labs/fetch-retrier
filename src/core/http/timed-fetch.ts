/**
 * One HTTP attempt: per-attempt timeout and optional external abort, then `fetch`.
 *
 * Does not retry or map failures to package errors. Native `AbortError` and `TypeError`
 * propagate to the caller.
 */

export interface TimedFetchOptions {
  /**
   * Per-attempt timeout in milliseconds.
   */
  timeoutMs: number;
  /**
   * `fetch` options excluding `signal`.
   */
  init?: Omit<RequestInit, 'signal'>;
  /**
   * Headers sent on this attempt. Override `init.headers` when both are set.
   */
  headers?: Record<string, string>;
  /**
   * Optional external abort signal; aborts the in-flight request when fired.
   */
  signal?: AbortSignal;
}

/**
 * Calls `fetch` with an internal {@link AbortSignal} for `timeoutMs`.
 *
 * @param url - Request URL passed to `fetch`
 * @param options - Timeout, init, headers, and optional external signal
 * @returns The {@link Response} from this single attempt
 */
export const timedFetch = async (url: string, options: TimedFetchOptions): Promise<Response> => {
  const { timeoutMs, init, headers, signal: externalSignal } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = (): void => {
    clearTimeout(timer);
    controller.abort();
  };

  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort);
  }

  try {
    return await fetch(url, {
      ...init,
      ...(headers !== undefined ? { headers } : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
};
