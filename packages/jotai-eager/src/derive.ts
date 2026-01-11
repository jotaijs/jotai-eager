import { type Atom, type ExtractAtomValue, atom } from 'jotai/vanilla';

import { soon } from './soon.ts';
import { soonAll } from './soonAll.ts';

type PromiseOrValue<T> = T | Promise<T>;

type ExtractAtomsValues<TAtoms extends readonly [Atom<unknown>, ...Atom<unknown>[]]> = {
  [Index in keyof TAtoms]: ExtractAtomValue<TAtoms[Index]>;
};

type AwaitAtomsValues<TTuple extends readonly [Atom<unknown>, ...Atom<unknown>[]]> = {
  [Index in keyof TTuple]: Awaited<ExtractAtomValue<TTuple[Index]>>;
};

/**
 * Awaits all `deps` if necessary, then runs `op` given all deps in the same order.
 * If computing the value fails (throws), a rejected Promise is returned no matter if
 * the processing happened synchronously or not.
 *
 * @param deps An array of atoms whose values will be awaited and passed to the operation function.
 * @param op A function that takes the awaited values of the dependencies and returns a new value. It is called synchronously if all dependencies are fulfilled, otherwise asynchronously.
 * @returns An atom that resolves to the result of the operation or a promise of the result if dependencies are pending.
 * @deprecated Use `eagerAtom` for new code, as it provides a better developer experience, and matches more closely to how regualr atoms are defined.
 *
 * @example
 * ```ts
 * import { atom } from 'jotai';
 * import { derive } from 'jotai-eager';
 *
 * const aAtom = atom(async () => 1);
 * const bAtom = atom(async () => 2);
 * const sumAtom = derive([aAtom, bAtom], (a, b) => a + b);
 * ```
 */
export function derive<TDeps extends readonly [Atom<unknown>, ...Atom<unknown>[]], TValue>(
  deps: TDeps,
  op: (...depValues: AwaitAtomsValues<TDeps>) => TValue,
): Atom<TValue | Promise<Awaited<TValue>>> {
  return atom((get) => {
    try {
      return soon(
        soonAll(deps.map(get) as ExtractAtomsValues<TDeps>) as PromiseOrValue<
          AwaitAtomsValues<TDeps>
        >,
        (values) => op(...values),
      ) as TValue | Promise<Awaited<TValue>>;
    } catch (err) {
      return Promise.reject(err);
    }
  });
}
