import { getFulfilledValue, isKnown, isPromiseLike, setPromiseMeta } from './isPromise.ts';

type PromiseOrValue<T> = Promise<T> | T;

type SoonAll<T extends readonly unknown[]> = PromiseOrValue<{
  [Index in keyof T]: Awaited<T[Index]>;
}>;

/**
 * Given array `values`, if all elements are known (are not unresolved promises),
 * returns an array of the same length with Awaited `values`. Otherwise, it returns a
 * promise to that array.
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
