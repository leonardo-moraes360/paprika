import type { Document, Node } from "@paprika/core";
import type { CanvasActions, CanvasState } from "./region";
import type { PreviewPatch } from "./types";

export type PreviewController = {
  /** Shows `patches` on the nodes (and takes those nodes over from a commit still waiting for its echo). Call it as the pointer moves: it writes one store, no React state. */
  set: (patches: Readonly<Record<string, PreviewPatch | null>>) => void;
  /** Drops the preview of `ids`, or all of it (a cancelled gesture). */
  clear: (ids?: readonly string[]) => void;
  /**
   * The gesture ended and `result` is the answer to its `onApply`. The preview stays until the document shows what it showed
   * (or, once the server acked, until the document changes at all: the server may have rounded it) and goes at once when
   * `result` is `false` or rejects, so the node jumps back instead of staying where nothing was saved.
   */
  commit: (ids: readonly string[], result: Promise<boolean>) => void;
  /** Called with every document the canvas gets. */
  reconcile: (doc: Document) => void;
  /** The canvas is (again) on screen: a commit answers again. StrictMode runs a mount's cleanup and setup once more, which would leave a disposed controller deaf to the server's answer. */
  attach: () => void;
  dispose: () => void;
};

type Held = { ids: Set<string>; base: Document; acked: boolean };

const GEOMETRY = ["x", "y", "width", "height", "rotation"] as const;

function showsPatch(node: Node | undefined, patch: PreviewPatch): boolean {
  if (!node) return true;
  const record = node as unknown as Record<string, unknown>;
  return GEOMETRY.every((key) => patch[key] === undefined || record[key] === patch[key]);
}

export function createPreviewController(actions: Pick<CanvasActions, "setPreview" | "clearPreview">, read: () => { state: CanvasState; doc: Document }): PreviewController {
  let held: Held[] = [];
  let disposed = false;

  const release = (ids: readonly string[]) => {
    actions.clearPreview(ids);
    for (const entry of held) for (const id of ids) entry.ids.delete(id);
    held = held.filter((entry) => entry.ids.size > 0);
  };

  const reconcile = (doc: Document) => {
    if (held.length === 0) return;
    const { state } = read();
    const done: string[] = [];
    for (const entry of held) {
      for (const id of entry.ids) {
        const patch = state.preview[id];
        if (!patch || showsPatch(doc.nodes[id], patch) || (entry.acked && doc !== entry.base)) done.push(id);
      }
    }
    if (done.length > 0) release(done);
  };

  return {
    set: (patches) => {
      const ids = Object.keys(patches);
      for (const entry of held) for (const id of ids) entry.ids.delete(id);
      held = held.filter((entry) => entry.ids.size > 0);
      actions.setPreview(patches);
    },
    clear: (ids) => {
      if (!ids) {
        held = [];
        actions.clearPreview();
      } else release(ids);
    },
    commit: (ids, result) => {
      const entry: Held = { ids: new Set(ids), base: read().doc, acked: false };
      held.push(entry);
      const answer = (ok: boolean) => {
        if (disposed || !held.includes(entry)) return;
        if (!ok) release([...entry.ids]);
        else {
          entry.acked = true;
          reconcile(read().doc);
        }
      };
      result.then(answer, () => answer(false));
      // The echo may already be in.
      reconcile(read().doc);
    },
    reconcile,
    attach: () => {
      disposed = false;
    },
    dispose: () => {
      disposed = true;
      held = [];
    },
  };
}
