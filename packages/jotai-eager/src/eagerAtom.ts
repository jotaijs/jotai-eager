import { atom } from 'jotai/vanilla';
import type { Atom, WritableAtom, Getter, Setter } from 'jotai/vanilla';
import { getPromiseMeta, knownRejection, setPromiseMeta } from './promiseMeta.ts';

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

/**
 * Resolves once all `promises` are fulfilled, or as soon as any of them rejects.
 */
function settleAllOrAnyRejection(promises: PromiseLike<unknown>[]): Promise<void> {
  return new Promise((resolve) => {
    let remaining = promises.length;
    for (const promise of promises) {
      promise.then(
        (value) => {
          setPromiseMeta(promise, { status: 'fulfilled', value });
          if (--remaining === 0) {
            resolve();
          }
        },
        (reason) => {
          setPromiseMeta(promise, { status: 'rejected', reason });
          resolve();
        },
      );
    }
  });
}

function unwrapPromises<T extends readonly unknown[]>(values: T): AwaitedAll<T> {
  const pending: PromiseLike<unknown>[] = [];
  for (const value of values) {
    const meta = getPromiseMeta(value);
    if (meta?.status === 'rejected') {
      // Rejecting as soon as any of the values is known to be rejected, like `Promise.all`.
      throw meta.reason;
    }
    if (meta?.status === 'pending') {
      pending.push(value as PromiseLike<unknown>);
    }
  }

  if (pending.length > 0) {
    // Suspending once for all pending values, instead of once for each of them.
    throw { [NotYet]: settleAllOrAnyRejection(pending) } satisfies EagerError;
  }

  return values.map((v) => unwrapPromise(v)) as AwaitedAll<T>;
}

function resolveSuspension<T>(
  compute: () => T,
  getLatest: () => T | Promise<T>,
  signal: AbortSignal,
): T | Promise<T> {
  try {
    // If the computation is strictly synchronous, the function will
    // be able to return a non-promise result immediately.
    return compute();
  } catch (e) {
    const suspended = (e as EagerError | { [NotYet]?: undefined } | null | undefined)?.[NotYet];
    if (suspended) {
      // There's a pending promise
      return new Promise<T>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            // If the dependencies changed while the promise was pending,
            // then we make it resolve with the result of the latest
            // computation.
            resolve(getLatest());
          },
          { once: true },
        );

        suspended.then(
          (value) => {
            setPromiseMeta(suspended, { status: 'fulfilled', value });
            if (signal.aborted) {
              // Already resolved by the 'abort' event handler
              return;
            }
            // ... otherwise we try to compute the atom again.
            resolve(resolveSuspension(compute, getLatest, signal));
          },
          (reason) => {
            setPromiseMeta(suspended, { status: 'rejected', reason });
            if (signal.aborted) {
              // Already resolved by the 'abort' event handler
              return;
            }
            // ... otherwise we try to compute the atom again, so that the
            // rejection can be handled by the read function itself.
            resolve(resolveSuspension(compute, getLatest, signal));
          },
        );
      });
    }
    // Rejecting other errors
    return knownRejection(e);
  }
}

/**
 * How many times in a row an eager atom can suspend on a new promise at the same
 * `get.await()`/`get.awaitAll()` call before giving up, instead of retrying forever.
 */
const MAX_STALLED_RETRIES = 100;

interface AwaitSuspension {
  index: number;
  error: unknown;
}

const STALLED_MESSAGE =
  '(jotai-eager) An eager atom keeps suspending on a new promise passed to `get.await()` or `get.awaitAll()`. ' +
  'Promises created inside of the read function are new on every computation, so it can never complete. ' +
  'Create the promise outside of the read function instead (e.g. in an async atom read with `get(atom)`).';

type AsyncReadFunctionError =
  'ERROR: The `read` function of eager atoms cannot be asynchronous, or return a Promise.';

/**
 * A drop-in replacement for vanilla atoms with custom async read functions, that
 * removes unnecessary suspensions. The read function is written as if it was
 * synchronous, which allows for:
 * - eager computation of the atom's value in case all of its dependencies are fulfilled
 *   (which is not the case for vanilla async atoms).
 * - interrupting computation if a dependency is not yet fulfilled.
 * The `get` parameter provides methods like `all()` to await multiple atoms simultaneously
 * and `await()` for non-atom promises.
 *
 * @param read A synchronous function that computes the atom's value using the eager getter, which can await dependencies directly.
 * @param write An optional function to handle writes to the atom, receiving the standard getter, setter, and arguments.
 * @returns An atom that resolves to the computed value or a promise of the result if dependencies are pending. For writable atoms, includes write functionality.
 *
 * @example
 * ```ts
 * import { atom } from 'jotai';
 * import { eagerAtom } from 'jotai-eager';
 *
 * const petsAtom = atom(Promise.resolve(['cat', 'dog']));
 * const filterAtom = atom('cat');
 * const filteredPetsAtom = eagerAtom((get) => {
 *   const pets = get(petsAtom);
 *   const filter = get(filterAtom);
 *   return pets.filter(name => name.includes(filter));
 * });
 * ```
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
  let warnedAboutStall = false;

  const resultAtom: WritableAtom<Promise<Value> | Value, Args, Result> = atom(
    (get, { signal }) => {
      const eagerGet = (<Value>(atomToGet: Atom<Value>): Awaited<Value> =>
        unwrapPromise(get(atomToGet))) as EagerGetter;

      eagerGet.all = <T extends readonly Atom<unknown>[]>(atoms: T) => {
        // Jump-starting every asynchronous atom, and depending on all of them,
        // even if some of them throw synchronously.
        let syncError: { reason: unknown } | undefined;
        const values = atoms.map((a) => {
          try {
            return get(a);
          } catch (reason) {
            syncError ??= { reason };
            return undefined;
          }
        });
        if (syncError) {
          throw syncError.reason;
        }
        return unwrapPromises(values) as AwaitedAll<T>;
      };

      // Tracking at which `get.await()`/`get.awaitAll()` call the computation suspends, to detect
      // promises created inside of `read`. Retrying after such a promise settles suspends at the
      // same call again, on a brand new promise, never making progress.
      let awaitCalls = 0;
      let awaitSuspension: AwaitSuspension | undefined;
      let prevSuspendedAt: number | undefined;
      let stalledRetries = 0;

      const trackAwait = <R>(unwrap: () => R): R => {
        const index = awaitCalls++;
        try {
          return unwrap();
        } catch (error) {
          if (isEagerError(error)) {
            awaitSuspension = { index, error };
          }
          throw error;
        }
      };

      eagerGet.await = <T>(promiseOrValue: T) => trackAwait(() => unwrapPromise(promiseOrValue));
      eagerGet.awaitAll = <T extends readonly unknown[]>(values: T) =>
        trackAwait(() => unwrapPromises(values));

      const compute = () => {
        awaitCalls = 0;
        awaitSuspension = undefined;
        try {
          return read(eagerGet);
        } catch (e) {
          // Assigned by `trackAwait` while running `read`, which TypeScript can't see.
          const suspension = awaitSuspension as AwaitSuspension | undefined;
          const suspendedAt = suspension && suspension.error === e ? suspension.index : undefined;
          const stalled =
            suspendedAt !== undefined &&
            prevSuspendedAt !== undefined &&
            suspendedAt <= prevSuspendedAt;
          prevSuspendedAt = suspendedAt;
          stalledRetries = stalled ? stalledRetries + 1 : 0;

          if (stalled && !warnedAboutStall && import.meta.env?.MODE !== 'production') {
            warnedAboutStall = true;
            console.warn(STALLED_MESSAGE);
          }
          if (stalledRetries >= MAX_STALLED_RETRIES) {
            throw new Error(STALLED_MESSAGE);
          }
          throw e;
        }
      };

      return resolveSuspension(compute, () => get(resultAtom), signal);
    },
    // Jotai only makes the atom writable if `write` is defined, matching read-only vanilla atoms.
    write as Write<Args, Result>,
  );

  return resultAtom;
}

/**
 * Only useful if the eager atom's read function involves a try {} catch {}. Can be used to
 * detect whether a thrown value originates from `jotai-eager`, in which case should be rethrown.
 *
 * @param error The error thrown during eager atom computation to check.
 * @returns True if the error is a suspension trigger from jotai-eager, indicating computation should be paused; otherwise, false.
 *
 * @example
 * ```ts
 * import { eagerAtom, isEagerError } from 'jotai-eager';
 *
 * const myAtom = eagerAtom((get) => {
 *   try {
 *     // some computation
 *   } catch (e) {
 *     if (isEagerError(e)) {
 *       throw e; // Rethrow to let jotai-eager handle
 *     }
 *     // Handle other errors
 *   }
 * });
 * ```
 */
export function isEagerError(error: unknown): boolean {
  return !!(error as EagerError)?.[NotYet];
}
