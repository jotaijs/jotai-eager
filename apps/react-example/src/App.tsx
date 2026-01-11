import {
  type Atom,
  type SetStateAction,
  type WritableAtom,
  atom,
  useAtomValue,
  useSetAtom,
} from 'jotai';
import { eagerAtom } from 'jotai-eager';
import { Suspense } from 'react';
import { refetchUserAtom, updateOptimisticallyAtom, userAtom } from './userAtom';
import './App.css';

type CounterAtom = WritableAtom<number, [SetStateAction<number>], void>;
type NameAtom = Atom<Promise<string> | string>;

const vanillaSuspensionsAtom = atom(0);
const eagerSuspensionsAtom = atom(0);

const vanillaUppercaseNameAtom = atom(async (get) => {
  return (await get(userAtom)).name.toUpperCase();
});

const eagerUppercaseNameAtom = eagerAtom((get) => {
  return get(userAtom).name.toUpperCase();
});

function SuspenseCounter(props: { counterAtom: CounterAtom }) {
  const { counterAtom } = props;
  const count = useAtomValue(counterAtom);

  return <p>Suspensions: {count}</p>;
}

function SuspenseFallback(props: { counterAtom: CounterAtom }) {
  const setCounter = useSetAtom(props.counterAtom);
  setCounter((prev) => prev + 1);

  return <p>Loading...</p>;
}

function NameDisplay(props: { nameAtom: NameAtom }) {
  const name = useAtomValue(props.nameAtom);
  return <p>Name: {name}</p>;
}

function Panel(props: { title: string; nameAtom: NameAtom; counterAtom: CounterAtom }) {
  const { title, nameAtom, counterAtom } = props;

  return (
    <section className="panel">
      <SuspenseCounter counterAtom={counterAtom} />
      <h2>{title}</h2>
      <Suspense fallback={<SuspenseFallback counterAtom={counterAtom} />}>
        <NameDisplay nameAtom={nameAtom} />
      </Suspense>
    </section>
  );
}

function App() {
  const refetchUser = useSetAtom(refetchUserAtom);
  const updateOptimistically = useSetAtom(updateOptimisticallyAtom);

  return (
    <>
      <header>
        <h1>👻⏰ Jotai Eager</h1>
      </header>
      <div className="buttons">
        <button type="button" onClick={refetchUser}>
          Refetch
        </button>
        <button type="button" onClick={updateOptimistically}>
          Update optimistically
        </button>
      </div>
      <div className="row">
        <Panel
          title="atom()"
          nameAtom={vanillaUppercaseNameAtom}
          counterAtom={vanillaSuspensionsAtom}
        />
        <Panel
          title="eagerAtom()"
          nameAtom={eagerUppercaseNameAtom}
          counterAtom={eagerSuspensionsAtom}
        />
      </div>
    </>
  );
}

export default App;
