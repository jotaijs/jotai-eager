import type { Atom } from 'jotai/vanilla';
import { eagerAtom, isEagerError } from 'jotai-eager';
import { atom, createStore } from 'jotai/vanilla';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { deferred } from './mockUtils.ts';
import type { AwaitedAll } from '../src/eagerAtom.ts';

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
  });
});
