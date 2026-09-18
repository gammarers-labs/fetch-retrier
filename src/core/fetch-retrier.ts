import { fullJitter } from './backoff/jitter';
import { resolveRetryDelayMs } from './backoff/retry-after';
import {
  FetchRetrierAbortError,
  FetchRetrierAlreadyAbortedError,
  FetchRetrierHttpError,
  FetchRetrierNetworkError,
  FetchRetrierUnreachableError,
} from './errors';
import { timedFetch } from './http/timed-fetch';
import { RequestOptions } from './options';
import { defaultShouldRetry } from './policy/default-should-retry';
import { validateRequestOptions } from './policy/validate-options';
import { isLastAttempt } from './retry-predicates';
import { wait } from './time/wait';

/**
 * Wraps `fetch` with retries, per-attempt timeout, Retry-After support, full-jitter backoff, and
 * optional cancellation.
 *
 * Each attempt calls {@link timedFetch} with `timeoutMs`. Non-OK responses are retried when
 * `shouldRetry` returns `true` (default: {@link defaultShouldRetry}). Between HTTP retries, a
 * valid `Retry-After` header (delta-seconds or HTTP-date) is preferred over full jitter; abort
 * and network retries always use full jitter. Optional {@link RequestOptions.maxBackoffMs} clips
 * the jitter result, not a valid `Retry-After`. The same {@link FetchInitOptions} (including
 * `body`) is reused on every attempt.
 *
 * @param url - Request URL passed to `fetch`
 * @param options - {@link RequestOptions} controlling retries, timeout, request init, and cancellation
 * @returns The first {@link Response} for which `ok` is `true`
 * @throws {FetchRetrierError} All failures from this function are subclasses of this class
 * @throws {FetchRetrierInvalidOptionsError} If `retries < 1`, `timeoutMs <= 0`, `baseBackoffMs < 0`,
 *   or `maxBackoffMs` is set and `< 0`
 * @throws {FetchRetrierAlreadyAbortedError} If `options.signal` is already aborted before an attempt,
 *   including the next attempt after an in-flight external abort while retries remain
 * @throws {FetchRetrierHttpError} On a non-OK response that is not retried or after the last attempt
 *   (includes `status` and `body`)
 * @throws {FetchRetrierNetworkError} On a network `TypeError` after the last attempt
 * @throws {FetchRetrierAbortError} On per-attempt timeout after the last attempt, or external abort
 *   on the last attempt
 * @throws {FetchRetrierUnreachableError} If the retry loop exits without returning (internal bug)
 */
export const fetchRetrier = async (url: string, options: RequestOptions): Promise<Response> => {
  const {
    headers,
    init,
    retries,
    timeoutMs,
    baseBackoffMs,
    maxBackoffMs,
    signal: externalSignal,
    shouldRetry = defaultShouldRetry,
  } = options;

  validateRequestOptions({ retries, timeoutMs, baseBackoffMs, maxBackoffMs });

  for (let attempt = 1; attempt <= retries; attempt++) {
    if (externalSignal?.aborted) {
      throw new FetchRetrierAlreadyAbortedError();
    }

    try {
      const res = await timedFetch(url, {
        timeoutMs,
        init,
        headers,
        signal: externalSignal,
      });

      if (res.ok) {
        return res;
      }

      const text = await res.text();
      const isContinue = shouldRetry(res, text);

      if (!isContinue) {
        throw new FetchRetrierHttpError(`Non-retriable HTTP error: ${res.status}`, res.status, text);
      }

      if (isLastAttempt(attempt, retries)) {
        throw new FetchRetrierHttpError(`HTTP ${res.status}`, res.status, text);
      }

      await wait(resolveRetryDelayMs(res, baseBackoffMs, attempt, maxBackoffMs));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (isLastAttempt(attempt, retries)) {
          throw err instanceof FetchRetrierAbortError ? err : new FetchRetrierAbortError();
        }
        await wait(fullJitter(baseBackoffMs, attempt, maxBackoffMs));
        continue;
      }

      if (err instanceof TypeError) {
        if (isLastAttempt(attempt, retries)) {
          throw new FetchRetrierNetworkError('Network error', err);
        }
        await wait(fullJitter(baseBackoffMs, attempt, maxBackoffMs));
        continue;
      }

      throw err;
    }
  }

  throw new FetchRetrierUnreachableError();
};
