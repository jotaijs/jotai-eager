interface PromiseMetaPending {
  status: 'pending';
}

interface PromiseMetaFulfilled<T> {
  status: 'fulfilled';
  value: T;
}

interface PromiseMetaRejected {
  status: 'rejected';
  reason: unknown;
}

export type PromiseMeta<T> = PromiseMetaPending | PromiseMetaFulfilled<T> | PromiseMetaRejected;

const PENDING: PromiseMetaPending = { status: 'pending' } as const;
const promiseMetaCache = new WeakMap<object, PromiseMeta<unknown>>();
const trackedPromises = new WeakSet<PromiseLike<unknown>>();

export function isPromiseLike<T>(value: PromiseLike<T> | unknown): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T>)?.then === 'function';
}

export function getPromiseMeta<T>(promise: unknown | Promise<T>): PromiseMeta<T> | undefined {
  if (!isPromiseLike(promise)) {
    return undefined;
  }

  return (promiseMetaCache.get(promise as object) ?? PENDING) as PromiseMeta<T> | undefined;
}

export function setPromiseMeta<T>(promise: PromiseLike<T>, meta: PromiseMeta<T>): void {
  promiseMetaCache.set(promise, meta);
}

/**
 * Records the meta of `promise` once it settles. Listens to each promise at most once,
 * no matter how many times it's called.
 */
export function trackPromise<T>(promise: PromiseLike<T>): void {
  if (trackedPromises.has(promise)) {
    return;
  }
  trackedPromises.add(promise);
  promise.then(
    (value) => setPromiseMeta(promise, { status: 'fulfilled', value }),
    (reason) => setPromiseMeta(promise, { status: 'rejected', reason }),
  );
}

/**
 * Like `Promise.reject`, but the rejection is known right away, so that
 * consumers can handle it without suspending.
 */
export function knownRejection<T = never>(reason: unknown): Promise<T> {
  const promise = Promise.reject(reason) as Promise<T>;
  setPromiseMeta(promise, { status: 'rejected', reason });
  return promise;
}

/**
 * If it's a non promise, or a fulfilled promise.
 */
export function isKnown<T>(value: PromiseLike<T> | unknown): boolean {
  const meta = getPromiseMeta(value);

  if (meta) {
    return meta.status === 'fulfilled'; // only if fulfilled
  }

  return true; // not a promise, we know the value.
}

/**
 * NOTE: If `promiseOrValue` is a Promise, but is not fulfilled, then it's undefined behavior.
 * @returns `promiseOrValue` if it's not a Promise, the fulfilled value if it's a Promise.
 */
export function getFulfilledValue<T>(promiseOrValue: PromiseLike<T> | unknown): T {
  const meta = getPromiseMeta(promiseOrValue);
  if (meta) {
    return (meta as PromiseMetaFulfilled<T>).value;
  }
  return promiseOrValue as T;
}
