import { describe, expect, it } from 'vitest';
import { atom, createStore } from 'jotai/vanilla';
import { loadable } from 'jotai-eager';

describe('loadable', () => {
  it('returns the same loadable atom for the same atom', () => {
    const asyncAtom = atom(Promise.resolve('concrete'));

    expect(loadable(asyncAtom)).toBe(loadable(asyncAtom));
    expect(loadable(asyncAtom)).not.toBe(loadable(atom(Promise.resolve('concrete'))));
  });

  it('should return fulfilled value of an already resolved async atom', async () => {
    const store = createStore();
    const asyncAtom = atom(Promise.resolve('concrete'));

    expect(await store.get(asyncAtom)).toEqual('concrete');
    expect(store.get(loadable(asyncAtom))).toEqual({
      state: 'loading',
    });
    await Promise.resolve(); // wait for a tick
    expect(store.get(loadable(asyncAtom))).toEqual({
      state: 'hasData',
      data: 'concrete',
    });
  });

  it('should get the latest loadable state after the promise resolves', async () => {
    const store = createStore();
    const asyncAtom = atom(Promise.resolve());
    const loadableAtom = loadable(asyncAtom);

    expect(store.get(loadableAtom)).toHaveProperty('state', 'loading');

    await store.get(asyncAtom);

    expect(store.get(loadableAtom)).toHaveProperty('state', 'hasData');
  });

  it('notifies subscribers once the promise settles', async () => {
    const store = createStore();
    const asyncAtom = atom(new Promise<number>((resolve) => setTimeout(() => resolve(7), 10)));
    const loadableAtom = loadable(asyncAtom);
    const values: unknown[] = [];

    store.sub(loadableAtom, () => values.push(store.get(loadableAtom)));
    expect(store.get(loadableAtom)).toEqual({ state: 'loading' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(values).toEqual([{ state: 'hasData', data: 7 }]);
  });

  it('recovers from an error once the atom has a value again', () => {
    const store = createStore();
    const countAtom = atom(1);
    const throwingAtom = atom((get) => {
      const count = get(countAtom);
      if (count === 1) {
        throw new Error('sync boom');
      }
      return count;
    });
    const loadableAtom = loadable(throwingAtom);

    expect(store.get(loadableAtom)).toHaveProperty('state', 'hasError');
    store.set(countAtom, 2);
    expect(store.get(loadableAtom)).toEqual({ state: 'hasData', data: 2 });
  });
});
