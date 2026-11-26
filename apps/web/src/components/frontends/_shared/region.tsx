import { createStore, shallow, useSelector, type Store, type StoreActionMap, type StoreActionsFactory } from "@tanstack/react-store";
import { createContext, useContext, useState, type ReactNode } from "react";

export type RegionInitial<State> = State | (() => State);

export type RegionProviderProps<State extends object, Actions extends StoreActionMap> = {
  store?: Store<State, Actions>;
  initial?: RegionInitial<State>;
  children: ReactNode;
};

export type Region<State extends object, Actions extends StoreActionMap> = {
  Provider: (props: RegionProviderProps<State, Actions>) => ReactNode;
  useCreateRegionStore: (initial: RegionInitial<State>) => Store<State, Actions>;
  useRegion: <Selected>(selector: (state: State) => Selected, compare?: (a: Selected, b: Selected) => boolean) => Selected;
  useRegionActions: () => Actions;
  useRegionStore: () => Store<State, Actions>;
};

export { shallow };

export function createRegion<State extends object, Actions extends StoreActionMap>(
  name: string,
  actions: StoreActionsFactory<State, Actions>,
): Region<State, Actions> {
  const Context = createContext<Store<State, Actions> | null>(null);
  Context.displayName = `${name}Region`;

  const build = (initial: RegionInitial<State>) => {
    const state = typeof initial === "function" ? (initial as () => State)() : initial;
    return createStore<State, Actions>(state as never, actions);
  };

  function useCreateRegionStore(initial: RegionInitial<State>) {
    const [store] = useState(() => build(initial));
    return store;
  }

  function Provider({ store, initial, children }: RegionProviderProps<State, Actions>) {
    const [owned] = useState(() => (store || initial === undefined ? null : build(initial)));
    const value = store ?? owned;
    if (!value) throw new Error(`${name}: Provider needs a store or an initial state`);
    return <Context value={value}>{children}</Context>;
  }
  Provider.displayName = `${name}Provider`;

  function useRegionStore() {
    const store = useContext(Context);
    if (!store) throw new Error(`${name}: region hook used outside its Provider`);
    return store;
  }

  function useRegion<Selected>(selector: (state: State) => Selected, compare?: (a: Selected, b: Selected) => boolean) {
    return useSelector(useRegionStore(), selector, compare ? { compare } : undefined);
  }

  function useRegionActions() {
    return useRegionStore().actions;
  }

  return { Provider, useCreateRegionStore, useRegion, useRegionActions, useRegionStore };
}
