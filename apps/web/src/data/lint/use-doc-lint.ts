import { createContext, createElement, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLiveClient } from "../live/hooks";
import { DocLint, workerTransport, type TransportFactory } from "./doc-lint";
import type { LintSummary } from "./lint-runner";

const TransportContext = createContext<TransportFactory>(workerTransport);

/** Picks the transport the lint below it uses (the worker by default; tests pass `nullTransport` or `inlineTransport`). */
export function DocLintTransportProvider({ transport, children }: { transport: TransportFactory; children: ReactNode }) {
  return createElement(TransportContext, { value: transport }, children);
}

/**
 * Lints the open document off the main thread and returns the latest summary, or `undefined` while there is none.
 * It watches the live store directly, so a delta never re-renders the caller: the caller re-renders only when the
 * issues change (and, with `enabled` false, never: the result is not read and the store is not even watched).
 */
export function useDocLint(enabled = true): LintSummary | undefined {
  const client = useLiveClient();
  const transport = useContext(TransportContext);
  const [lint] = useState(() => new DocLint(transport));
  useEffect(() => () => lint.dispose(), [lint]);
  // Fed only while the result is read (`enabled`): with something selected a burst of edits costs the lint nothing. When it
  // comes back on, the document as it is now goes in, and `DocLint` sends a patch against what the worker holds (or a reset when much changed).
  useEffect(() => {
    if (!enabled) return;
    const feed = (doc: typeof client.store.state.doc) => {
      if (doc) lint.update(doc);
    };
    feed(client.store.state.doc);
    const subscription = client.store.subscribe((state) => feed(state.doc));
    return () => subscription.unsubscribe();
  }, [client, lint, enabled]);
  const docId = useSyncExternalStore(
    (listener) => {
      const subscription = client.store.subscribe(listener);
      return () => subscription.unsubscribe();
    },
    () => (enabled ? client.store.state.doc?.id : undefined),
    () => undefined,
  );
  return useSyncExternalStore(lint.subscribe, () => (enabled ? (lint.getResult(docId) ?? undefined) : undefined), () => undefined);
}
