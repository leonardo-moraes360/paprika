import { createRegion, shallow } from "@/components/frontends/_shared";

/**
 * State of ONE open editor (made per instance by `EditorProvider`, never shared, never at module scope).
 * It holds only what the regions share and the server does not know: the document itself lives in the live store
 * (`useLive`). Later work adds fields and actions, it never renames or removes one.
 */

export const editorTools = ["select", "frame", "rect", "ellipse", "text", "pen", "shape", "diamond", "triangle", "cylinder", "parallelogram", "cloud", "note", "connector", "pin"] as const;
export type EditorTool = (typeof editorTools)[number];

export const editorRightTabs = ["properties", "team"] as const;
export type EditorRightTab = (typeof editorRightTabs)[number];

export type EditorRenderer = "dom" | "wasm";

/** Panels and dialogs that open over the editor. `team` is the right panel's team tab, `agents` the roster popover. */
export const editorDialogs = ["history", "pins", "export", "import", "agents", "team"] as const;
export type EditorDialog = (typeof editorDialogs)[number];

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;

export type EditorState = {
  /** Selected node ids, in selection order (the last one is the primary). */
  selection: readonly string[];
  /** Page in view; `null` means the first page of the document. */
  pageId: string | null;
  tool: EditorTool;
  /** 1 is 100%. The canvas reads it; until there is one, only the zoom bar writes it. */
  zoom: number;
  /** Counter the zoom bar bumps to ask the canvas to fit the selection or the page. */
  fitRequest: number;
  renderer: EditorRenderer;
  rightTab: EditorRightTab;
  dialogs: Record<EditorDialog, boolean>;
  /** Layer under the pointer in the layers panel (so the canvas can outline it). */
  hoveredId: string | null;
  /** Pin selected in the pins list or on the canvas. */
  pinId: string | null;
};

export type EditorActions = {
  select: (ids: readonly string[]) => void;
  toggleSelected: (id: string) => void;
  addToSelection: (ids: readonly string[]) => void;
  clearSelection: () => void;
  setPage: (pageId: string | null) => void;
  setTool: (tool: EditorTool) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  setRenderer: (renderer: EditorRenderer) => void;
  setRightTab: (tab: EditorRightTab) => void;
  openDialog: (dialog: EditorDialog) => void;
  closeDialog: (dialog: EditorDialog) => void;
  toggleDialog: (dialog: EditorDialog) => void;
  setHovered: (id: string | null) => void;
  setPin: (id: string | null) => void;
};

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export function initialEditorState(overrides: Partial<EditorState> = {}): EditorState {
  return {
    selection: [],
    pageId: null,
    tool: "select",
    zoom: 1,
    fitRequest: 0,
    renderer: "dom",
    rightTab: "properties",
    dialogs: { history: false, pins: false, export: false, import: false, agents: false, team: false },
    hoveredId: null,
    pinId: null,
    ...overrides,
  };
}

const setDialog = (state: EditorState, dialog: EditorDialog, open: boolean): EditorState =>
  state.dialogs[dialog] === open ? state : { ...state, dialogs: { ...state.dialogs, [dialog]: open } };

export const EditorRegion = createRegion<EditorState, EditorActions>("Editor", ({ setState }) => ({
  select: (ids) => setState((s) => (sameIds(s.selection, ids) ? s : { ...s, selection: [...ids] })),
  toggleSelected: (id) => setState((s) => ({ ...s, selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
  addToSelection: (ids) =>
    setState((s) => {
      const fresh = ids.filter((id) => !s.selection.includes(id));
      return fresh.length === 0 ? s : { ...s, selection: [...s.selection, ...fresh] };
    }),
  clearSelection: () => setState((s) => (s.selection.length === 0 ? s : { ...s, selection: [] })),
  setPage: (pageId) => setState((s) => (s.pageId === pageId ? s : { ...s, pageId, selection: [] })),
  setTool: (tool) => setState((s) => (s.tool === tool ? s : { ...s, tool })),
  setZoom: (zoom) => setState((s) => (s.zoom === clampZoom(zoom) ? s : { ...s, zoom: clampZoom(zoom) })),
  zoomIn: () => setState((s) => (s.zoom >= MAX_ZOOM ? s : { ...s, zoom: clampZoom(s.zoom * ZOOM_STEP) })),
  zoomOut: () => setState((s) => (s.zoom <= MIN_ZOOM ? s : { ...s, zoom: clampZoom(s.zoom / ZOOM_STEP) })),
  fit: () => setState((s) => ({ ...s, fitRequest: s.fitRequest + 1 })),
  setRenderer: (renderer) => setState((s) => (s.renderer === renderer ? s : { ...s, renderer })),
  setRightTab: (rightTab) => setState((s) => (s.rightTab === rightTab ? s : { ...s, rightTab })),
  openDialog: (dialog) => setState((s) => setDialog(s, dialog, true)),
  closeDialog: (dialog) => setState((s) => setDialog(s, dialog, false)),
  toggleDialog: (dialog) => setState((s) => setDialog(s, dialog, !s.dialogs[dialog])),
  setHovered: (hoveredId) => setState((s) => (s.hoveredId === hoveredId ? s : { ...s, hoveredId })),
  setPin: (pinId) => setState((s) => (s.pinId === pinId ? s : { ...s, pinId })),
}));

export const EditorProvider = EditorRegion.Provider;
/** `useEditor(selector, compare?)`: read the narrowest slice, e.g. `useEditor((s) => s.dialogs.history)`. */
export const useEditor = EditorRegion.useRegion;
/** Stable for the life of the editor. */
export const useEditorActions = EditorRegion.useRegionActions;
export const useEditorStore = EditorRegion.useRegionStore;
export { shallow };
