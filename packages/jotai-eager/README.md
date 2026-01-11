<!-- automd:file src="../../README.md" -->

# 👻⏰ Jōtai Eager

> Formerly known as `jotai-derive`

- [Overview](#overview)
- [Recipes](#recipes)
  - [Avoiding request waterfalls](#avoiding-request-waterfalls)
- [Caveats](#caveats)
- [Advanced usage](#advanced-usage)
- [Motivation](#motivation)

## Overview

```sh
npm install jotai-eager
```

The **jōtai eager** library lets you build asynchronous data graphs without unnecessary
suspensions. Eager atoms are a direct replacement for vanilla atoms with a custom async read function, with a few differences:

- The read function has to be synchronous, because eager atoms handle asynchronicity transparently.
- Eager atoms have to be pure (even more so than vanilla atoms). That's because their read function can be executed multiple times on dependency change.

Let's say we have an atom that fetches names of pets from an API, and a filter atom:

```ts
const petsAtom = atom<Promise<string[]>>(...);
const filterAtom = atom('cat');
```

To create an atom of filtered pets using vanilla atoms, we would do the following:

```ts
const filteredPetsAtom = atom(async (get) => {
  const filter = get(filterAtom);
  const pets = await get(petsAtom);
  return pets.filter((name) => name.includes(filter));
}); // => Atom<Promise<string[]>>
```

`filteredPetsAtom` always returns a promise, even though the result
could be computed eagerly if the `filterAtom` was
the only changed dependency. We can fix that with **jōtai eager**:

```ts
import { eagerAtom } from 'jotai-eager';

const filteredPetsAtom = eagerAtom((get) => {
  const filter = get(filterAtom);
  const pets = get(petsAtom); // ✨ no await ✨
  return pets.filter((name) => name.includes(filter));
}); // => Atom<Promise<string[]> | string[]>
```

Now, the type reflects the eager behavior of this atom.
It's value will be `string[]` if the only thing that
changed is the filter, and `Promise<string[]>` otherwise!

> Codesandbox example of jotai-eager + React:
>
> [![Explore jotai-eager example](https://codesandbox.io/static/img/play-codesandbox.svg)](https://codesandbox.io/p/devbox/jotai-derive-example-forked-pf38dg)

## Recipes

### Avoiding request waterfalls

If your atom has multiple async dependencies, best to jump start all of them at once and wait for their results, instead of awaiting them sequentially. In vanilla async atoms, `Promise.all(...)` is the API to use, but in eager atoms, use the `get.all()` API:

```ts
const myMessages = eagerAtom((get) => {
  const [user, messages] = get.all([userAtom, messagesAtom]);
  return messages.filter((msg) => msg.authorId === user.id);
}); // => Atom<Message[] | Promise<Message[]>>
```

### Awaiting a Promise that is not another atom's value

We can use the `get.await` API to await regular Promises inside `eagerAtom` definitions, granted we make sure that the Promise
we're passing is consistent across invocations of the atom's read function.

```ts
const statusAtom = eagerAtom((get) => {
  const statusPromise = get(currentInvoiceAtom).getStatus(); // => Promise<InvoiceStatus>
  const status = get.await(statusPromise);
  //    ^? InvoiceStatus
  return status;
});
```

## Caveats

### Using `try` & `catch` inside eager atoms

Eager atoms internally use exceptions to "suspend" computation of the atom until an async dependency is fulfilled (similar to React's suspense behavior, but does not require React to work). This means that using exception handling inside of eager atoms has to be instrumented with an additional call to `isEagerError`.

```ts
import { eagerAtom, isEagerError } from 'jotai-eager';

const fooAtom = eagerAtom((get) => {
  try {
    // ...
  } catch (e) {
    if (isEagerError(e)) {
      // Rethrow the error to be handled by `jotai-eager`
      throw e;
    }

    // ...
  }
});
```

### Awaiting a Promise that is created inside the atom

Since the read function is "retried" after a Promise we await is fulfilled, the mechanism expects
the same promise to be passed into `get.await` the second time around. Since we're creating the
Promise inside of the read function itself, that will never be the case, and we'll be stuck in an infinite loop.

```ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// This atom will be stuck in an infinite loop :(
const deferredNumberAtom = eagerAtom((get) => {
  get.await(sleep(1000)); // Waiting for a second...
  return 123;
});
```

For this particular use-case, since we're always deferring, using an `eagerAtom` over
a vanilla async atom is unnecessary. [See Advanced Usage for more complex patterns](#advanced-usage).

### Make note of the dual nature

Improper use of this utility can cause the [Release of Ẕ̶̨̫̹̌͊͌͑͊̕͢͟a̡̜̦̝͓͇͗̉̆̂͋̏͗̍ͅl̡̛̝͍̅͆̎̊̇̕͜͢ģ̧̧͍͓̜̲͖̹̂͋̆̃̑͗̋͌̊̏ͅǫ̷̧͓̣͚̞̣̋̂̑̊̂̀̿̀̚͟͠ͅ](https://blog.izs.me/2013/08/designing-apis-for-asynchrony/).
If you `store.get` a dual-natured atom manually, make sure to handle both the
asynchronous case and the synchronous case (both `await` and `soon(...)` will help).

## Advanced usage

If the limitations of eager atoms are too restrictive for your use case (the purity of the read function), the library exports `soon` and `soonAll` functions that can
be used to perform sync/async transformations on data eagerly, on a more fine-grained level.

### Conditional dependency

```ts
import { soon } from 'jotai-eager';

declare const queryAtom: Atom<RestrictedItem | Promise<RestrictedItem>>;
declare const isAdminAtom: Atom<boolean | Promise<boolean>>;

// Atom<RestrictedItem | null | Promise<RestrictedItem | null>>
const restrictedItemAtom = atom((get) => {
  const isAdmin = get(isAdminAtom);
  return soon(isAdmin, (isAdmin) => (isAdmin ? get(queryAtom) : null));
});
```

### Conditional dependency (multiple conditions)

```ts
import { soon, soonAll } from 'jotai-eager';

declare const queryAtom: Atom<RestrictedItem | Promise<RestrictedItem>>;
declare const isAdminAtom: Atom<boolean | Promise<boolean>>;
declare const enabledAtom: Atom<boolean | Promise<boolean>>;

// Atom<RestrictedItem | null | Promise<RestrictedItem | null>>
const restrictedItemAtom = atom((get) => {
  return soon(soonAll(get(isAdminAtom), get(enabledAtom)), ([isAdmin, enabled]) =>
    isAdmin && enabled ? get(queryAtom) : null,
  );
});
```

## Motivation

Jōtai offers powerful primitives for working with asynchronous data outside of the web framework (e.g. React), and allows the UI and business logic to
properly integrate with the data layer. Many data-fetching integrations offer a peek into the client-side cache via atoms. When the cache
is not yet populated, the atom has to resolve to a **Promise** of the value. However, if the value already exists in cache, and we do an optimistic update, then the value can be made available downstream
immediately.

Building data graphs with these dual-natured (sometimes async, sometimes sync) atoms as a base can lead to unnecessary rerenders, stale values and micro-suspensions (in case of React) if not handled with care.

`jotai-eager` provides a primitive for building asynchronous data graphs
that act on values as soon as they are available (either awaiting for them, or acting on them synchronously).

<!-- /automd -->
