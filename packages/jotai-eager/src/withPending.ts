import { atom } from 'jotai/vanilla';
import type { Getter } from 'jotai/vanilla';
import type { Atom, WritableAtom } from 'jotai/vanilla';
import { getPromiseMeta, setPromiseMeta, isPromiseLike } from './isPromise.ts';

const defaultFallback = () => undefined;

export interface WithPendingContext<Value> {
  get: Getter;
  prev: Awaited<Value> | undefined;
  pending: PromiseLike<Awaited<Value>>;
}

/**
 * Wraps an atom to handle pending states by returning a fallback value while the atom's value is unresolved, optionally using a custom fallback function.
 * Intended as an alternative to Jotai's `unwrap`, providing enhanced pending state handling.
 *
 * @param anAtom The atom to wrap, which may resolve asynchronously.
 * @returns An atom that returns the resolved value or undefined while pending.
 *
 * @example
 * ```ts
 * import { atom } from 'jotai';
 * import { withPending } from 'jotai-eager';
 *
 * const asyncAtom = atom(Promise.resolve('data'));
 * const wrappedAtom = withPending(asyncAtom);
 * // wrappedAtom returns 'data' when resolved, or undefined while pending
 * ```
 */
export function withPending<Value, Args extends unknown[], Result>(
  anAtom: WritableAtom<Value, Args, Result>,
): WritableAtom<Awaited<Value> | undefined, Args, Result>;

/**
 * Wraps an atom to handle pending states by returning a fallback value while the atom's value is unresolved, optionally using a custom fallback function.
 * Intended as an alternative to Jotai's `unwrap`, providing enhanced pending state handling.
 *
 * @param anAtom The atom to wrap, which may resolve asynchronously.
 * @param fallback A function that receives context (getter, previous value, pending promise) and returns a value to use while pending.
 * @returns An atom that returns the resolved value or the fallback while pending.
 *
 * @example
 * ```ts
 * import { atom } from 'jotai';
 * import { withPending } from 'jotai-eager';
 *
 * const asyncAtom = atom(Promise.resolve('data'));
 * const wrappedAtom = withPending(asyncAtom, () => 'Loading...');
 * // wrappedAtom returns 'data' when resolved, or 'Loading...' while pending
 * ```
 */
export function withPending<Value, Args extends unknown[], Result, PendingValue>(
  anAtom: WritableAtom<Value, Args, Result>,
  fallback: (ctx: WithPendingContext<Value>) => PendingValue,
): WritableAtom<Awaited<Value> | PendingValue, Args, Result>;

/**
 * Wraps an atom to handle pending states by returning a fallback value while the atom's value is unresolved, optionally using a custom fallback function.
 * Intended as an alternative to Jotai's `unwrap`, providing enhanced pending state handling.
 *
 * @param anAtom The atom to wrap, which may resolve asynchronously.
 * @returns An atom that returns the resolved value or undefined while pending.
 *
 * @example
 * ```ts
 * import { atom } from 'jotai';
 * import { withPending } from 'jotai-eager';
 *
 * const asyncAtom = atom(Promise.resolve('data'));
 * const wrappedAtom = withPending(asyncAtom);
 * // wrappedAtom returns 'data' when resolved, or undefined while pending
 * ```
 */
export function withPending<Value>(anAtom: Atom<Value>): Atom<Awaited<Value> | undefined>;

/**
 * Wraps an atom to handle pending states by returning a fallback value while the atom's value is unresolved, optionally using a custom fallback function.
 * Intended as an alternative to Jotai's `unwrap`, providing enhanced pending state handling.
 *
 * @param anAtom The atom to wrap, which may resolve asynchronously.
 * @param fallback A function that receives context (getter, previous value, pending promise) and returns a value to use while pending.
 * @returns An atom that returns the resolved value or the fallback while pending.
 *
 * @example
 * ```ts
 * import { atom } from 'jotai';
 * import { withPending } from 'jotai-eager';
 *
 * const asyncAtom = atom(Promise.resolve('data'));
 * const wrappedAtom = withPending(asyncAtom, () => 'Loading...');
 * // wrappedAtom returns 'data' when resolved, or 'Loading...' while pending
 * ```
 */
export function withPending<Value, PendingValue>(
  anAtom: Atom<Value>,
  fallback: (ctx: WithPendingContext<Value>) => PendingValue,
): Atom<Awaited<Value> | PendingValue>;

export function withPending<Value, Args extends unknown[], Result, PendingValue>(
  anAtom: WritableAtom<Value, Args, Result> | Atom<Value>,
  fallback: (ctx: WithPendingContext<Value>) => PendingValue = defaultFallback as never,
) {
  type PromiseAndValue = { readonly p?: PromiseLike<unknown> } & (
    | { readonly v: Awaited<Value> }
    | { readonly f: PendingValue; readonly v?: Awaited<Value> }
  );
  const refreshAtom = atom(0);

  if (import.meta.env?.MODE !== 'production') {
    refreshAtom.debugPrivate = true;
  }

  const promiseAndValueAtom: WritableAtom<PromiseAndValue, [], void> & {
    init?: undefined;
  } = atom(
    (get, { setSelf }) => {
      get(refreshAtom);
      const prev = get(promiseAndValueAtom) as PromiseAndValue | undefined;
      const promise = get(anAtom);
      if (!isPromiseLike(promise)) {
        return { v: promise as Awaited<Value> } as PromiseAndValue;
      }
      const meta = getPromiseMeta(promise);
      if (meta?.status === 'fulfilled') {
        return { p: promise, v: meta.value } as PromiseAndValue;
      }
      if (meta?.status === 'rejected') {
        throw meta.reason;
      }

      if (promise !== prev?.p) {
        promise.then(
          (value) => {
            setPromiseMeta(promise, { status: 'fulfilled', value });
            setSelf();
          },
          (reason) => {
            setPromiseMeta(promise, { status: 'rejected', reason });
            setSelf();
          },
        );
      }

      if (prev && 'v' in prev) {
        return {
          p: promise,
          f: fallback({
            get,
            prev: prev.v,
            pending: promise as PromiseLike<Awaited<Value>>,
          }),
          v: prev.v,
        } as PromiseAndValue;
      }
      return {
        p: promise,
        f: fallback({
          get,
          prev: undefined,
          pending: promise as PromiseLike<Awaited<Value>>,
        }),
      } as PromiseAndValue;
    },
    (_get, set) => {
      set(refreshAtom, (c) => c + 1);
    },
  );
  // HACK to read PromiseAndValue atom before initialization
  promiseAndValueAtom.init = undefined;

  if (import.meta.env?.MODE !== 'production') {
    promiseAndValueAtom.debugPrivate = true;
  }

  return atom(
    (get) => {
      const state = get(promiseAndValueAtom);
      if ('f' in state) {
        // is pending
        return state.f;
      }
      return state.v;
    },
    (_get, set, ...args) => set(anAtom as WritableAtom<Value, unknown[], unknown>, ...args),
  );
}
