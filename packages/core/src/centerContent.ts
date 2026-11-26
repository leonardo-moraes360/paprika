import { copyOwner, isInstance } from "./component.js";
import type { Op } from "./ops.js";
import type { Document, FrameNode, Layout, Node } from "./schema.js";

export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

export interface ContentAxes {
  horizontal: HorizontalAlign | null;
  vertical: VerticalAlign | null;
}

export type ContentKind = "text" | "icon" | "image" | "other";

export interface ContentSummary {
  count: number;
  kinds: Record<ContentKind, number>;
  only: { kind: ContentKind; label: string; x: number; y: number } | null;
}

export type ContentTarget =
  | { kind: "frame"; frame: FrameNode }
  | { kind: "empty" }
  | null;

const SUMMARY_SCAN_LIMIT = 64;

const H_FROM_EDGE = { start: "left", center: "center", end: "right" } as const;
const V_FROM_EDGE = { start: "top", center: "middle", end: "bottom" } as const;
const EDGE_FROM_H = { left: "start", center: "center", right: "end" } as const;
const EDGE_FROM_V = { top: "start", middle: "center", bottom: "end" } as const;

function pick<K extends string, V>(table: Readonly<Record<K, V>>, key: string): V | null {
  return Object.hasOwn(table, key) ? table[key as K] : null;
}

export function contentTarget(doc: Document, node: Node | undefined): ContentTarget {
  if (!node || node.type === "page") return null;
  if (node.type === "rect" || node.type === "ellipse") return copyOwner(doc, node) ? null : { kind: "empty" };
  if (node.type !== "frame" || isInstance(node) || copyOwner(doc, node)) return null;
  if (node.children.length === 0) return null;
  const mode = node.layout?.mode ?? "none";
  if (mode !== "none" && mode !== "row" && mode !== "column") return null;
  return { kind: "frame", frame: node };
}

export function contentAxes(frame: FrameNode): ContentAxes {
  const layout = frame.layout;
  if (!layout || layout.mode === "none") return { horizontal: null, vertical: null };
  const main = layout.mode === "row" ? "horizontal" : "vertical";
  const justify = pick(main === "horizontal" ? H_FROM_EDGE : V_FROM_EDGE, layout.justify);
  const align = pick(main === "horizontal" ? V_FROM_EDGE : H_FROM_EDGE, layout.align);
  return main === "horizontal"
    ? { horizontal: justify as HorizontalAlign | null, vertical: align as VerticalAlign | null }
    : { horizontal: align as HorizontalAlign | null, vertical: justify as VerticalAlign | null };
}

export function isContentCentered(frame: FrameNode): boolean {
  const axes = contentAxes(frame);
  return axes.horizontal === "center" && axes.vertical === "middle";
}

function kindOf(node: Node): ContentKind {
  if (node.type === "text") return "text";
  if (node.type === "path") return "icon";
  if (node.type === "image") return "image";
  return "other";
}

export function contentSummary(doc: Document, frame: FrameNode): ContentSummary {
  const kinds: Record<ContentKind, number> = { text: 0, icon: 0, image: 0, other: 0 };
  let only: ContentSummary["only"] = null;
  if (frame.children.length > SUMMARY_SCAN_LIMIT) {
    kinds.other = frame.children.length;
    return { count: frame.children.length, kinds, only: null };
  }
  for (const id of frame.children) {
    const child = doc.nodes[id];
    if (!child || child.type === "page") continue;
    const kind = kindOf(child);
    kinds[kind] += 1;
    only = { kind, label: child.type === "text" ? child.text : child.name, x: child.x, y: child.y };
  }
  const count = kinds.text + kinds.icon + kinds.image + kinds.other;
  return { count, kinds, only: count === 1 ? only : null };
}

function baseLayout(frame: FrameNode): Layout {
  const current = frame.layout;
  return {
    mode: current && current.mode !== "none" ? current.mode : "row",
    gap: current?.gap ?? 0,
    padding: current && current.mode !== "none" ? current.padding : 0,
    align: current?.align ?? "start",
    justify: current?.justify ?? "start",
    wrap: current?.wrap ?? false,
  };
}

export interface CenterPatch {
  horizontal?: HorizontalAlign;
  vertical?: VerticalAlign;
}

export function alignedLayout(frame: FrameNode, patch: CenterPatch): Layout {
  const next = baseLayout(frame);
  const horizontalIsJustify = next.mode === "row";
  if (patch.horizontal) {
    const edge = EDGE_FROM_H[patch.horizontal];
    if (horizontalIsJustify) next.justify = edge;
    else next.align = edge;
  }
  if (patch.vertical) {
    const edge = EDGE_FROM_V[patch.vertical];
    if (horizontalIsJustify) next.align = edge;
    else next.justify = edge;
  }
  return next;
}

export function centeredLayout(frame: FrameNode): Layout {
  return { ...alignedLayout(frame, { horizontal: "center", vertical: "middle" }), padding: 0 };
}

export function centerContentOps(doc: Document, ids: readonly string[]): { ops: Op[]; centered: boolean } {
  const frames: FrameNode[] = [];
  for (const id of ids) {
    const target = contentTarget(doc, doc.nodes[id]);
    if (target?.kind === "frame") frames.push(target.frame);
  }
  if (!frames.length) return { ops: [], centered: false };
  const undo = frames.every((f) => isContentCentered(f));
  const ops: Op[] = frames.map((f) => ({
    op: "update",
    id: f.id,
    props: { layout: undo ? null : centeredLayout(f) },
  }));
  return { ops, centered: !undo };
}

export function alignContentOps(doc: Document, id: string, patch: CenterPatch): Op[] {
  const target = contentTarget(doc, doc.nodes[id]);
  if (target?.kind !== "frame") return [];
  return [{ op: "update", id, props: { layout: alignedLayout(target.frame, patch) } }];
}
