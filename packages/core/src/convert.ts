import type { Document, Node, RectNode } from "./schema.js";
import { isContainer } from "./schema.js";
import type { Op } from "./ops.js";
import { copyOwner } from "./component.js";
import { modeOf, resolveCorners, usedCornerRadii } from "./style.js";

const f = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? "0" : String(v);
};

function roundedRectD(x: number, y: number, w: number, h: number, radii: [number, number, number, number]): string {
  const [tl, tr, br, bl] = radii;
  const parts = [`M${f(x + tl)} ${f(y)}`, `L${f(x + w - tr)} ${f(y)}`];
  if (tr) parts.push(`A${f(tr)} ${f(tr)} 0 0 1 ${f(x + w)} ${f(y + tr)}`);
  parts.push(`L${f(x + w)} ${f(y + h - br)}`);
  if (br) parts.push(`A${f(br)} ${f(br)} 0 0 1 ${f(x + w - br)} ${f(y + h)}`);
  parts.push(`L${f(x + bl)} ${f(y + h)}`);
  if (bl) parts.push(`A${f(bl)} ${f(bl)} 0 0 1 ${f(x)} ${f(y + h - bl)}`);
  parts.push(`L${f(x)} ${f(y + tl)}`);
  if (tl) parts.push(`A${f(tl)} ${f(tl)} 0 0 1 ${f(x + tl)} ${f(y)}`);
  parts.push("Z");
  return parts.join(" ");
}

function ellipseD(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M${f(rx)} 0 A${f(rx)} ${f(ry)} 0 0 1 ${f(rx)} ${f(h)} A${f(rx)} ${f(ry)} 0 0 1 ${f(rx)} 0 Z`;
}

function outlineD(doc: Document, node: RectNode | Extract<Node, { type: "ellipse" }>): string {
  const w = node.width as number;
  const h = node.height as number;
  if (node.type === "ellipse") return ellipseD(w, h);
  return roundedRectD(0, 0, w, h, usedCornerRadii(w, h, resolveCorners(doc, node.radius, modeOf(doc, node))));
}

function siblingIndex(doc: Document, node: Node): number {
  let list: string[] = [];
  if (node.parentId == null) list = doc.rootIds;
  else {
    const parent = doc.nodes[node.parentId];
    if (parent && isContainer(parent)) list = parent.children;
  }
  const at = list.indexOf(node.id);
  return at < 0 ? 0 : at;
}

export function convertToPathOps(doc: Document, ids: string[]): { ops: Op[] } {
  if (!ids.length) throw new Error("convert_to_path needs at least one id");
  if (ids.length > 500) throw new Error("convert_to_path accepts at most 500 ids");
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => !doc.nodes[id]);
  if (missing.length) throw new Error(`nodes do not exist: ${missing.join(", ")}`);
  const ops: Op[] = [];
  for (const id of unique) {
    const n = doc.nodes[id]!;
    if (n.type !== "rect" && n.type !== "ellipse")
      throw new Error(`"${id}" is ${n.type}; convert_to_path only accepts rect or ellipse`);
    const owner = copyOwner(doc, n);
    if (owner) throw new Error(`"${id}" is a copy inside the instance "${owner.id}"; edit the component or detach it`);
    if (typeof n.width !== "number" || typeof n.height !== "number")
      throw new Error(`"${id}" needs a numeric width and height`);
    const node: Record<string, unknown> = {
      type: "path",
      id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      d: outlineD(doc, n),
    };
    if (n.name) node.name = n.name;
    if (n.rotation) node.rotation = n.rotation;
    if (n.opacity !== 1) node.opacity = n.opacity;
    if (!n.visible) node.visible = n.visible;
    if (n.locked) node.locked = n.locked;
    if (n.layoutPositioning) node.layoutPositioning = n.layoutPositioning;
    if (n.constraints) node.constraints = n.constraints;
    if (n.fill) node.fill = n.fill;
    if (n.gradient) node.gradient = n.gradient;
    if (n.stroke) node.stroke = n.stroke;
    if (n.shadow) node.shadow = n.shadow;
    if (n.outline) node.outline = n.outline;
    if (n.filter) node.filter = n.filter;
    if (n.backdropFilter) node.backdropFilter = n.backdropFilter;
    if (n.notes) node.notes = n.notes;
    if (n.lintIgnore) node.lintIgnore = n.lintIgnore;
    const index = siblingIndex(doc, n);
    ops.push({ op: "delete", id });
    ops.push({ op: "create", parentId: n.parentId, index, node: node as Extract<Op, { op: "create" }>["node"] });
  }
  return { ops };
}
