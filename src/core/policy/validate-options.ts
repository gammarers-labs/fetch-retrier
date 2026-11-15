import { FetchRetrierInvalidOptionsError } from '../errors';
import { RequestOptions } from '../options';

/**
 * True when `value` is a finite integer.
 *
 * Relational checks alone accept `NaN` (every comparison is false) and `Infinity`.
 * A non-integer `retries` also changes how many attempts the loop runs.
 */
const isFiniteInteger = (value: number): boolean => {
  return Number.isFinite(value) && Number.isInteger(value);
};

/**
 * Validates retry policy numeric fields on {@link RequestOptions}.
 *
 * Each value must be a finite integer. Constraints: `retries >= 1`, `timeoutMs > 0`,
 * `baseBackoffMs >= 0`, and when set `maxBackoffMs >= 0` and `maxRetryAfterMs >= 0`.
 *
 * @param options - Options whose `retries`, `timeoutMs`, `baseBackoffMs`, and optional
 *   `maxBackoffMs` and `maxRetryAfterMs` are checked
 * @throws {FetchRetrierInvalidOptionsError} When any constraint is violated
 */
export const validateRequestOptions = (
  options: Pick<RequestOptions, 'retries' | 'timeoutMs' | 'baseBackoffMs' | 'maxBackoffMs' | 'maxRetryAfterMs'>,
): void => {
  const { retries, timeoutMs, baseBackoffMs, maxBackoffMs, maxRetryAfterMs } = options;

  if (!isFiniteInteger(retries) || retries < 1) {
    throw new FetchRetrierInvalidOptionsError('retries must be an integer >= 1');
  }
  if (!isFiniteInteger(timeoutMs) || timeoutMs <= 0) {
    throw new FetchRetrierInvalidOptionsError('timeoutMs must be an integer > 0');
  }
  if (!isFiniteInteger(baseBackoffMs) || baseBackoffMs < 0) {
    throw new FetchRetrierInvalidOptionsError('baseBackoffMs must be an integer >= 0');
  }
  if (maxBackoffMs !== undefined && (!isFiniteInteger(maxBackoffMs) || maxBackoffMs < 0)) {
    throw new FetchRetrierInvalidOptionsError('maxBackoffMs must be an integer >= 0');
  }
  if (maxRetryAfterMs !== undefined && (!isFiniteInteger(maxRetryAfterMs) || maxRetryAfterMs < 0)) {
    throw new FetchRetrierInvalidOptionsError('maxRetryAfterMs must be an integer >= 0');
  }
};
