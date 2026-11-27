import type { Store } from "@tanstack/react-store";
import type { CanvasFeed, CanvasInput } from "@/components/frontends/canvas";
import { resolvePageId } from "@/adapters/pages";
import type { LiveState } from "@/data/live";
import type { EditorActions, EditorState } from "./editor-store";

type EditorStore = Store<EditorState, EditorActions>;

const same = (a: CanvasInput, b: CanvasInput) =>
  a.doc === b.doc &&
  a.pageId === b.pageId &&
  a.selection === b.selection &&
  a.hoveredId === b.hoveredId &&
  a.tool === b.tool &&
  a.zoom === b.zoom &&
  a.fitRequest === b.fitRequest &&
  a.renderer === b.renderer;

/**
 * The canvas' input from the two stores it depends on: the document (live) and what the editor shares (selection, page, tool,
 * zoom, hover). `get` gives the same object until one of the values changes, so the canvas ignores a change that is not its own
 * (presence, activity, a dialog opening) without looking at it twice.
 */
export function createEditorFeed(live: Store<LiveState>, editor: EditorStore): CanvasFeed {
  let last: CanvasInput | null = null;
  const get = (): CanvasInput => {
    const doc = live.state.doc;
    const e = editor.state;
    const next: CanvasInput = { doc, pageId: resolvePageId(doc, e.pageId), selection: e.selection, hoveredId: e.hoveredId, tool: e.tool, zoom: e.zoom, fitRequest: e.fitRequest, renderer: e.renderer };
    if (last && same(last, next)) return last;
    last = next;
    return next;
  };
  return {
    get,
    subscribe: (listener) => {
      const a = live.subscribe(listener);
      const b = editor.subscribe(listener);
      return () => {
        a.unsubscribe();
        b.unsubscribe();
      };
    },
  };
}
