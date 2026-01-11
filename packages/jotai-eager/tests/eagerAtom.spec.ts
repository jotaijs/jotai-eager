import type { Atom } from 'jotai/vanilla';
import { eagerAtom, isEagerError } from 'jotai-eager';
import { atom, createStore } from 'jotai/vanilla';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
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
    const invalidAtom = atom<Promise<number>>(async () => {
      'foo';
      throw error;
    });
    const doubledAtom = eagerAtom((get) => get(invalidAtom) * 2);

    await expect(store.get(doubledAtom)).rejects.toThrowError(error);
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
				  "suspended",
				  "suspended",
				]
			`);
    });
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

  describe('get.await', () => {
    it('awaits a regular Promise', () => {
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

      expect(store.get(statusAtom)).resolves.toEqual('success');
    });
  });
});
