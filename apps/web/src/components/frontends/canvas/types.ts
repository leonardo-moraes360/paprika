import type { ConnectorEnd, Document, Layout, Op } from "@paprika/core";
import type { ComponentType } from "react";
import type { CanvasRuntime } from "./runtime";

export type { CanvasRuntime };

/** The tools of the editor (the same names as the toolbar); the canvas reads the one in use and a gesture decides what it does. */
export type CanvasTool = "select" | "frame" | "rect" | "ellipse" | "text" | "pen" | "shape" | "diamond" | "triangle" | "cylinder" | "parallelogram" | "cloud" | "note" | "connector" | "pin";

export type CanvasRenderer = "dom" | "wasm";

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
/** A node box in world units (the unrotated rectangle and the angle it is turned by around its centre). */
export type NodeBox = Box & { rotation: number };
/** The camera: where the world origin is on the screen (px) and the scale. */
export type View = { x: number; y: number; zoom: number };

/** Everything the canvas reads from its owner. It changes often, so it never travels as a React prop (see `CanvasFeed`). */
export type CanvasInput = {
  doc: Document | null;
  /** `null` is the first page. */
  pageId: string | null;
  selection: readonly string[];
  hoveredId: string | null;
  tool: CanvasTool;
  /** 1 is 100%. The canvas applies it when it changes and mirrors its own back through `onZoomChange`. */
  zoom: number;
  /** A counter: every bump asks the canvas to fit the page. */
  fitRequest: number;
  renderer: CanvasRenderer;
};

/**
 * Where the canvas reads its input. Like `useSyncExternalStore`'s pair: `get` is the current value (the same object while
 * nothing changed) and `subscribe` calls the listener after every change. The canvas subscribes itself and writes what changed
 * into its own stores, so a delta or a click commits only the nodes and overlays it touches and never the owner.
 */
export type CanvasFeed = {
  get: () => CanvasInput;
  subscribe: (listener: () => void) => () => void;
};

export type CanvasProps = {
  feed: CanvasFeed;
  /** Selection chosen by a gesture. The owner stores it; the canvas sees it back through the feed. */
  onSelect: (ids: readonly string[]) => void;
  onHover?: (id: string | null) => void;
  /** The zoom at rest (140 ms after the last camera change). */
  onZoomChange?: (zoom: number) => void;
  /** Sends ops; resolves `false` when the server did not take them (the owner already told the person). */
  onApply?: (ops: Op[], label: string) => Promise<boolean>;
  onToolDone?: () => void;
  onError?: (message: string) => void;
  /** The paint a new vector gets (a document colour is data, so the owner supplies it): the stroke, and the fill of a closed one. */
  vectorDefaults?: VectorDefaults;
  className?: string;
};

export type VectorDefaults = { stroke: string; fill: string };

/** What a gesture may show while it runs: a node moves, grows or turns on screen before any op exists. */
export type PreviewPatch = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  /** Let the pointer through (the node being dragged). */
  inert?: boolean;
  /** A path being edited: its new outline. */
  d?: string;
  /** A connector being re-attached or bent. */
  from?: ConnectorEnd;
  to?: ConnectorEnd;
  control?: { x: number; y: number };
  /** A frame whose gap or padding is being dragged. */
  layout?: Layout;
};

/** Per-node state a node reads to paint itself (see `NodeView`). */
export type NodeFlags = { selected: boolean; hovered: boolean; editing: boolean };

/** Camera keys held down, kept outside React. */
export type CanvasInputState = { space: boolean };

export type Gesture = {
  id: string;
  /** Asked on every `pointerdown` that reaches the viewport, in the order of `gestures/index.ts`; the first `true` starts. */
  accepts: (rt: CanvasRuntime, event: PointerEvent) => boolean;
  /** Returns what to do while the pointer is down. Nothing to follow (a plain click) returns `undefined`. */
  start: (rt: CanvasRuntime, event: PointerEvent) => GestureRun | undefined;
};

export type GestureRun = {
  move?: (event: PointerEvent) => void;
  up?: (event: PointerEvent) => void;
  /** The pointer was cancelled or the canvas went away: leave nothing behind (clear the preview, remove the markers). */
  cancel?: () => void;
};

export type CanvasOverlay = {
  id: string;
  /** Rendered once in the overlay layer, in WORLD coordinates (the layer carries the camera). Read the runtime with `useCanvasRuntime()`. */
  Component: ComponentType;
};
