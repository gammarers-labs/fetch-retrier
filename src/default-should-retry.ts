/**
 * Public entry for the default HTTP retry predicate.
 *
 * The implementation stays in core so retry execution can share it without a feature-to-feature import.
 */
export {
  DEFAULT_RETRYABLE_HTTP_STATUSES,
  defaultShouldRetry,
} from './core/policy/default-should-retry';
