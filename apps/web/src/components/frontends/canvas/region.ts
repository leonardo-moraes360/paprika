import type { Document, Node } from "@paprika/core";
import type { Store, StoreActionsFactory } from "@tanstack/react-store";
import { createRegion } from "../_shared";
import { linkedPatches, sameLinked, type Linked } from "./preview-node";
import type { CanvasRenderer, CanvasTool, PreviewPatch } from "./types";

/**
 * The state of the canvas that many pieces read, each its own slice: a node asks "am I selected / hovered / being previewed",
 * so a selection or a drag renders the nodes whose answer changed and nothing else. The owner never sees it.
 */
export type CanvasState = {
  selection: readonly string[];
  /** The same ids as a set, for the per-node question. */
  selected: ReadonlySet<string>;
  hoveredId: string | null;
  tool: CanvasTool;
  /** What the gesture in progress shows, by node. A node reads only its own entry. */
  preview: Readonly<Record<string, PreviewPatch>>;
  /** The node whose content an editor (text, label) is painting over: the node hides its own so it does not show twice. */
  editingId: string | null;
  /** The renderer the owner asked for. The WASM layer follows it; what it actually paints is `painted`. */
  renderer: CanvasRenderer;
  /** The nodes the WASM layer paints (a node drops its fill, border and shadow in the DOM); empty while the DOM paints everything. */
  painted: ReadonlySet<string>;
};

export type CanvasActions = {
  setSelection: (ids: readonly string[]) => void;
  setHovered: (id: string | null) => void;
  setTool: (tool: CanvasTool) => void;
  /** Merges patches by node id; `null` removes a node's patch. */
  setPreview: (patches: Readonly<Record<string, PreviewPatch | null>>) => void;
  /** Removes the patches of `ids`, or all of them. */
  clearPreview: (ids?: readonly string[]) => void;
  setEditing: (id: string | null) => void;
  setRenderer: (renderer: CanvasRenderer) => void;
  /** Takes the set as it is: the layer hands over a new set only when the nodes it paints changed. */
  setPainted: (ids: ReadonlySet<string>) => void;
};

/** The set while the DOM paints everything (one object, so a node's selector answers `false` without a lookup that differs). */
export const NO_PAINTED: ReadonlySet<string> = new Set();

const samePatch = (a: PreviewPatch, b: PreviewPatch) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation && a.inert === b.inert && a.d === b.d && a.from === b.from && a.to === b.to && a.control === b.control && a.layout === b.layout;
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** The transitions of the canvas state (exported so a test can build a store without React). */
export const canvasActions: StoreActionsFactory<CanvasState, CanvasActions> = ({ setState }) => ({
  setSelection: (ids) =>
    setState((s) => (sameIds(s.selection, ids) ? s : { ...s, selection: [...ids], selected: new Set(ids) })),
  setHovered: (hoveredId) => setState((s) => (s.hoveredId === hoveredId ? s : { ...s, hoveredId })),
  setTool: (tool) => setState((s) => (s.tool === tool ? s : { ...s, tool })),
  setPreview: (patches) =>
    setState((s) => {
      let next: Record<string, PreviewPatch> | null = null;
      for (const [id, patch] of Object.entries(patches)) {
        const have = s.preview[id];
        if (patch === null ? have === undefined : have !== undefined && samePatch(have, patch)) continue;
        next ??= { ...s.preview };
        if (patch === null) delete next[id];
        else next[id] = patch;
      }
      return next ? { ...s, preview: next } : s;
    }),
  clearPreview: (ids) =>
    setState((s) => {
      const keys = Object.keys(s.preview);
      if (keys.length === 0) return s;
      if (!ids) return { ...s, preview: {} };
      const next = { ...s.preview };
      let touched = false;
      for (const id of ids) {
        if (!(id in next)) continue;
        delete next[id];
        touched = true;
      }
      return touched ? { ...s, preview: next } : s;
    }),
  setEditing: (editingId) => setState((s) => (s.editingId === editingId ? s : { ...s, editingId })),
  setRenderer: (renderer) => setState((s) => (s.renderer === renderer ? s : { ...s, renderer })),
  setPainted: (painted) => setState((s) => (s.painted === painted ? s : { ...s, painted })),
});

export const CanvasStateRegion = createRegion<CanvasState, CanvasActions>("Canvas", canvasActions);

export const initialCanvasState = (overrides: Partial<Pick<CanvasState, "selection" | "hoveredId" | "tool" | "renderer">> = {}): CanvasState => {
  const selection = overrides.selection ?? [];
  return { selection, selected: new Set(selection), hoveredId: overrides.hoveredId ?? null, tool: overrides.tool ?? "select", preview: {}, editingId: null, renderer: overrides.renderer ?? "dom", painted: NO_PAINTED };
};

export const CanvasProvider = CanvasStateRegion.Provider;
/** `useCanvasState(selector, compare?)`: read the narrowest slice. */
export const useCanvasState = CanvasStateRegion.useRegion;
export const useCanvasActions = CanvasStateRegion.useRegionActions;
export const useCanvasStore = CanvasStateRegion.useRegionStore;

/** What one node asks of the canvas state: its flags, its own preview and the previews of what a connector follows. */
export type NodeSlice = { flags: number; patch: PreviewPatch | undefined; linked: Linked };
export const SELECTED = 1;
export const HOVERED = 2;
export const EDITING = 4;
export const PAINTED = 8;

const sameSlice = (a: NodeSlice, b: NodeSlice) => a.flags === b.flags && a.patch === b.patch && sameLinked(a.linked, b.linked);

export type NodeSlices = {
  /** Listens to ONE node: it is called only when a write to the canvas state changed that node's slice. Returns the way to stop. */
  subscribe: (id: string, listener: () => void) => () => void;
  /** The node's slice for the state as it is: same object until the answer changes. `node` is what the node is in the document (a connector asks about what it follows). */
  read: (id: string, node: Node | null | undefined) => NodeSlice;
  /** How many slices were computed so far (what a test counts: a hover over 5 000 nodes must compute two). */
  evaluations: () => number;
};

/**
 * Per-node view of the canvas state. A write to the store is diffed once against the one before it (the selection, the hovered
 * and edited ids, the painted set and the preview by key) and only the nodes whose slice may have changed are told, so the cost of
 * a hover or a `pointermove` of a drag follows what changed, not how many nodes the page has. A connector is also told when a node it
 * follows (an end or one of the ends' ancestors) is previewed, through an index that is built once per document.
 */
export function createNodeSlices(store: Pick<Store<CanvasState>, "state" | "subscribe">, doc: () => Document): NodeSlices {
  const listeners = new Map<string, Set<() => void>>();
  const cache = new Map<string, { state: CanvasState; node: Node | null | undefined; slice: NodeSlice }>();
  let evaluations = 0;
  let prev = store.state;
  let watch: { unsubscribe: () => void } | null = null;
  let indexed: Document | null = null;
  let followers = new Map<string, string[]>();

  /** For each node, the connectors that are routed from it: attached to it or to one of its descendants, or itself. */
  const followersOf = (id: string): readonly string[] => {
    const d = doc();
    if (indexed !== d) {
      indexed = d;
      followers = new Map();
      const add = (key: string, connector: string) => {
        const list = followers.get(key);
        if (!list) followers.set(key, [connector]);
        else if (list[list.length - 1] !== connector) list.push(connector);
      };
      for (const key in d.nodes) {
        const node = d.nodes[key]!;
        if (node.type !== "connector") continue;
        add(node.id, node.id);
        for (const end of [node.from.nodeId, node.to.nodeId]) {
          for (let at = end ?? null, depth = 0; at && depth < 1000; depth += 1) {
            const held = d.nodes[at];
            if (!held || held.type === "page") break;
            add(at, node.id);
            at = held.parentId;
          }
        }
      }
    }
    return followers.get(id) ?? [];
  };

  const onState = (next: CanvasState) => {
    const before = prev;
    prev = next;
    if (listeners.size === 0) return;
    const hit = new Set<string>();
    if (before.selected !== next.selected) {
      for (const id of next.selected) if (!before.selected.has(id)) hit.add(id);
      for (const id of before.selected) if (!next.selected.has(id)) hit.add(id);
    }
    if (before.hoveredId !== next.hoveredId) {
      if (before.hoveredId !== null) hit.add(before.hoveredId);
      if (next.hoveredId !== null) hit.add(next.hoveredId);
    }
    if (before.editingId !== next.editingId) {
      if (before.editingId !== null) hit.add(before.editingId);
      if (next.editingId !== null) hit.add(next.editingId);
    }
    if (before.painted !== next.painted) {
      for (const id of next.painted) if (!before.painted.has(id)) hit.add(id);
      for (const id of before.painted) if (!next.painted.has(id)) hit.add(id);
    }
    if (before.preview !== next.preview) {
      const moved: string[] = [];
      for (const id in next.preview) if (before.preview[id] !== next.preview[id]) moved.push(id);
      for (const id in before.preview) if (!(id in next.preview)) moved.push(id);
      for (const id of moved) {
        hit.add(id);
        for (const connector of followersOf(id)) hit.add(connector);
      }
    }
    for (const id of hit) {
      const set = listeners.get(id);
      if (set) for (const listener of [...set]) listener();
    }
  };

  return {
    subscribe: (id, listener) => {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      if (!watch) {
        prev = store.state;
        watch = store.subscribe(onState);
      }
      return () => {
        set.delete(listener);
        if (set.size > 0) return;
        listeners.delete(id);
        cache.delete(id);
        if (listeners.size === 0) {
          watch?.unsubscribe();
          watch = null;
        }
      };
    },
    read: (id, node) => {
      const state = store.state;
      const have = cache.get(id);
      if (have && have.state === state && have.node === node) return have.slice;
      evaluations += 1;
      const slice: NodeSlice = {
        flags: (state.selected.has(id) ? SELECTED : 0) | (state.hoveredId === id ? HOVERED : 0) | (state.editingId === id ? EDITING : 0) | (state.painted.has(id) ? PAINTED : 0),
        patch: state.preview[id],
        linked: linkedPatches(state.preview, doc(), node),
      };
      const kept = have && sameSlice(have.slice, slice) ? have.slice : slice;
      cache.set(id, { state, node, slice: kept });
      return kept;
    },
    evaluations: () => evaluations,
  };
}
