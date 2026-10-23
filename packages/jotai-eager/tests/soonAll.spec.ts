import { eagerAtom, isEagerError, soonAll } from 'jotai-eager';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { deferred } from './mockUtils.ts';

describe('soonAll', () => {
  it('returns the same elements if all of them are concrete values', () => {
    const result = soonAll([1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);

    expectTypeOf(result).toEqualTypeOf<
      Promise<[number, number, number]> | [number, number, number]
    >();
  });

  it('returns the same elements if all of them are known', async () => {
    const store = createStore();
    const resolvedAtom = atom(Promise.resolve(2));
    const promise = store.get(resolvedAtom);

    const result1 = soonAll([1, promise, 3]);
    await expect(result1).resolves.toEqual([1, 2, 3]);

    const result2 = soonAll([1, promise, 3]);
    expect(result2).toEqual([1, 2, 3]);

    expectTypeOf(result1).toEqualTypeOf<
      Promise<[number, number, number]> | [number, number, number]
    >();
    expectTypeOf(result2).toEqualTypeOf<
      Promise<[number, number, number]> | [number, number, number]
    >();
  });

  it('has the correct type for possible unknown values', () => {
    const maybePromise = 123 as Promise<number> | number;
    const result = soonAll([1, maybePromise, 3]);

    expectTypeOf(result).toEqualTypeOf<
      Promise<[number, number, number]> | [number, number, number]
    >();
  });

  it('falls back to Promise.all functionality', async () => {
    const one = Promise.resolve(1);
    const two = Promise.resolve(2);
    const three = Promise.resolve(3);
    const promise = soonAll([one, two, three]);
    expect(promise).toBeInstanceOf(Promise);
    expect(await promise).toEqual([1, 2, 3]);
  });

  it('returns a rejected promise if any of the elements are rejected promises', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    const result = soonAll([1, Promise.reject<number>({ error: 'test' }), 2]);

    await expect(result).rejects.toEqual({ error: 'test' });
  });

  it('remembers rejections, so that other jotai-eager APIs can handle them synchronously', async () => {
    const store = createStore();
    const error = new Error('');
    const pendingTask = deferred<number>();
    const failingTask = deferred<number>();

    const result = soonAll([pendingTask.promise, failingTask.promise]);
    failingTask.reject(error);
    await expect(result).rejects.toThrowError(error);

    const safeAtom = eagerAtom((get) => {
      try {
        return get.await(failingTask.promise);
      } catch (e) {
        if (isEagerError(e)) {
          throw e;
        }
        return 'fallback';
      }
    });
    expect(store.get(safeAtom)).toEqual('fallback');
  });

  it('handles an array as input', () => {
    const array = [1, 2, 3].map((x) => x * 2);
    const result = soonAll(array);
    expectTypeOf(array).toEqualTypeOf<number[]>();
    expectTypeOf(result).toEqualTypeOf<number[] | Promise<number[]>>();
  });

  it('handles an empty tuple as input', () => {
    const result = soonAll([]);
    expectTypeOf(result).toEqualTypeOf<[] | Promise<[]>>();
  });
});
