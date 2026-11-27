import type { StoreActionsFactory } from "@tanstack/react-store";
import { createRegion } from "../_shared";
import type { CanvasTool, PreviewPatch } from "./types";

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
  /** Free slots for gestures and overlays that must see each other (a marquee, a drop marker, a pen draft): one key each, named after the piece. */
  ui: Readonly<Record<string, unknown>>;
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
  setUi: (key: string, value: unknown) => void;
};

const samePatch = (a: PreviewPatch, b: PreviewPatch) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation && a.inert === b.inert;
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
  setUi: (key, value) => setState((s) => (Object.is(s.ui[key], value) ? s : { ...s, ui: { ...s.ui, [key]: value } })),
});

export const CanvasStateRegion = createRegion<CanvasState, CanvasActions>("Canvas", canvasActions);

export const initialCanvasState = (overrides: Partial<Pick<CanvasState, "selection" | "hoveredId" | "tool">> = {}): CanvasState => {
  const selection = overrides.selection ?? [];
  return { selection, selected: new Set(selection), hoveredId: overrides.hoveredId ?? null, tool: overrides.tool ?? "select", preview: {}, editingId: null, ui: {} };
};

export const CanvasProvider = CanvasStateRegion.Provider;
/** `useCanvasState(selector, compare?)`: read the narrowest slice. */
export const useCanvasState = CanvasStateRegion.useRegion;
export const useCanvasActions = CanvasStateRegion.useRegionActions;
export const useCanvasStore = CanvasStateRegion.useRegionStore;
