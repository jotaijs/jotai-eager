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
 * @deprecated In favor of the eagerAtom() API.
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
