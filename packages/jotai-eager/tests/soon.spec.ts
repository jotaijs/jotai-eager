import { soon } from 'jotai-eager';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { deferred } from './mockUtils.ts';

describe('soon', () => {
  it('correctly infers type when used data-first', () => {
    const promiseOrValue = 654 as Promise<number> | number;

    const wrapped = soon(promiseOrValue, (value) => ({
      inside: value,
    }));

    expect(wrapped).toEqual({ inside: 654 });

    expectTypeOf(wrapped).toEqualTypeOf<{ inside: number } | Promise<{ inside: number }>>();
  });

  it('processes sync and async data as soon as possible', async () => {
    const multiply = ([a, b]: readonly [number, number]) => a * b;

    const syncResult = soon([12, 5] as const, multiply);
    const asyncResult = soon(Promise.resolve([10, 8] as const), multiply);

    expect(syncResult).toEqual(60);
    expect(asyncResult).toBeInstanceOf(Promise);
    expect(await asyncResult).toEqual(80);

    // Even though the processing is sync, it could throw, which we make into a rejected
    // promise for consistency.
    expectTypeOf(syncResult).toEqualTypeOf<number | Promise<number>>();
    // Even though we are processing a promise, it may already be fulfilled
    // (and we can know with jōtai instrumentation), so safest to assume
    // the function can return either.
    expectTypeOf(asyncResult).toEqualTypeOf<number | Promise<number>>();
  });

  it('chains correctly', async () => {
    const double = (value: number) => value * 2;
    const doubleAsync = (value: number) => Promise.resolve(value * 2);

    const asyncEnd = soon(soon(3, double), doubleAsync);
    const asyncMiddle = soon(soon(3, doubleAsync), double);
    const asyncStart = soon(soon(Promise.resolve(3), double), double);

    await expect(asyncEnd).resolves.toEqual(12);
    await expect(asyncMiddle).resolves.toEqual(12);
    await expect(asyncStart).resolves.toEqual(12);
  });

  it('returns rejected promise even if processing sync', async () => {
    const throwError = (_input: number): number => {
      // eslint-disable-next-line no-throw-literal
      throw { error: 'test' };
    };

    const result = soon(123, throwError);

    await expect(result).rejects.toEqual({ error: 'test' });
  });
});

describe('soon (in atoms)', () => {
  it('properly derives an async atom', async () => {
    const store = createStore();

    const initialCount = deferred<number>();
    const countAtom = atom<Promise<number> | number>(initialCount.promise);

    let numberOfCalculations = 0;

    const doubledAtom = atom((get) =>
      soon(get(countAtom), (value) => {
        numberOfCalculations += 1;
        return value * 2;
      }),
    );

    // Interacting just with `doubledAtom`, never with `countAtom` directly.
    const promise = store.get(doubledAtom);
    expect(promise).toBeInstanceOf(Promise);

    initialCount.resolve(11);

    expect(store.get(doubledAtom)).toEqual(promise); // should still hold the same promise
    expect(await promise).toEqual(22);
    expect(numberOfCalculations).toEqual(1);
  });

  it('handles a resolved promise instantly the second time around', async () => {
    const store = createStore();
    const aAtom = atom<Promise<number> | number>(Promise.resolve(4));
    const bAtom = atom<number>(2);

    let numberOfCalculations = 0;

    const productAtom = atom((get) =>
      soon(get(aAtom), (value) => {
        numberOfCalculations += 1;
        return value * get(bAtom);
      }),
    );

    const first = store.get(productAtom);
    expect(first).toBeInstanceOf(Promise);
    await expect(first).resolves.toEqual(8);

    // Second time we are calculating the value of `productAtom`
    store.set(bAtom, 3);
    expect(store.get(productAtom)).toEqual(12); // should just equal a concrete value
    expect(numberOfCalculations).toEqual(2);
  });

  it('recalculates only when dependencies change', async () => {
    const store = createStore();

    const initialTask = deferred<number>();
    const baseAtom = atom<Promise<number> | number>(initialTask.promise);

    let numberOfCalculations = 0;

    const flooredAtom = atom((get) => soon(get(baseAtom), (value) => Math.floor(value)));

    const messageAtom = atom((get) =>
      soon(get(flooredAtom), (value) => {
        numberOfCalculations += 1;
        return `around ${value}`;
      }),
    );

    const messagePromise = store.get(messageAtom);
    expect(messagePromise).toBeInstanceOf(Promise);

    initialTask.resolve(1.2);

    expect(await messagePromise).toEqual('around 1');
    expect(numberOfCalculations).toBe(1);

    store.set(baseAtom, 5.5);
    expect(store.get(messageAtom)).toEqual('around 5');
    expect(numberOfCalculations).toBe(2);

    store.set(baseAtom, 5.2); // changing value, but `flooredAtom` should still resolve to 5
    expect(numberOfCalculations).toBe(2); // no recalculations for `messageAtom`
  });
});
