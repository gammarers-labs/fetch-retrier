/**
 * Retry-loop predicates with no fetch, timer, or environment dependencies.
 */

/**
 * Whether the current 1-based attempt is the last allowed attempt.
 *
 * @param attempt - 1-based attempt index
 * @param retries - Maximum number of attempts, including the first
 * @returns `true` when no further attempt should be scheduled
 */
export const isLastAttempt = (attempt: number, retries: number): boolean => {
  return attempt === retries;
};
