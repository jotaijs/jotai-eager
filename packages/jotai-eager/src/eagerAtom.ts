import { atom } from 'jotai/vanilla';
import type { Atom, WritableAtom, Getter, Setter } from 'jotai/vanilla';
import { getPromiseMeta, setPromiseMeta } from './isPromise.ts';

export type AwaitedAll<T extends readonly unknown[]> = {
  [K in keyof T]: Awaited<T[K] extends Atom<infer Value> ? Value : T[K]>;
};

interface EagerGetter {
  /**
   * Retrieves the atom's fulfilled value.
   * If the value is not yet available, it interrupts the execution
   * of the eager atom until it's available.
   */
  <Value>(atom: Atom<Value>): Awaited<Value>;
  /**
   * Retrieves the Promise's fulfilled value.
   * If the value is not yet available, it interrupts the execution
   * of the eager atom until it's available.
   */
  await<T>(promiseOrValue: T): Awaited<T>;
  /**
   * Retrieves the fulfilled value of all passed in Promises.
   * If the values are not yet available, it interrupts the execution
   * of the eager atom until they're available.
   */
  awaitAll<T extends readonly unknown[]>(args: T): AwaitedAll<T>;
  /**
   * Retrieves the fulfilled value of all passed in atoms.
   * If the values are not yet available, it interrupts the execution
   * of the eager atom until they're available.
   */
  all<T extends readonly Atom<unknown>[]>(atoms: T): AwaitedAll<T>;
}

type Read<Value> = (get: EagerGetter) => Value;

type Write<Args extends unknown[], Result> = (get: Getter, set: Setter, ...args: Args) => Result;

const NotYet = Symbol(
  '(jotai-eager) Not all dependencies were fulfilled. Are you a dev? Call `isEagerError(e)` to detect this thrown value and rethrow it, as its handled by the library.',
);

interface EagerError {
  [NotYet]: Promise<unknown>;
}

function unwrapPromise<T>(promise: T): Awaited<T> {
  const meta = getPromiseMeta(promise);

  if (!meta) {
    // Not a promise
    return promise as Awaited<T>;
  }

  if (meta.status === 'pending') {
    throw { [NotYet]: promise as Promise<unknown> } satisfies EagerError;
  }

  if (meta.status === 'rejected') {
    throw meta.reason;
  }

  return meta.value as Awaited<T>; // Fulfilled
}

function resolveSuspension<T>(compute: () => T, signal: AbortSignal): T | Promise<T> {
  try {
    return compute();
  } catch (e) {
    const suspended = (e as EagerError | { [NotYet]?: undefined })[NotYet];
    if (suspended) {
      return suspended.then(
        (value) => {
          setPromiseMeta(suspended, { status: 'fulfilled', value });
          if (signal.aborted) {
            return undefined as T;
          }
          return resolveSuspension(compute, signal);
        },
        (reason) => {
          if (signal.aborted) {
            return undefined as T;
          }
          setPromiseMeta(suspended, { status: 'rejected', reason });
          throw reason;
        },
      );
    }
    // Rejecting other errors
    return Promise.reject(e);
  }
}

type AsyncReadFunctionError =
  'ERROR: The `read` function of eager atoms cannot be asynchronous, or return a Promise.';

/**
 * A drop-in replacement for vanilla atoms wih custom async read functions, that
 * removes unnecessary suspensions. The read function is written as if it was
 * synchronous, which allows for:
 * - eager computation of the atom's value in case all of its dependencies are fulfilled
 *   (which is not the case for vanilla async atoms).
 * - interrupting computation if a dependency is not yet fulfilled.
 *
 * @param args A sync read function that can read async atoms directly using the `get` parameter.
 * @returns An eager atom
 */
// writable atom
export function eagerAtom<Value, Args extends unknown[], Result>(
  // NOTE: Wrapping in [] to avoid spreading the operation over union elements
  ...args: [Value] extends [PromiseLike<unknown>]
    ? [AsyncReadFunctionError]
    : [read: Read<Value>, write: Write<Args, Result>]
): WritableAtom<Promise<Value> | Value, Args, Result>;

// read-only atom
export function eagerAtom<Value>(
  // NOTE: Wrapping in [] to avoid spreading the operation over union elements
  ...args: [Value] extends [PromiseLike<unknown>] ? [AsyncReadFunctionError] : [read: Read<Value>]
): Atom<Promise<Value> | Value>;

export function eagerAtom<Value, Args extends unknown[], Result>(
  // NOTE: Wrapping in [] to avoid spreading the operation over union elements
  ...args: [Value] extends [PromiseLike<unknown>]
    ? [AsyncReadFunctionError]
    : [read: Read<Value>, write?: Write<Args, Result>]
): WritableAtom<Promise<Value> | Value, Args, Result> {
  const [read, write] = args as [read: Read<Value>, write?: Write<Args, Result>];

  return atom(
    (get, { signal }) => {
      const eagerGet = (<Value>(atomToGet: Atom<Value>): Awaited<Value> =>
        unwrapPromise(get(atomToGet))) as EagerGetter;

      eagerGet.all = <T extends readonly Atom<unknown>[]>(atoms: T) =>
        atoms
          // Jump-starting every asynchronous atom.
          .map((a) => get(a))
          // Unwrapping them one by one, sequentially.
          .map((v) => unwrapPromise(v)) as AwaitedAll<T>;

      eagerGet.await = <T>(promiseOrValue: T) => unwrapPromise(promiseOrValue);
      eagerGet.awaitAll = <T extends readonly unknown[]>(values: T) =>
        values.map((v) => unwrapPromise(v)) as AwaitedAll<T>;

      return resolveSuspension(() => read(eagerGet), signal);
    },
    write ?? (() => undefined as unknown as Result),
  );
}

/**
 * Only useful if the eager atom's read function involves a try {} catch {}. Can be used to
 * detect whether a thrown value originates from `jotai-eager`, in which case should be rethrown.
 * @returns True if `error` is a suspension trigger originating from `jotai-eager`.
 */
export function isEagerError(error: unknown): boolean {
  return !!(error as EagerError)?.[NotYet];
}
