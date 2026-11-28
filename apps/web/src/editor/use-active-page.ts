import { useEffect } from "react";
import { resolvePageId } from "@/adapters/pages";
import { useLive, useLiveClient } from "@/data/live";
import { useEditor, useEditorStore } from "./editor-store";

/** The page in view: the editor's choice while that page exists, else the first page (`null` for a document without pages). */
export function useActivePageId(): string | null {
  const chosen = useEditor((s) => s.pageId);
  return useLive((s) => resolvePageId(s.doc, chosen));
}

/**
 * Puts the editor's choice back to "the first page" when the page it points at is gone (another person or an agent
 * deleted it). A page that was just asked for and has not arrived in the document yet is left alone: only a page
 * seen in the document and then missing counts as gone.
 */
export function useCorrectPage() {
  const client = useLiveClient();
  const editor = useEditorStore();
  useEffect(() => {
    let seen: string | null = null;
    const check = () => {
      const pageId = editor.state.pageId;
      const doc = client.store.state.doc;
      if (pageId === null || !doc) return;
      if (doc.nodes[pageId]?.type === "page") seen = pageId;
      else if (seen === pageId) editor.actions.setPage(null);
    };
    check();
    const live = client.store.subscribe(check);
    const own = editor.subscribe(check);
    return () => {
      live.unsubscribe();
      own.unsubscribe();
    };
  }, [client, editor]);
}

/** Drops from the selection the layers that were in the document and are gone (deleted by someone else); a layer not yet seen (just created) stays. */
export function useCorrectSelection() {
  const client = useLiveClient();
  const editor = useEditorStore();
  useEffect(() => {
    const seen = new Set<string>();
    const check = () => {
      const doc = client.store.state.doc;
      const selection = editor.state.selection;
      if (!doc || selection.length === 0) return;
      let gone = false;
      for (const id of selection) {
        if (doc.nodes[id]) seen.add(id);
        else if (seen.has(id)) gone = true;
      }
      if (gone) editor.actions.select(selection.filter((id) => doc.nodes[id]));
    };
    check();
    const live = client.store.subscribe(check);
    const own = editor.subscribe(check);
    return () => {
      live.unsubscribe();
      own.unsubscribe();
    };
  }, [client, editor]);
}
