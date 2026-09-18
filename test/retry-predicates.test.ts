import { isLastAttempt } from '../src/core/retry-predicates';

describe('isLastAttempt', () => {
  it.each([
    ['first of one', 1, 1, true],
    ['first of two', 1, 2, false],
    ['second of two', 2, 2, true],
    ['middle of five', 3, 5, false],
    ['last of five', 5, 5, true],
  ])('%s: isLastAttempt(%i, %i) is %s', (_label, attempt, retries, expected) => {
    expect(isLastAttempt(attempt, retries)).toBe(expected);
  });
});
