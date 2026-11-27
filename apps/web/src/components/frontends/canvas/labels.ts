import { FORMAT, shapeDefaults, type Document, type Node, type ShapeKind, type ShapeNode } from "@paprika/core";
import type { CanvasTool } from "./types";

/** The tools that draw a node by dragging a box (or by a click, with the default size). */
export type DraftTool = "frame" | "rect" | "ellipse" | "text" | "shape" | "diamond" | "triangle" | "cylinder" | "parallelogram" | "cloud" | "note";

const DRAFT_TOOLS: ReadonlySet<string> = new Set<DraftTool>(["frame", "rect", "ellipse", "text", "shape", "diamond", "triangle", "cylinder", "parallelogram", "cloud", "note"]);
export const isDraftTool = (tool: CanvasTool): tool is DraftTool => DRAFT_TOOLS.has(tool);

/** The diagram tools make a `shape` node; this is the `shape` kind of each one. */
export const SHAPE_KINDS = { shape: "rect", diamond: "diamond", triangle: "triangle", cylinder: "cylinder", parallelogram: "parallelogram", cloud: "cloud", note: "note" } as const satisfies Record<string, ShapeKind>;
export type ShapeTool = keyof typeof SHAPE_KINDS;
export const isShapeTool = (tool: DraftTool): tool is ShapeTool => tool in SHAPE_KINDS;

/** Width and height of a click that did not drag, as the old canvas had them. */
export const DRAFT_DEFAULTS: Readonly<Record<DraftTool, readonly [number, number]>> = {
  frame: [390, 844],
  rect: [120, 80],
  ellipse: [80, 80],
  text: [200, 32],
  shape: [160, 80],
  diamond: [160, 100],
  triangle: [160, 140],
  cylinder: [160, 120],
  parallelogram: [160, 100],
  cloud: [180, 110],
  note: [160, 160],
};

/** A drag smaller than this (in both directions, in the parent's units) is a click. */
export const CLICK_SIZE = 4;

/** A colour written into the document (the fill of a new node). It is document data, not a colour of this interface, so it is spelled as the document spells it. */
const docColor = (digits: string) => `#${digits}`;

/** The path of the i18n entry of each tool's default name (`frontends.canvas.names.<tool>`). */
export const nameKey = (tool: DraftTool) => `names.${tool}`;

/** The number a new node of `tool` gets in its name: how many nodes of its kind the document already has, plus one (as the old canvas did). */
export function nextNumber(doc: Document, tool: DraftTool): number {
  let count = 0;
  for (const node of Object.values(doc.nodes)) {
    if (isShapeTool(tool) ? node.type === "shape" && node.shape === SHAPE_KINDS[tool] : node.type === tool) count++;
  }
  return count + 1;
}

/** The fill a node of `tool` gets (the diagram shapes take theirs from the core's defaults on the server). */
const FILLS: Partial<Record<DraftTool, string>> = { frame: docColor("ffffff"), rect: docColor("d9d4cf"), ellipse: docColor("d9d4cf") };

/** The node a creation sends: only what differs from the core's defaults, as the old canvas sent it. */
export function creationNode(tool: DraftTool, props: { id: string; name: string; x: number; y: number; width: number; height: number }): Record<string, unknown> {
  const node: Record<string, unknown> = { type: tool, ...props };
  const fill = FILLS[tool];
  if (fill) node.fill = fill;
  if (tool === "text") Object.assign(node, { text: "Texto", height: "hug" });
  if (isShapeTool(tool)) Object.assign(node, { type: "shape", shape: SHAPE_KINDS[tool] });
  return node;
}

/** The node the ghost draws while the pointer is down: the node a click would create, with every property spelled out so it paints without a document. */
export function ghostNode(tool: DraftTool, width: number, height: number): Node {
  const base = { id: "draft-ghost", name: "", parentId: null as string | null, x: 0, y: 0, width, height, rotation: 0, opacity: 1, visible: true, locked: false, radius: 0 };
  if (tool === "frame") return { ...base, type: "frame", fill: FILLS.frame, children: [], clip: true } as Node;
  if (tool === "rect" || tool === "ellipse") return { ...base, type: tool, fill: FILLS[tool] } as Node;
  if (tool === "text") {
    return { ...base, type: "text", text: "Texto", color: docColor("111111"), fontFamily: "Inter, system-ui, sans-serif", fontSize: 16, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0, textAlign: "left", height: "hug" } as Node;
  }
  const kind = SHAPE_KINDS[tool];
  return {
    ...base,
    type: "shape",
    shape: kind,
    text: "",
    color: docColor("1e2336"),
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 16,
    fontWeight: 500,
    lineHeight: 1.3,
    textAlign: kind === "note" ? "left" : "center",
    ...shapeDefaults(kind),
    width,
    height,
  } as ShapeNode;
}

/** A document of one node, to paint the ghost with the tokens and modes of the real one. */
export const ghostDocument = (doc: Document, node: Node): Document => ({ format: FORMAT, id: "ghost", name: "", tokens: doc.tokens, modes: doc.modes, rootIds: [node.id], nodes: { [node.id]: node } });

/** The box a drag from `a` to `b` draws, or the default size at `a` for a click. `x` and `y` are rounded like the node sent. */
export function draftBox(tool: DraftTool, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; width: number; height: number; clicked: boolean } {
  const clicked = Math.abs(b.x - a.x) < CLICK_SIZE && Math.abs(b.y - a.y) < CLICK_SIZE;
  let [width, height] = clicked ? DRAFT_DEFAULTS[tool] : [Math.round(Math.abs(b.x - a.x)), Math.round(Math.abs(b.y - a.y))];
  return { x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)), width: Math.max(1, width), height: Math.max(1, height), clicked };
}
