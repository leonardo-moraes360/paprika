import { shallow, useSelector } from "@tanstack/react-store";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createLiveClient, type LiveActions, type LiveClient, type LiveClientOptions, type LiveEvent, type LiveState } from "./live-store";

const LiveContext = createContext<LiveClient | null>(null);

export type LiveProviderProps = {
  /** An existing client (tests, harness). Without it the provider makes one, once, and owns its connection. */
  client?: LiveClient;
  options?: LiveClientOptions;
  children: ReactNode;
};

/**
 * One live connection per app. The client is made inside the component (never at import time) and started in an
 * effect; `start` creates the socket in a microtask, so StrictMode's mount, cleanup, mount opens a single socket.
 * A client passed in is started and stopped here too, so a caller never has to remember it.
 */
export function LiveProvider({ client: given, options, children }: LiveProviderProps) {
  const [owned] = useState(() => given ?? createLiveClient(options));
  const client = given ?? owned;
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  return <LiveContext value={client}>{children}</LiveContext>;
}

export function useLiveClient(): LiveClient {
  const client = useContext(LiveContext);
  if (!client) throw new Error("useLive* used outside a LiveProvider");
  return client;
}

/**
 * Reads a slice of the live state. The component re-renders only when the selected value changes
 * (`Object.is`, or `compare` when given): select the narrowest thing, never the whole document for one node.
 */
export function useLive<T>(selector: (state: LiveState) => T, compare?: (a: T, b: T) => boolean): T {
  return useSelector(useLiveClient().store, selector, compare ? { compare } : undefined);
}

/** Stable for the life of the client: safe in dependency arrays and as a prop. */
export function useLiveActions(): LiveActions {
  return useLiveClient().actions;
}

export { shallow };

/** Subscribes to the events that are not state (`workspaceOp`, `pins`). The listener may change between renders. */
export function useLiveEvent(listener: (event: LiveEvent) => void) {
  const client = useLiveClient();
  const [ref] = useState(() => ({ current: listener }));
  ref.current = listener;
  useEffect(() => client.subscribe((event) => ref.current(event)), [client, ref]);
}
