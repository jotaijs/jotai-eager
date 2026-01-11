import { getFulfilledValue, isKnown, isPromiseLike, setPromiseMeta } from './isPromise.ts';

type PromiseOrValue<T> = Promise<T> | T;

type SoonAll<T extends readonly unknown[]> = PromiseOrValue<{
  [Index in keyof T]: Awaited<T[Index]>;
}>;

/**
 * Given array `values`, if all elements are known (are not unresolved promises),
 * returns an array of the same length with Awaited `values`. Otherwise, it returns a
 * promise to that array.
 *
 * @param values An array of values or promises to await collectively.
 * @returns An array of the awaited values if all are resolved synchronously, or a promise resolving to that array if any are pending.
 *
 * @example
 * ```ts
 * import { soonAll } from 'jotai-eager';
 *
 * const values = [Promise.resolve(1), 2, Promise.resolve(3)];
 * const result = soonAll(values); // [1, 2, 3] or Promise<[1, 2, 3]>
 * ```
 */
export function soonAll<T extends readonly unknown[] | []>(values: T): SoonAll<T>;
export function soonAll<T extends readonly unknown[]>(values: T): SoonAll<T>;
export function soonAll<T extends readonly unknown[]>(values: T): SoonAll<T> {
  if (values.every(isKnown)) {
    return values.map((el) => getFulfilledValue(el)) as unknown as SoonAll<T>;
  }

  return Promise.all(values).then((fulfilledValues) => {
    fulfilledValues.map((fulfilled, idx) => {
      const promise = values[idx];
      if (isPromiseLike(promise)) {
        setPromiseMeta(promise, { status: 'fulfilled', value: fulfilled });
      }
    });
    return fulfilledValues;
  });
}
