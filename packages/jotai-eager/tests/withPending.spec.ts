import { atom, createStore } from 'jotai/vanilla';
import { beforeEach, describe, expect, it } from 'vitest';
import { withPending } from 'jotai-eager';

describe('withPending', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  it('falls back to `undefined` by default', async () => {
    const fooAtom = atom(Promise.resolve(123));
    const fooOrPendingAtom = withPending(fooAtom);

    const v1 = store.get(fooOrPendingAtom);
    expect(v1).toEqual(undefined);

    await Promise.resolve(); // wait micro-tick

    const v2 = store.get(fooOrPendingAtom);
    expect(v2).toEqual(123);
  });

  it('falls back to static pending value', async () => {
    const fooAtom = atom(Promise.resolve(123));
    const fooOrPendingAtom = withPending(fooAtom, () => 'Loading...' as const);

    const v1 = store.get(fooOrPendingAtom);
    expect(v1).toEqual('Loading...');

    await Promise.resolve(); // wait micro-tick

    const v2 = store.get(fooOrPendingAtom);
    expect(v2).toEqual(123);
  });

  it('falls back to previous value', async () => {
    const fooAtom = atom(Promise.resolve(123));
    const fooOrPendingAtom = withPending(fooAtom, ({ prev }) => prev ?? 0);

    expect(store.get(fooOrPendingAtom)).toEqual(0 /* the default pending value */);
    await Promise.resolve(); // wait micro-tick
    expect(store.get(fooOrPendingAtom)).toEqual(123);

    // New Promise value
    store.set(fooAtom, Promise.resolve(321));
    expect(store.get(fooOrPendingAtom)).toEqual(123 /* prev result */);
    await Promise.resolve(); // wait micro-tick
    expect(store.get(fooOrPendingAtom)).toEqual(321);
  });

  it('falls back to previous value', async () => {
    const fooAtom = atom(Promise.resolve(123));
    const fooOrPendingAtom = withPending(fooAtom, ({ prev }) => prev ?? 0);

    expect(store.get(fooOrPendingAtom)).toEqual(0 /* the default pending value */);
    await Promise.resolve(); // wait micro-tick
    expect(store.get(fooOrPendingAtom)).toEqual(123);

    // New Promise value
    store.set(fooAtom, Promise.resolve(321));
    expect(store.get(fooOrPendingAtom)).toEqual(123 /* prev result */);
    await Promise.resolve(); // wait micro-tick
    expect(store.get(fooOrPendingAtom)).toEqual(321);
  });

  it('falls back to the value of another atom', async () => {
    const fooAtom = atom(Promise.resolve(123));
    const fallbackAtom = atom('Loading...');
    const fooOrPendingAtom = withPending(fooAtom, ({ get }) => get(fallbackAtom));

    expect(store.get(fooOrPendingAtom)).toEqual('Loading...');
    store.set(fallbackAtom, 'Not ready yet');
    expect(store.get(fooOrPendingAtom)).toEqual('Not ready yet');

    await Promise.resolve(); // wait micro-tick

    expect(store.get(fooOrPendingAtom)).toEqual(123);
  });

  it('should unwrap a sync atom which is noop', async () => {
    const countAtom = atom(1);
    const syncAtom = withPending(countAtom);
    expect(store.get(syncAtom)).toBe(1);
    store.set(countAtom, 2);
    expect(store.get(syncAtom)).toBe(2);
    store.set(countAtom, 3);
    expect(store.get(syncAtom)).toBe(3);
  });

  it('should unwrap an async writable atom', async () => {
    const store = createStore();
    const asyncAtom = atom(Promise.resolve(1));
    const syncAtom = withPending(asyncAtom, ({ prev }) => prev ?? 0);

    expect(store.get(syncAtom)).toBe(0);
    await new Promise((r) => setTimeout(r)); // wait for a tick
    expect(store.get(syncAtom)).toBe(1);

    store.set(syncAtom, Promise.resolve(2));
    expect(store.get(syncAtom)).toBe(1);
    await new Promise((r) => setTimeout(r)); // wait for a tick
    expect(store.get(syncAtom)).toBe(2);

    store.set(syncAtom, Promise.resolve(3));
    expect(store.get(syncAtom)).toBe(2);
    await new Promise((r) => setTimeout(r)); // wait for a tick
    expect(store.get(syncAtom)).toBe(3);
  });

  it('should unwrap to a fulfilled value of an already resolved async atom', async () => {
    const asyncAtom = atom(Promise.resolve('concrete'));
    const syncAtom = withPending(asyncAtom);

    expect(await store.get(asyncAtom)).toEqual('concrete');
    expect(store.get(syncAtom)).toEqual(undefined);
    await new Promise((r) => setTimeout(r)); // wait for a tick
    expect(store.get(syncAtom)).toEqual('concrete');
  });

  it('should get a fulfilled value after the promise resolves', async () => {
    const asyncAtom = atom(Promise.resolve('concrete'));
    const syncAtom = withPending(asyncAtom);

    expect(store.get(syncAtom)).toEqual(undefined);

    await store.get(asyncAtom);

    expect(store.get(syncAtom)).toEqual('concrete');
  });

  it('should update dependents with the value of the unwrapped atom when the promise resolves', async () => {
    const asyncTarget = atom(() => Promise.resolve('value'));
    const target = withPending(asyncTarget);
    const results: string[] = [];
    const derived = atom(async (get) => {
      await Promise.resolve();
      results.push(`effect ${get(target)}`);
    });
    store.sub(derived, () => {});
    await new Promise((r) => setTimeout(r));
    expect(results).toEqual(['effect undefined', 'effect value']);
  });
});
