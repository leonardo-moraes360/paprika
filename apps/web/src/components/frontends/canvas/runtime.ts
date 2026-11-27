import type { Document, Op } from "@paprika/core";
import type { Store } from "@tanstack/react-store";
import { createContext, useContext } from "react";
import { elementOf, measureElement, nodeIdOf, toWorld } from "./geometry";
import type { PreviewController } from "./preview";
import type { CanvasActions, CanvasState } from "./region";
import type { RenderStore } from "./render-index";
import type { CanvasInputState, CanvasTool, NodeBox, Pt } from "./types";
import type { ViewStore } from "./view-store";

export type PanMode = "off" | "ready" | "panning";

/**
 * What a gesture or an overlay gets, all stable for the life of the canvas. The `on*` callbacks go to the owner and always
 * reach the latest ones; `doc()`, `selection()` and `tool()` read the latest values, so keep a gesture from holding a copy.
 */
export type CanvasRuntime = {
  view: ViewStore;
  index: RenderStore;
  /** State and actions of the canvas region (`store.state`, `store.actions`). In a component, read it with `useCanvasState`. */
  store: Store<CanvasState, CanvasActions>;
  preview: PreviewController;
  /** Keys held down. */
  input: CanvasInputState;
  viewport: () => HTMLElement | null;
  world: () => HTMLElement | null;
  doc: () => Document;
  /** The page in view (`null` is the first page). */
  pageId: () => string | null;
  tool: () => CanvasTool;
  selection: () => readonly string[];
  /** Screen (client) point to world. */
  toWorld: (clientX: number, clientY: number) => Pt;
  /** Box of a node in world units, read from the DOM. Reads layout: group the calls and read before you write. */
  measure: (id: string) => NodeBox | null;
  /** The node an event target belongs to, if the document has it. */
  nodeAt: (target: EventTarget | null) => string | null;
  setPan: (mode: PanMode) => void;
  select: (ids: readonly string[]) => void;
  hover: (id: string | null) => void;
  /** `true` once the server took the ops. Never throws. */
  apply: (ops: Op[], label: string) => Promise<boolean>;
  toolDone: () => void;
  error: (message: string) => void;
};

export type RuntimeParts = {
  view: ViewStore;
  index: RenderStore;
  store: Store<CanvasState, CanvasActions>;
  preview: PreviewController;
  viewport: () => HTMLElement | null;
  world: () => HTMLElement | null;
  pageId: () => string | null;
  /** The owner's callbacks, read at call time. */
  callbacks: () => {
    select: (ids: readonly string[]) => void;
    hover?: (id: string | null) => void;
    apply?: (ops: Op[], label: string) => Promise<boolean>;
    toolDone?: () => void;
    error?: (message: string) => void;
  };
};

export function createRuntime(parts: RuntimeParts): CanvasRuntime {
  const { view, index, store, preview, viewport, world, pageId, callbacks } = parts;
  const input: CanvasInputState = { space: false };
  return {
    view,
    index,
    store,
    preview,
    input,
    viewport,
    world,
    doc: index.doc,
    pageId,
    tool: () => store.state.tool,
    selection: () => store.state.selection,
    toWorld: (clientX, clientY) => {
      const rect = viewport()?.getBoundingClientRect();
      return toWorld(view.get(), rect ?? { left: 0, top: 0 }, clientX, clientY);
    },
    measure: (id) => {
      const vp = viewport();
      const el = vp ? elementOf(vp, id) : null;
      if (!vp || !el) return null;
      const node = index.doc().nodes[id];
      const rotation = node && node.type !== "group" && node.type !== "connector" && node.type !== "page" ? node.rotation : 0;
      return measureElement(el, vp.getBoundingClientRect(), view.get(), rotation);
    },
    nodeAt: (target) => {
      const id = nodeIdOf(target);
      return id && index.doc().nodes[id] ? id : null;
    },
    setPan: (mode) => {
      const vp = viewport();
      if (!vp) return;
      if (mode === "off") delete vp.dataset.pan;
      else vp.dataset.pan = mode;
    },
    select: (ids) => callbacks().select(ids),
    hover: (id) => callbacks().hover?.(id),
    apply: async (ops, label) => {
      const apply = callbacks().apply;
      if (!apply) return false;
      try {
        return await apply(ops, label);
      } catch {
        return false;
      }
    },
    toolDone: () => callbacks().toolDone?.(),
    error: (message) => callbacks().error?.(message),
  };
}

export const CanvasRuntimeContext = createContext<CanvasRuntime | null>(null);

export function useCanvasRuntime(): CanvasRuntime {
  const rt = useContext(CanvasRuntimeContext);
  if (!rt) throw new Error("useCanvasRuntime used outside a Canvas");
  return rt;
}
