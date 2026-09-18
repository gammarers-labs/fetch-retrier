import { FetchRetrierInvalidOptionsError } from '../errors';
import { RequestOptions } from '../options';

/**
 * Validates retry policy numeric fields on {@link RequestOptions}.
 *
 * Constraints: `retries >= 1`, `timeoutMs > 0`, `baseBackoffMs >= 0`, and when set
 * `maxBackoffMs >= 0`.
 *
 * @param options - Options whose `retries`, `timeoutMs`, `baseBackoffMs`, and optional
 *   `maxBackoffMs` are checked
 * @throws {FetchRetrierInvalidOptionsError} When any constraint is violated
 */
export const validateRequestOptions = (
  options: Pick<RequestOptions, 'retries' | 'timeoutMs' | 'baseBackoffMs' | 'maxBackoffMs'>,
): void => {
  const { retries, timeoutMs, baseBackoffMs, maxBackoffMs } = options;

  if (retries < 1) {
    throw new FetchRetrierInvalidOptionsError('retries must be >= 1');
  }
  if (timeoutMs <= 0) {
    throw new FetchRetrierInvalidOptionsError('timeoutMs must be > 0');
  }
  if (baseBackoffMs < 0) {
    throw new FetchRetrierInvalidOptionsError('baseBackoffMs must be >= 0');
  }
  if (maxBackoffMs !== undefined && maxBackoffMs < 0) {
    throw new FetchRetrierInvalidOptionsError('maxBackoffMs must be >= 0');
  }
};
