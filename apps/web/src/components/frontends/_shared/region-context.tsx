import { createStore, useSelector, type Store } from "@tanstack/react-store";
import { createContext, useContext, useState, type ReactNode } from "react";

export type RegionInitial<State> = State | (() => State);

export type RegionProviderProps<State> = {
  initial: RegionInitial<State>;
  children: ReactNode;
};

export type RegionSelectorOptions<Selected> = {
  compare?: (a: Selected, b: Selected) => boolean;
};

export type RegionContext<State extends object> = {
  Provider: (props: RegionProviderProps<State>) => ReactNode;
  useRegion: <Selected>(selector: (state: State) => Selected, options?: RegionSelectorOptions<Selected>) => Selected;
  useRegionStore: () => Store<State>;
};

export function createRegionContext<State extends object>(name: string): RegionContext<State> {
  const Context = createContext<Store<State> | null>(null);
  Context.displayName = `${name}Region`;

  function Provider({ initial, children }: RegionProviderProps<State>) {
    const [store] = useState(() => createStore<State>(typeof initial === "function" ? (initial as () => State)() : initial));
    return <Context value={store}>{children}</Context>;
  }
  Provider.displayName = `${name}Provider`;

  function useRegionStore() {
    const store = useContext(Context);
    if (!store) throw new Error(`${name}: region hook used outside its Provider`);
    return store;
  }

  function useRegion<Selected>(selector: (state: State) => Selected, options?: RegionSelectorOptions<Selected>) {
    return useSelector(useRegionStore(), selector, options);
  }

  return { Provider, useRegion, useRegionStore };
}
