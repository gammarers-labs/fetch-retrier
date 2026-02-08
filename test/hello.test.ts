import { fetchRetrier } from '../src';

test('fetchRetrier', async () => {
  expect(await fetchRetrier('https://api.github.com')).toBeDefined();
});