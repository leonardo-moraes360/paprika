import { copyOwner, instanceOwner } from "./component.js";
import type { Op } from "./ops.js";
import { round4 } from "./num.js";
import { resolveLength, modeOf } from "./style.js";
import { knownKeys, type Document, type FrameNode, type Node } from "./schema.js";

export type FlatShape = "rect" | "ellipse";
type Flat = Extract<Node, { type: "rect" | "ellipse" }>;

const FRAME_ONLY = (() => {
  const shape = knownKeys("rect");
  return [...knownKeys("frame")].filter((k) => !shape.has(k) && k !== "children" && k !== "clip");
})();

export function siblingList(doc: Document, parentId: string | null): readonly string[] {
  if (parentId === null) return doc.rootIds;
  const p = doc.nodes[parentId];
  return p && "children" in p ? p.children : [];
}

export function inFlow(doc: Document, parentId: string | null): boolean {
  const p = parentId ? doc.nodes[parentId] : undefined;
  return p?.type === "frame" && !!p.layout && p.layout.mode !== "none";
}

export function frameFromShape(doc: Document, node: Node): Record<string, unknown> {
  if (node.type !== "rect" && node.type !== "ellipse") throw new Error(`"${node.id}" is ${node.type}; only a rect or ellipse can become a frame`);
  const owner = copyOwner(doc, node);
  if (owner) throw new Error(`"${node.id}" is a copy inside the instance "${owner.id}"; edit the component or detach it`);
  const host = instanceOwner(doc, node.id);
  if (host) throw new Error(`"${host.id}" is an instance: its content comes from the component; edit the component, use overrides or detach it`);
  const next: Record<string, unknown> = { ...node, type: "frame", children: [], clip: true };
  if (node.type === "ellipse") {
    if (typeof node.width !== "number" || typeof node.height !== "number" || node.width !== node.height)
      throw new Error(`"${node.id}" is an ellipse that is not a circle (width ${String(node.width)}, height ${String(node.height)}); only a circle has a frame with the same outline, so draw it as a rect with a radius or keep it an ellipse`);
    next.radius = node.width / 2;
  }
  return next;
}

export function shapeFromFrame(doc: Document, node: Node, shape: FlatShape, radius: number | string | undefined): Record<string, unknown> {
  if (node.type !== "frame") throw new Error(`"${node.id}" is ${node.type}; convert_to_shape needs a frame`);
  const plain = node as FrameNode & Record<string, unknown>;
  const owner = copyOwner(doc, node);
  if (owner) throw new Error(`"${node.id}" is a copy inside the instance "${owner.id}"; edit the component or detach it`);
  const busy = FRAME_ONLY.filter((k) => plain[k] !== undefined);
  if (node.children.length || node.clip !== true || busy.length)
    throw new Error(
      `"${node.id}" has frame content (${[node.children.length ? "children" : "", node.clip !== true ? "clip off" : "", ...busy].filter(Boolean).join(", ")}); empty it first, only a plain frame converts back to a ${shape}`,
    );
  const next: Record<string, unknown> = { ...node, type: shape };
  delete next.children;
  delete next.clip;
  if (shape === "ellipse") {
    if (typeof node.width !== "number" || node.width !== node.height || node.radius !== node.width / 2)
      throw new Error(`"${node.id}" is not a circle frame (radius half of an equal width and height), so it is not an ellipse`);
    next.radius = radius ?? 0;
  } else if (radius !== undefined) throw new Error(`radius only restores an ellipse`);
  return next;
}

export function shapeInverse(node: Node): Op {
  const op: Record<string, unknown> = { op: "convert_to_shape", id: node.id, shape: node.type };
  if (node.type === "ellipse" && node.radius !== 0) op.radius = node.radius;
  return op as Op;
}

export function adoptPlan(doc: Document, shape: Flat, adopt: readonly string[]): Op[] {
  if (!adopt.length) return [];
  if (shape.rotation) throw new Error(`"${shape.id}" is rotated; adopting content into it would move the content, rotate it back first`);
  if (inFlow(doc, shape.parentId)) throw new Error(`"${shape.parentId}" has a layout: its children follow the flow, so content cannot be adopted into "${shape.id}"`);
  const siblings = siblingList(doc, shape.parentId);
  const unique = [...new Set(adopt)];
  const picked = unique.map((id) => {
    const n = doc.nodes[id];
    if (!n) throw new Error(`node "${id}" does not exist`);
    if (id === shape.id) throw new Error(`"${id}" cannot adopt itself`);
    if (n.type === "page") throw new Error(`"${id}" is a page`);
    if (n.type === "connector") throw new Error(`"${id}" is a connector; its position follows its ends`);
    if (n.parentId !== shape.parentId) throw new Error(`"${id}" is not a sibling of "${shape.id}" (same parent required)`);
    const owner = copyOwner(doc, n);
    if (owner) throw new Error(`"${id}" is a copy inside the instance "${owner.id}"; edit the instance instead`);
    return n;
  });
  picked.sort((a, b) => siblings.indexOf(a.id) - siblings.indexOf(b.id));
  const stroke = shape.stroke && (shape.stroke.position ?? "inside") === "inside" ? (resolveLength(doc, shape.stroke.width, modeOf(doc, shape)) ?? 0) : 0;
  const ops: Op[] = [];
  for (const n of picked) {
    ops.push({ op: "move", id: n.id, parentId: shape.id });
    ops.push({ op: "update", id: n.id, props: { x: round4(n.x - shape.x - stroke), y: round4(n.y - shape.y - stroke) } });
  }
  return ops;
}
