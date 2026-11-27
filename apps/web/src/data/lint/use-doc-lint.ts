import { useEffect, useState, useSyncExternalStore } from "react";
import { useLiveClient } from "../live/hooks";
import { DocLint } from "./doc-lint";
import type { LintSummary } from "./lint-runner";

/**
 * Lints the open document off the main thread and returns the latest summary, or `undefined` while there is none.
 * It watches the live store directly, so a delta never re-renders the caller: the caller re-renders only when the
 * issues change (and, with `enabled` false, never: the result is not read).
 */
export function useDocLint(enabled = true): LintSummary | undefined {
  const client = useLiveClient();
  const [lint] = useState(() => new DocLint());
  useEffect(() => {
    const feed = (doc: typeof client.store.state.doc) => {
      if (doc) lint.update(doc);
    };
    feed(client.store.state.doc);
    const subscription = client.store.subscribe((state) => feed(state.doc));
    return () => {
      subscription.unsubscribe();
      lint.dispose();
    };
  }, [client, lint]);
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
