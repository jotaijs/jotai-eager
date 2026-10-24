import { setPromiseMeta } from './isPromise.ts';

/**
 * Like `Promise.reject`, but the rejection is known right away, so that
 * consumers can handle it without suspending.
 */
export function knownRejection<T = never>(reason: unknown): Promise<T> {
  const promise = Promise.reject(reason) as Promise<T>;
  setPromiseMeta(promise, { status: 'rejected', reason });
  return promise;
}
