import type { Atom } from 'jotai/vanilla';
import { eagerAtom, isEagerError, loadable } from 'jotai-eager';
import type { EagerError } from 'jotai-eager';
import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { deferred } from './mockUtils.ts';
import type { AwaitedAll, AwaitedValues } from '../src/eagerAtom.ts';

describe('AwaitedAll<T>', () => {
  it('resolves a tuple of atoms to a tuple of their awaited values', () => {
    expectTypeOf<AwaitedAll<[Atom<1>, Atom<Promise<2>>]>>().toEqualTypeOf<[1, 2]>();
    expectTypeOf<AwaitedAll<[Atom<Promise<1>>, Atom<2>, Atom<3>]>>().toEqualTypeOf<[1, 2, 3]>();
    expectTypeOf<AwaitedAll<(Atom<Promise<1>> | Atom<2>)[]>>().toEqualTypeOf<(1 | 2)[]>();
  });

  it('resolves a tuple of Promises to their awaited values', () => {
    expectTypeOf<AwaitedAll<[1, Promise<2>]>>().toEqualTypeOf<[1, 2]>();
  });
});

describe('AwaitedValues<T>', () => {
  it('resolves a tuple of Promises to their awaited values', () => {
    expectTypeOf<AwaitedValues<[1, Promise<2>]>>().toEqualTypeOf<[1, 2]>();
  });

  it('leaves atoms as they are', () => {
    expectTypeOf<AwaitedValues<[Atom<1>, Promise<2>]>>().toEqualTypeOf<[Atom<1>, 2]>();
  });
});

describe('eagerAtom', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('can be writable', () => {
    const countAtom = atom(1);
    const doubledAtom = eagerAtom(
      (get) => get(countAtom) * 2,
      (_get, set, count: number) => {
        set(countAtom, count / 2);
      },
    );

    expect(store.get(doubledAtom)).toEqual(2);
    store.set(doubledAtom, 3);
    expect(store.get(doubledAtom)).toEqual(3);
    expect(store.get(countAtom)).toEqual(1.5);
  });

  it('only creates an AbortController when suspending', async () => {
    const OriginalAbortController = globalThis.AbortController;
    let created = 0;
    globalThis.AbortController = class extends OriginalAbortController {
      constructor() {
        super();
        created++;
      }
    };

    try {
      const countAtom = atom(1);
      const syncAtom = eagerAtom((get) => get(countAtom) * 2);
      expect(store.get(syncAtom)).toEqual(2);
      expect(created).toEqual(0);

      const task = deferred<number>();
      const pendingAtom = atom(task.promise);
      const asyncAtom = eagerAtom((get) => get(pendingAtom) * 2);
      const result = store.get(asyncAtom);
      expect(created).toEqual(1);

      task.resolve(2);
      await expect(result).resolves.toEqual(4);
    } finally {
      globalThis.AbortController = OriginalAbortController;
    }
  });

  it('is not writable if no write function is given', () => {
    const doubledAtom = eagerAtom(() => 2);

    expect(() => store.set(doubledAtom as never)).toThrow();
  });

  it('derives a sync atom', () => {
    const countAtom = atom(12);
    const doubledAtom = eagerAtom((get) => get(countAtom) * 2);

    expect(store.get(doubledAtom)).toEqual(24);
    // the processing is sync, but it could still throw, which would return a rejected promise.
    expectTypeOf(doubledAtom).toEqualTypeOf<Atom<number | Promise<number>>>();
  });

  it('returns a rejected promise on sync dependency throw', async () => {
    const error = new Error('');
    const invalidAtom = atom<number>(() => {
      throw error;
    });
    const doubledAtom = eagerAtom((get) => get(invalidAtom) * 2);

    await expect(store.get(doubledAtom)).rejects.toThrowError(error);
  });

  it('lets dependents handle a sync throw without suspending', () => {
    const error = new Error('sync boom');
    const invalidAtom = eagerAtom((): number => {
      throw error;
    });
    const dependentAtom = eagerAtom((get) => {
      try {
        return get(invalidAtom);
      } catch (e) {
        if (isEagerError(e)) {
          throw e;
        }
        return e;
      }
    });

    expect(store.get(dependentAtom)).toBe(error);
    expect(store.get(loadable(invalidAtom))).toEqual({ state: 'hasError', error });
  });

  it('returns a rejected promise on async dependency throw', async () => {
    const error = new Error('');
    const invalidAtom = atom(
      new Promise<number>((_resolve, reject) => {
        setTimeout(() => reject(error), 1000);
      }),
    );

    const doubledAtom = eagerAtom((get) => get(invalidAtom) * 2);
    const value = store.get(doubledAtom);

    vi.runAllTimers();

    await expect(value).rejects.toThrowError(error);
  });

  it('lets the read function catch an async dependency rejection', async () => {
    const error = new Error('');
    const dataTask = deferred<number>();
    const dataAtom = atom(dataTask.promise);
    const createSafeAtom = () =>
      eagerAtom((get) => {
        try {
          return get(dataAtom);
        } catch (e) {
          if (isEagerError(e)) {
            throw e;
          }
          return 'fallback';
        }
      });
    const safeAtom = createSafeAtom();

    const value = store.get(safeAtom);
    expect(value).toBeInstanceOf(Promise);

    dataTask.reject(error);

    await expect(value).resolves.toEqual('fallback');
    // Matches the behavior once the rejection is already known
    expect(store.get(createSafeAtom())).toEqual('fallback');
  });

  it('returns a rejected promise when the read function throws a nullish value', async () => {
    const nullAtom = eagerAtom<number>(() => {
      throw null;
    });

    await expect(store.get(nullAtom)).rejects.toBe(null);
  });

  it('returns a rejected promise when a known dependency rejects with `undefined`', async () => {
    const invalidAtom = atom(Promise.reject(undefined));
    const valueAtom = eagerAtom<number>((get) => get(invalidAtom));

    // the first read caches the rejection
    await expect(store.get(valueAtom)).rejects.toBe(undefined);

    const anotherValueAtom = eagerAtom<number>((get) => get(invalidAtom));
    await expect(store.get(anotherValueAtom)).rejects.toBe(undefined);
  });

  it('rejects with `undefined` when an async dependency is fulfilled, and the read function throws `undefined`', async () => {
    const dataTask = deferred<number>();
    const dataAtom = atom(dataTask.promise);
    const valueAtom = eagerAtom<number>((get) => {
      get(dataAtom);
      throw undefined;
    });

    const value = store.get(valueAtom);
    dataTask.resolve(1);

    await expect(value).rejects.toBe(undefined);
  });

  it('derives an async atom', async () => {
    const computation = deferred<number>();
    const countAtom = atom(computation.promise);
    const doubledAtom = eagerAtom((get) => get(countAtom) * 2);

    const doubled = store.get(doubledAtom);

    expect(doubled).toBeInstanceOf(Promise);

    computation.resolve(12);

    await expect(doubled).resolves.toEqual(24);

    expectTypeOf(doubledAtom).toEqualTypeOf<Atom<number | Promise<number>>>();
  });

  it('derives a couple of sync atoms', () => {
    const aAtom = atom(3);
    const bAtom = atom(5);
    const productAtom = eagerAtom((get) => get(aAtom) * get(bAtom));

    expect(store.get(productAtom)).toEqual(15);
  });

  it('derives a couple of async atoms', async () => {
    const aTask = deferred<number>();
    const bTask = deferred<number>();
    const aAtom = atom(aTask.promise);
    const bAtom = atom(bTask.promise);
    const productAtom = eagerAtom((get) => get(aAtom) * get(bAtom));

    const product = store.get(productAtom);

    expect(product).toBeInstanceOf(Promise);

    aTask.resolve(3);
    bTask.resolve(5);

    await expect(product).resolves.toBe(15);
  });

  it('computes synchronously if asynchronous dependencies are fulfilled', async () => {
    const petsAtom = atom(async () => {
      return ['dog', 'cat', 'meerkat', 'parrot', 'mouse'];
    });
    const filterAtom = atom('');
    const filteredPetsAtom = eagerAtom((get) => {
      const filter = get(filterAtom);
      return get(petsAtom).filter((name) => name.includes(filter));
    });

    const unfilteredPets = store.get(filteredPetsAtom);
    expect(unfilteredPets).toBeInstanceOf(Promise);

    await expect(unfilteredPets).resolves.toMatchInlineSnapshot(`
			[
			  "dog",
			  "cat",
			  "meerkat",
			  "parrot",
			  "mouse",
			]
		`);

    store.set(filterAtom, 'at');

    const atPets = store.get(filteredPetsAtom);
    expect(atPets).toMatchInlineSnapshot(`
			[
			  "cat",
			  "meerkat",
			]
		`);
  });

  it('computes a chain of eager atoms synchronously on a sync dependency change', async () => {
    const labelAtom = atom(Promise.resolve('John'));
    const counterAtom = atom(0);
    const prefixedAtom = eagerAtom((get) => `${get(labelAtom)}:${get(counterAtom)}`);
    const fixedAtom = eagerAtom((get) => `${get(prefixedAtom)}:${get(labelAtom)}`);

    await expect(store.get(prefixedAtom)).resolves.toMatchInlineSnapshot(`"John:0"`);
    store.set(counterAtom, 1);
    expect(store.get(fixedAtom)).toMatchInlineSnapshot(`"John:1:John"`);
  });

  it('returns promises that always resolve with the latest value, even when an aborted computes is resolved first', async () => {
    const aTask1 = deferred<number>();
    const aTask2 = deferred<number>();
    const aAtom = atom(aTask1.promise);
    const bAtom = eagerAtom((get) => get(aAtom));

    // the first read produces a pending promise p1
    const unsub = store.sub(bAtom, () => {});
    const p1 = store.get(bAtom);
    expect(p1).toBeInstanceOf(Promise);

    // replacing aAtom's promise invalidates bAtom (it IS a direct dependency)
    // and triggers a re-read, replacing p1 with p2 in the atom state
    // jotai calls abortPromise(p1) → s1.abort()
    store.set(aAtom, aTask2.promise);

    // resolve the original promise after s1 is already aborted
    aTask1.resolve(42);
    // resolve the new dependency
    aTask2.resolve(21);

    // The first promise resolves to the value of `aTask2`, instead of it's
    // initial `aTask1` dependency.
    await expect(p1).resolves.toBe(21);

    unsub();
  });

  it('returns promises that always resolve with the latest value, even when an aborted computation never resolves', async () => {
    const aTask1 = deferred<number>();
    const aTask2 = deferred<number>();
    const aAtom = atom(aTask1.promise);
    const bAtom = eagerAtom((get) => get(aAtom));

    // the first read produces a pending promise p1
    const unsub = store.sub(bAtom, () => {});
    const p1 = store.get(bAtom);
    expect(p1).toBeInstanceOf(Promise);

    // replacing aAtom's promise invalidates bAtom (it IS a direct dependency)
    // and triggers a re-read, replacing p1 with p2 in the atom state
    // jotai calls abortPromise(p1) → s1.abort()
    store.set(aAtom, aTask2.promise);

    // resolve ONLY the new dependency
    aTask2.resolve(21);

    // The first promise resolves to the value of `aTask2`, instead of it's
    // initial `aTask1` dependency.
    await expect(p1).resolves.toBe(21);

    unsub();
  });

  describe('get.all', () => {
    it('handles sync atoms as input', async () => {
      const nameAtom = atom('Bob');
      const levelAtom = atom(2);

      const labelAtom = eagerAtom((get) => {
        const [name, level] = get.all([nameAtom, levelAtom]);

        expectTypeOf(name).toEqualTypeOf<string>();
        expectTypeOf(level).toEqualTypeOf<number>();

        return `${name} (lvl ${level})`;
      });

      expect(store.get(labelAtom)).toMatchInlineSnapshot(`"Bob (lvl 2)"`);
    });

    it('jump-starts all async atoms before suspending', async () => {
      const events: string[] = [];
      const oneAtom = atom(async () => {
        events.push('"one" computed');
        return 1;
      });
      const twoAtom = atom(async () => {
        events.push('"two" computed');
        return 2;
      });
      const threeAtom = atom(async () => {
        events.push('"three" computed');
        return 3;
      });

      const sumAtom = eagerAtom((get) => {
        try {
          const [one, two, three] = get.all([oneAtom, twoAtom, threeAtom]);
          return one + two + three;
        } catch (e) {
          if (isEagerError(e)) {
            events.push('suspended');
          }
          throw e;
        }
      });

      await expect(store.get(sumAtom)).resolves.toEqual(6);
      expect(events).toMatchInlineSnapshot(`
				[
				  ""one" computed",
				  ""two" computed",
				  ""three" computed",
				  "suspended",
				]
			`);
    });

    it('jump-starts all async atoms even if one throws synchronously', async () => {
      const error = new Error('sync boom');
      const events: string[] = [];
      const throwingAtom = atom((): number => {
        throw error;
      });
      const twoAtom = atom(async () => {
        events.push('"two" computed');
        return 2;
      });

      const sumAtom = eagerAtom((get) => {
        const [one, two] = get.all([throwingAtom, twoAtom]);
        return one + two;
      });

      await expect(store.get(sumAtom)).rejects.toBe(error);
      expect(events).toEqual(['"two" computed']);
    });

    it('depends on all atoms even if one throws synchronously', async () => {
      const shouldThrowAtom = atom(true);
      const throwingAtom = atom((get) => {
        if (get(shouldThrowAtom)) {
          throw new Error('sync boom');
        }
        return 1;
      });
      const countAtom = atom(2);

      const sumAtom = eagerAtom((get) => {
        const [one, count] = get.all([throwingAtom, countAtom]);
        return one + count;
      });

      const values: unknown[] = [];
      const unsub = store.sub(sumAtom, () => values.push(store.get(sumAtom)));
      await expect(store.get(sumAtom)).rejects.toThrow('sync boom');

      // Changing an atom after the throwing one still recomputes the eager atom.
      store.set(countAtom, 3);
      expect(values).toHaveLength(1);
      await expect(values[0]).rejects.toThrow('sync boom');

      store.set(shouldThrowAtom, false);
      expect(store.get(sumAtom)).toEqual(4);
      unsub();
    });

    it('waits for all pending atoms at once, instead of one by one', async () => {
      const aTask = deferred<number>();
      const bTask = deferred<number>();
      const cTask = deferred<number>();
      const aAtom = atom(aTask.promise);
      const bAtom = atom(bTask.promise);
      const cAtom = atom(cTask.promise);
      let computations = 0;

      const sumAtom = eagerAtom((get) => {
        computations++;
        const [a, b, c] = get.all([aAtom, bAtom, cAtom]);
        return a + b + c;
      });

      const sum = store.get(sumAtom);
      cTask.resolve(3);
      bTask.resolve(2);
      aTask.resolve(1);

      await expect(sum).resolves.toEqual(6);
      expect(computations).toEqual(2);
    });

    it('rejects as soon as any pending atom rejects', async () => {
      const error = new Error('');
      const slowTask = deferred<number>();
      const failingTask = deferred<number>();
      const slowAtom = atom(slowTask.promise);
      const failingAtom = atom(failingTask.promise);

      const sumAtom = eagerAtom((get) => {
        const [slow, failing] = get.all([slowAtom, failingAtom]);
        return slow + failing;
      });

      const sum = store.get(sumAtom);
      failingTask.reject(error);

      await expect(sum).rejects.toThrowError(error);
    });
  });

  describe('get.awaitAll', () => {
    it('waits for all pending promises at once, instead of one by one', async () => {
      const aTask = deferred<number>();
      const bTask = deferred<number>();
      const tasksAtom = atom({ a: aTask.promise, b: bTask.promise });
      let computations = 0;

      const sumAtom = eagerAtom((get) => {
        computations++;
        const { a, b } = get(tasksAtom);
        const [aValue, bValue] = get.awaitAll([a, b]);
        return aValue + bValue;
      });

      const sum = store.get(sumAtom);
      bTask.resolve(2);
      aTask.resolve(1);

      await expect(sum).resolves.toEqual(3);
      expect(computations).toEqual(2);
    });

    it('passes non-promise values through as they are, including atoms', () => {
      const innerAtom = atom(5);

      const valuesAtom = eagerAtom((get) => {
        const [inner, value] = get.awaitAll([innerAtom, 1] as const);
        expectTypeOf(inner).toEqualTypeOf<typeof innerAtom>();
        return [inner, value] as const;
      });

      expect(store.get(valuesAtom)).toEqual([innerAtom, 1]);
    });
  });

  describe('get.await', () => {
    it('awaits a regular Promise', async () => {
      const statusPromise = Promise.resolve<'success' | 'failure'>('success');
      const invoiceAtom = atom({
        getStatus() {
          return statusPromise;
        },
      });

      const statusAtom = eagerAtom((get) => {
        const invoice = get(invoiceAtom);
        return get.await(invoice.getStatus());
      });

      await expect(store.get(statusAtom)).resolves.toEqual('success');
    });

    it('rejects instead of retrying forever when awaiting a promise created inside of read', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const valueAtom = eagerAtom((get) => get.await(Promise.resolve(1)));
      const valuesAtom = eagerAtom((get) => get.awaitAll([Promise.resolve(1)]));

      await expect(store.get(valueAtom)).rejects.toThrow('keeps suspending on a new promise');
      await expect(store.get(valuesAtom)).rejects.toThrow('keeps suspending on a new promise');
      expect(warn).toHaveBeenCalledTimes(2); // once per atom
      warn.mockRestore();
    });

    it('does not mistake many sequential awaits for promises created inside of read', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const promises = Array.from({ length: 150 }, (_, i) => Promise.resolve(i));
      const sumAtom = eagerAtom((get) => promises.reduce((sum, p) => sum + get.await(p), 0));

      await expect(store.get(sumAtom)).resolves.toEqual((149 * 150) / 2);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});

describe('isEagerError', () => {
  it('detects suspensions, and narrows them to EagerError', () => {
    const task = deferred<number>();
    const pendingAtom = atom(task.promise);
    let caught: unknown = undefined;

    const store = createStore();
    store.get(
      eagerAtom((get) => {
        try {
          return get(pendingAtom);
        } catch (e) {
          caught = e;
          if (isEagerError(e)) {
            expectTypeOf(e).toEqualTypeOf<EagerError>();
          }
          throw e;
        }
      }),
    );

    expect(isEagerError(caught)).toBe(true);
    expect(isEagerError(new Error('not eager'))).toBe(false);
    expect(isEagerError(null)).toBe(false);
  });
});
