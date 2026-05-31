import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('resolving a promise twice', async () => {
  const promise = new Promise<number>((resolve) => {
    setTimeout(() => resolve(2), 1000);
    setTimeout(() => resolve(3), 2000);
  });

  const cb = vi.fn((a) => a);

  vi.runAllTimers();

  const result = await promise.then(cb);

  // More than one call to `resolve` does nothing
  expect(cb).toHaveBeenCalledTimes(1);
  expect(result).toEqual(2);
});
