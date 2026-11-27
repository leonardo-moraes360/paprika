import { createRegion, shallow } from "@/components/frontends/_shared";
import type { AgentEntry } from "@/components/frontends/agents";

/**
 * State of ONE open editor (made per instance by `EditorProvider`, never shared, never at module scope).
 * It holds only what the regions share and the server does not know: the document itself lives in the live store
 * (`useLive`). Parallel work adds fields and actions and never renames or removes one; the only removal so far is `dialogs.team`, dead code left by the join of the batches (the team became the `rightTab`).
 */

export const editorTools = ["select", "frame", "rect", "ellipse", "text", "pen", "shape", "diamond", "triangle", "cylinder", "parallelogram", "cloud", "note", "connector", "pin"] as const;
export type EditorTool = (typeof editorTools)[number];

export const editorRightTabs = ["properties", "team"] as const;
export type EditorRightTab = (typeof editorRightTabs)[number];

export type EditorRenderer = "dom" | "wasm";

/** Panels and dialogs that open over the editor. `agents` is the roster popover; the team is a tab of the right panel (`rightTab`), not a dialog. */
export const editorDialogs = ["history", "pins", "export", "import", "agents"] as const;
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
  /** Tone of each agent client (`actor`), given on first sight and kept for the life of the editor (batch 4: roster, pins, workspace notice). */
  agentTones: Readonly<Record<string, AgentColor>>;
  /** What the pin tool pointed at on the canvas (a node with its box, or an area), while the new-pin form is open. Cleared when the tool changes. */
  pinPoint: PinPoint | null;
  /** Where the canvas is asked to take the camera (an agent, a pin, nodes); every request is a new object with its own `seq`. */
  focusRequest: FocusRequest | null;
  /** The eyedropper armed over the canvas: the colour of the next click goes to this callback (the picker that asked for it). */
  sampler: ((color: string) => void) | null;
};

export type PinPoint = { nodeId: string | null; region: { x: number; y: number; width: number; height: number } };
export type FocusRequest = { seq: number; nodes?: readonly string[]; box?: { x: number; y: number; width: number; height: number } };

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
  /** Gives a tone to each actor that has none yet, in order of arrival, cycling through the four tones. */
  assignAgentTones: (actors: readonly string[]) => void;
  setPinPoint: (point: PinPoint | null) => void;
  /** Takes the canvas camera to nodes (their boxes) or to a box. */
  focus: (target: { nodes?: readonly string[]; box?: FocusRequest["box"] }) => void;
  /** Arms the canvas eyedropper; `onColor` is called with the colour of the click, and the eyedropper disarms. */
  beginSampling: (onColor: (color: string) => void) => void;
  endSampling: () => void;
};

type AgentColor = AgentEntry["tone"];
const agentColors: readonly AgentColor[] = ["agent-1", "agent-2", "agent-3", "agent-4"];

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
    dialogs: { history: false, pins: false, export: false, import: false, agents: false },
    hoveredId: null,
    pinId: null,
    agentTones: {},
    pinPoint: null,
    focusRequest: null,
    sampler: null,
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
  setTool: (tool) => setState((s) => (s.tool === tool ? s : { ...s, tool, pinPoint: tool === "pin" ? s.pinPoint : null })),
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
  setPinPoint: (pinPoint) => setState((s) => (s.pinPoint === pinPoint ? s : { ...s, pinPoint })),
  focus: (target) => setState((s) => ({ ...s, focusRequest: { ...target, seq: (s.focusRequest?.seq ?? 0) + 1 } })),
  beginSampling: (onColor) => setState((s) => ({ ...s, sampler: onColor })),
  endSampling: () => setState((s) => (s.sampler === null ? s : { ...s, sampler: null })),
  assignAgentTones: (actors) =>
    setState((s) => {
      const fresh = actors.filter((actor, i) => !(actor in s.agentTones) && actors.indexOf(actor) === i);
      if (fresh.length === 0) return s;
      const next: Record<string, AgentColor> = { ...s.agentTones };
      for (const actor of fresh) next[actor] = agentColors[Object.keys(next).length % agentColors.length]!;
      return { ...s, agentTones: next };
    }),
}));

export const EditorProvider = EditorRegion.Provider;
/** `useEditor(selector, compare?)`: read the narrowest slice, e.g. `useEditor((s) => s.dialogs.history)`. */
export const useEditor = EditorRegion.useRegion;
/** Stable for the life of the editor. */
export const useEditorActions = EditorRegion.useRegionActions;
export const useEditorStore = EditorRegion.useRegionStore;
export { shallow };
