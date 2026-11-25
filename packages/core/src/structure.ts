import type { NodeInput, Op } from "./ops.js";
import { round4 } from "./num.js";
import type { PlaceSpec } from "./placement.js";
import { newId } from "./id.js";
import { defaultPageName } from "./names.js";
import { copyOwner, scaleGeometry } from "./component.js";
import { layout } from "./layout.js";
import { firstPage, isContainer, isScene, type Document, type Node as NodeT, type SceneNode } from "./schema.js";

function siblingsOf(doc: Document, parentId: string | null): string[] {
  if (parentId === null) return doc.rootIds;
  const p = doc.nodes[parentId];
  return isContainer(p) ? p.children : [];
}

export const REPEAT_MODES = ["radial", "linear", "grid"] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

export interface RepeatOptions {
  count: number;
  mode: RepeatMode;
  center?: { x: number; y: number };
  angle?: number;
  rotate?: boolean;
  step?: { x?: number; y?: number };
  columns?: number;
  rows?: number;
  gap?: number;
}

const REPEAT_ONLY: Record<RepeatMode, readonly (keyof RepeatOptions)[]> = {
  radial: ["center", "angle", "rotate"],
  linear: ["step"],
  grid: ["columns", "rows", "gap"],
};

export function repeatOps(doc: Document, id: string, opts: RepeatOptions): DuplicatePlan {
  const src = doc.nodes[id];
  if (!src) throw new Error(`node "${id}" does not exist`);
  const { count, mode } = opts;
  if (!(REPEAT_MODES as readonly string[]).includes(mode)) throw new Error(`unknown mode "${mode}"; use radial, linear or grid`);
  if (!Number.isInteger(count) || count < 2 || count > 500) throw new Error("count must be a whole number from 2 to 500 (the source counts as one)");
  for (const m of REPEAT_MODES) {
    if (m === mode) continue;
    const bad = REPEAT_ONLY[m].filter((k) => opts[k] !== undefined);
    if (bad.length) throw new Error(`${bad.join(", ")} only work with mode "${m}", not "${mode}"`);
  }
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const rec = src as Record<string, unknown>;
  const x0 = num(rec.x) ?? 0;
  const y0 = num(rec.y) ?? 0;
  const size = (): { w: number; h: number } => {
    const w = num(rec.width);
    const h = num(rec.height);
    if (w === undefined || h === undefined) throw new Error(`mode "${mode}" needs "${id}" to have a numeric width and height`);
    return { w, h };
  };

  let place: (k: number) => { x: number; y: number; rotation?: number };
  if (mode === "radial") {
    const { w, h } = size();
    const parent = src.parentId ? doc.nodes[src.parentId] : undefined;
    let cx: number;
    let cy: number;
    if (opts.center) {
      cx = opts.center.x;
      cy = opts.center.y;
    } else {
      const pw = num((parent as Record<string, unknown> | undefined)?.width);
      const ph = num((parent as Record<string, unknown> | undefined)?.height);
      if (!parent || parent.type === "page" || pw === undefined || ph === undefined)
        throw new Error(`"${id}" is not inside a sized frame: pass center {x, y} for the orbit`);
      cx = pw / 2;
      cy = ph / 2;
    }
    if (!Number.isFinite(cx + cy)) throw new Error("center must be finite numbers");
    const angle = opts.angle ?? 360;
    if (!Number.isFinite(angle) || angle === 0) throw new Error("angle must be a non-zero number of degrees");
    const stepAngle = Math.abs(angle) >= 360 ? angle / count : angle / (count - 1);
    const dx = x0 + w / 2 - cx;
    const dy = y0 + h / 2 - cy;
    if (Math.hypot(dx, dy) < 1e-6) throw new Error(`"${id}" is centered on the orbit center, so every copy would land on it: move it away or pass another center`);
    const rot0 = num(rec.rotation) ?? 0;
    place = (k) => {
      const a = (stepAngle * k * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const r: { x: number; y: number; rotation?: number } = { x: round4(cx + dx * cos - dy * sin - w / 2), y: round4(cy + dx * sin + dy * cos - h / 2) };
      if (opts.rotate) r.rotation = round4(rot0 + stepAngle * k);
      return r;
    };
  } else if (mode === "linear") {
    if (!opts.step) throw new Error("mode linear needs step {x, y}");
    const sx = opts.step.x ?? 0;
    const sy = opts.step.y ?? 0;
    if (!Number.isFinite(sx + sy)) throw new Error("step must be finite numbers");
    if (sx === 0 && sy === 0) throw new Error("step is 0, 0: every copy would land on the source");
    place = (k) => ({ x: round4(x0 + sx * k), y: round4(y0 + sy * k) });
  } else {
    const { w, h } = size();
    const columns = opts.columns;
    if (columns === undefined || !Number.isInteger(columns) || columns < 1 || columns > 500) throw new Error("mode grid needs columns (a whole number from 1 to 500)");
    if (opts.rows !== undefined && (!Number.isInteger(opts.rows) || opts.rows < 1)) throw new Error("rows must be a whole number from 1");
    if (opts.rows !== undefined && opts.rows * columns < count) throw new Error(`${columns} columns x ${opts.rows} rows hold ${opts.rows * columns} nodes, count is ${count}`);
    const gap = opts.gap ?? 0;
    if (!Number.isFinite(gap)) throw new Error("gap must be a finite number");
    place = (k) => ({ x: round4(x0 + (k % columns) * (w + gap)), y: round4(y0 + Math.floor(k / columns) * (h + gap)) });
  }

  const plan: DuplicatePlan = { ops: [], copies: [], map: {} };
  for (let k = 1; k < count; k++) {
    const one = duplicateOps(doc, [id], { offset: 0 });
    const op = one.ops[0] as { node: Record<string, unknown> };
    const at = place(k);
    op.node.x = at.x;
    op.node.y = at.y;
    if (at.rotation !== undefined) op.node.rotation = at.rotation;
    plan.ops.push(...one.ops);
    plan.copies.push(...one.copies);
    for (const [from, to] of Object.entries(one.map)) plan.map[`${from}#${k}`] = to;
  }
  return plan;
}

const ARRANGE_EPS = 1e-3;

export type AlignEdge = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";
export type RevealKind = "hidden" | "locked";

export function localBox(n: NodeT, size?: { width: number; height: number }): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!isScene(n)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const w = size?.width ?? (typeof n.width === "number" ? n.width : 0);
  const h = size?.height ?? (typeof n.height === "number" ? n.height : 0);
  const rotation = n.type === "group" || n.type === "connector" ? 0 : n.rotation;
  if (!rotation) return { minX: n.x, minY: n.y, maxX: n.x + w, maxY: n.y + h };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const hw = (w * cos + h * sin) / 2;
  const hh = (w * sin + h * cos) / 2;
  const cx = n.x + w / 2;
  const cy = n.y + h / 2;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}

type ArrangeAction = "align" | "distribute" | "wrap";

function siblingSelection(doc: Document, ids: readonly string[], action: ArrangeAction, min: number): SceneNode[] {
  if (ids.length < min) {
    const noun = min === 1 ? "one id" : `${min} ids`;
    throw new Error(`pass at least ${noun} to ${action}`);
  }
  const unique = [...new Set(ids)];
  if (unique.length < min) {
    const noun = min === 1 ? "one id" : `${min} ids`;
    throw new Error(`pass at least ${noun} to ${action}`);
  }
  const missing = unique.filter((id) => !doc.nodes[id]);
  if (missing.length) throw new Error(`nodes do not exist: ${missing.join(", ")}`);
  const nodes: SceneNode[] = [];
  for (const id of unique) {
    const n = doc.nodes[id]!;
    if (!isScene(n)) throw new Error(`"${n.id}" is a page`);
    if (n.type === "connector") throw new Error(`"${n.id}" is a connector; its position follows its ends`);
    const owner = copyOwner(doc, n);
    if (owner) throw new Error(`"${n.id}" is a copy inside the instance "${owner.id}"; edit the instance instead`);
    nodes.push(n);
  }
  const parentId = nodes[0]!.parentId;
  const other = nodes.find((n) => n.parentId !== parentId);
  if (other)
    throw new Error(
      `only nodes with the same parent can be ${action === "align" ? "aligned" : action === "distribute" ? "distributed" : "wrapped"} ("${other.id}" is in ${other.parentId ?? "canvas"}, "${nodes[0]!.id}" in ${parentId ?? "canvas"})`,
    );
  const parent = parentId ? doc.nodes[parentId] : undefined;
  if (parent?.type === "frame" && parent.layout && parent.layout.mode !== "none")
    throw new Error(
      `"${parent.id}" has layout ${parent.layout.mode}: its children follow the flow and cannot be ${action === "align" ? "aligned" : action === "distribute" ? "distributed" : "wrapped"}; set the layout to none`,
    );
  return nodes;
}

function boxesOf(doc: Document, nodes: readonly SceneNode[]): Map<string, { minX: number; minY: number; maxX: number; maxY: number }> {
  const need = nodes.filter((n) => typeof n.width !== "number" || typeof n.height !== "number").map((n) => n.id);
  const laid = need.length ? layout(doc, { ids: need }) : {};
  const out = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const n of nodes) {
    const w = typeof n.width === "number" ? n.width : laid[n.id]?.width;
    const h = typeof n.height === "number" ? n.height : laid[n.id]?.height;
    if (w === undefined || h === undefined) throw new Error(`"${n.id}" has no numeric width or height`);
    out.set(n.id, localBox(n, { width: w, height: h }));
  }
  return out;
}

export function alignOps(doc: Document, ids: readonly string[], edge: AlignEdge): { ops: Op[] } {
  if (!["left", "center", "right", "top", "middle", "bottom"].includes(edge))
    throw new Error("edge must be left, center, right, top, middle or bottom");
  const nodes = siblingSelection(doc, ids, "align", 2);
  const boxes = boxesOf(doc, nodes);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const b = boxes.get(n.id)!;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const ops: Op[] = [];
  const horizontal = edge === "left" || edge === "center" || edge === "right";
  for (const n of nodes) {
    const b = boxes.get(n.id)!;
    const delta =
      edge === "left" ? minX - b.minX
      : edge === "right" ? maxX - b.maxX
      : edge === "center" ? (minX + maxX) / 2 - (b.minX + b.maxX) / 2
      : edge === "top" ? minY - b.minY
      : edge === "bottom" ? maxY - b.maxY
      : (minY + maxY) / 2 - (b.minY + b.maxY) / 2;
    const next = round4((horizontal ? n.x : n.y) + delta);
    if (Math.abs(next - (horizontal ? n.x : n.y)) < ARRANGE_EPS) continue;
    ops.push({ op: "update", id: n.id, props: horizontal ? { x: next } : { y: next } });
  }
  return { ops };
}

export function distributeOps(doc: Document, ids: readonly string[], axis: DistributeAxis): { ops: Op[] } {
  if (axis !== "horizontal" && axis !== "vertical") throw new Error("axis must be horizontal or vertical");
  const nodes = siblingSelection(doc, ids, "distribute", 3);
  const boxes = boxesOf(doc, nodes);
  const siblings = siblingsOf(doc, nodes[0]!.parentId);
  const items = nodes
    .map((n) => ({ n, box: boxes.get(n.id)! }))
    .sort((a, b) => {
      const ka = axis === "horizontal" ? a.box.minX : a.box.minY;
      const kb = axis === "horizontal" ? b.box.minX : b.box.minY;
      if (ka !== kb) return ka - kb;
      return siblings.indexOf(a.n.id) - siblings.indexOf(b.n.id);
    });
  const first = axis === "horizontal" ? items[0]!.box.minX : items[0]!.box.minY;
  const last = axis === "horizontal" ? items[items.length - 1]!.box.maxX : items[items.length - 1]!.box.maxY;
  const sum = items.reduce((s, it) => s + ((axis === "horizontal" ? it.box.maxX - it.box.minX : it.box.maxY - it.box.minY)), 0);
  const gap = (last - first - sum) / (items.length - 1);
  let cursor = first;
  const ops: Op[] = [];
  for (const it of items) {
    const size = axis === "horizontal" ? it.box.maxX - it.box.minX : it.box.maxY - it.box.minY;
    const edge = axis === "horizontal" ? it.box.minX : it.box.minY;
    const next = round4((axis === "horizontal" ? it.n.x : it.n.y) + (cursor - edge));
    if (Math.abs(next - (axis === "horizontal" ? it.n.x : it.n.y)) >= ARRANGE_EPS)
      ops.push({ op: "update", id: it.n.id, props: axis === "horizontal" ? { x: next } : { y: next } });
    cursor += size + gap;
  }
  return { ops };
}

export function wrapOps(doc: Document, ids: readonly string[], opts: { id?: string; name?: string } = {}): { ops: Op[]; id: string } {
  const nodes = siblingSelection(doc, ids, "wrap", 1);
  const boxes = boxesOf(doc, nodes);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const b = boxes.get(n.id)!;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  minX = round4(minX);
  minY = round4(minY);
  const w = round4(maxX - minX);
  const h = round4(maxY - minY);
  const parentId = nodes[0]!.parentId;
  const siblings = siblingsOf(doc, parentId);
  const ordered = [...nodes].sort((a, b) => siblings.indexOf(a.id) - siblings.indexOf(b.id));
  const top = siblings.indexOf(ordered[ordered.length - 1]!.id);
  const id = opts.id ?? newId();
  const frames = Object.values(doc.nodes).filter((n) => n.type === "frame").length;
  const name = opts.name || `Frame ${frames + 1}`;
  const ops: Op[] = [
    {
      op: "create",
      parentId,
      index: top + 1,
      node: { type: "frame", id, name, x: minX, y: minY, width: w, height: h, fill: "transparent", clip: false },
    },
  ];
  for (const n of ordered) {
    ops.push({ op: "move", id: n.id, parentId: id });
    ops.push({ op: "update", id: n.id, props: { x: round4(n.x - minX), y: round4(n.y - minY) } });
  }
  return { ops, id };
}

export function revealOps(doc: Document, kind: RevealKind, pageId?: string): { ops: Op[]; ids: string[] } {
  if (kind !== "hidden" && kind !== "locked") throw new Error("kind must be hidden or locked");
  let start: string[];
  if (pageId !== undefined) {
    const page = doc.nodes[pageId];
    if (page?.type !== "page") throw new Error(`page "${pageId}" does not exist`);
    start = page.children;
  } else start = doc.rootIds;
  const ids: string[] = [];
  const ops: Op[] = [];
  const walk = (list: readonly string[]) => {
    for (const id of list) {
      const n = doc.nodes[id];
      if (!n) continue;
      if (isScene(n)) {
        if (kind === "hidden" && n.visible === false) {
          ops.push({ op: "update", id, props: { visible: true } });
          ids.push(id);
        } else if (kind === "locked" && n.locked && !copyOwner(doc, n)) {
          ops.push({ op: "update", id, props: { locked: false } });
          ids.push(id);
        }
      }
      if (isContainer(n)) walk(n.children);
    }
  };
  walk(start);
  return { ops, ids };
}

export interface GroupPlan {
  ops: Op[];
  id: string;
}

export function groupOps(doc: Document, ids: readonly string[], opts: { id?: string; name?: string } = {}): GroupPlan {
  if (!ids.length) throw new Error("pass at least one id to group");
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => !doc.nodes[id]);
  if (missing.length) throw new Error(`nodes do not exist: ${missing.join(", ")}`);
  const nodes = unique.map((id) => doc.nodes[id]!);
  const page = nodes.find((n) => n.type === "page");
  if (page) throw new Error(`"${page.id}" is a page; pages cannot be grouped`);
  const parentId = nodes[0]!.parentId;
  const other = nodes.find((n) => n.parentId !== parentId);
  if (other)
    throw new Error(`only nodes with the same parent can be grouped ("${other.id}" is in ${other.parentId ?? "canvas"}, "${nodes[0]!.id}" in ${parentId ?? "canvas"})`);
  const parent = parentId ? doc.nodes[parentId] : undefined;
  if (parent?.type === "frame" && parent.layout && parent.layout.mode !== "none")
    throw new Error(`"${parent.id}" has layout ${parent.layout.mode}: its children follow the flow and cannot be grouped; set the layout to none or use a frame`);
  const siblings = siblingsOf(doc, parentId);
  const ordered = [...unique].sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b));
  const top = siblings.indexOf(ordered[ordered.length - 1]!);
  const id = opts.id ?? newId();
  const name = opts.name || `Grupo ${Object.values(doc.nodes).filter((n) => n.type === "group").length + 1}`;
  const ops: Op[] = [{ op: "create", parentId, index: top + 1, node: { type: "group", id, name } }];
  for (const nid of ordered) ops.push({ op: "move", id: nid, parentId: id });
  return { ops, id };
}

export function ungroupOps(doc: Document, ids: readonly string[]): { ops: Op[]; released: string[] } {
  if (!ids.length) throw new Error("pass at least one group id");
  const ops: Op[] = [];
  const released: string[] = [];
  for (const id of new Set(ids)) {
    const g = doc.nodes[id];
    if (!g) throw new Error(`node "${id}" does not exist`);
    if (g.type !== "group") throw new Error(`node "${id}" is ${g.type}, not a group`);
    const index = siblingsOf(doc, g.parentId).indexOf(id);
    g.children.forEach((cid, k) => {
      const c = doc.nodes[cid];
      if (!isScene(c)) return;
      ops.push({ op: "move", id: cid, parentId: g.parentId, index: index + k });
      const props: Record<string, unknown> = { x: round4(c.x + g.x), y: round4(c.y + g.y) };
      if (g.opacity !== 1) props.opacity = round4(c.opacity * g.opacity);
      if (!g.visible) props.visible = false;
      ops.push({ op: "update", id: cid, props });
      released.push(cid);
    });
    ops.push({ op: "delete", id });
  }
  return { ops, released };
}

export function addPageOps(
  doc: Document,
  opts: { id?: string; name?: string; firstId?: string; firstName?: string } = {},
): { ops: Op[]; id: string } {
  const ops: Op[] = [];
  const pages = doc.rootIds.filter((r) => doc.nodes[r]?.type === "page").length;
  let count = pages;
  if (!firstPage(doc) && doc.rootIds.length) {
    const firstId = opts.firstId ?? newId();
    ops.push({ op: "create", parentId: null, index: 0, node: { type: "page", id: firstId, name: opts.firstName || defaultPageName(1) } });
    for (const r of doc.rootIds) ops.push({ op: "move", id: r, parentId: firstId });
    count = 1;
  }
  const id = opts.id ?? newId();
  ops.push({ op: "create", parentId: null, node: { type: "page", id, name: opts.name || defaultPageName(count + 1) } });
  return { ops, id };
}

export const DUPLICATE_OFFSET = 40;

export interface DuplicateOptions {
  offset?: number;
  parentId?: string | null;
  scale?: number;
  props?: Record<string, unknown>;
  place?: PlaceSpec;
}

export interface DuplicatePlan {
  ops: Op[];
  copies: string[];
  map: Record<string, string>;
}

const DUP_SKIP = new Set(["id", "parentId", "children", "sourceId"]);
const DUP_CONNECTOR_DERIVED = new Set(["x", "y", "width", "height", "d"]);
const DUP_PROPS_FORBIDDEN = new Set(["id", "type", "parentId", "children", "sourceId", "instanceOf"]);

function underNode(doc: Document, id: string, ancestor: string): boolean {
  let cur = doc.nodes[id]?.parentId ?? null;
  while (cur) {
    if (cur === ancestor) return true;
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return false;
}

function childNodes(doc: Document, n: NodeT): NodeT[] {
  if (typeof (n as Record<string, unknown>).instanceOf === "string") return [];
  if (!isContainer(n)) return [];
  return (n.children ?? []).map((c) => doc.nodes[c]).filter((c): c is NodeT => !!c && c.type !== "page");
}

export function duplicateOps(doc: Document, ids: readonly string[], opts: DuplicateOptions = {}): DuplicatePlan {
  if (!ids.length) throw new Error("pass at least one id to duplicate");
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => !doc.nodes[id]);
  if (missing.length) throw new Error(`nodes do not exist: ${missing.join(", ")}`);
  for (const id of unique) {
    const n = doc.nodes[id]!;
    if (n.type === "page") throw new Error(`"${id}" is a page; duplicate the frames on it instead`);
    const owner = copyOwner(doc, n);
    if (owner) throw new Error(`"${id}" is a copy inside the instance "${owner.id}"; duplicate the instance instead`);
  }
  const roots = unique.filter((id) => !unique.some((other) => other !== id && underNode(doc, id, other)));

  const placeBeside = opts.place === undefined && opts.offset === undefined;
  const placed = opts.place !== undefined && opts.place !== "none";
  const offset = placed || placeBeside ? 0 : (opts.offset ?? DUPLICATE_OFFSET);
  if (!Number.isFinite(offset)) throw new Error("offset must be a finite number");
  const scale = opts.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("scale must be a number above 0");
  if (opts.props) {
    const bad = Object.keys(opts.props).filter((k) => DUP_PROPS_FORBIDDEN.has(k));
    if (bad.length) throw new Error(`props cannot set ${bad.join(", ")}: the copy keeps those from its source`);
  }

  const map = new Map<string, string>();
  for (const id of roots) {
    const src = doc.nodes[id]!;
    const stack: NodeT[] = [src];
    while (stack.length) {
      const n = stack.pop()!;
      map.set(n.id, newId());
      stack.push(...childNodes(doc, n));
    }
  }

  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

  const build = (src: NodeT, isRoot: boolean): NodeInput => {
    const rec = src as Record<string, unknown>;
    const input: NodeInput = { type: src.type, id: map.get(src.id)! };
    const isConnector = src.type === "connector";
    const isInstance = typeof rec.instanceOf === "string";
    for (const [k, v] of Object.entries(rec)) {
      if (DUP_SKIP.has(k) || (isConnector && DUP_CONNECTOR_DERIVED.has(k))) continue;
      input[k] = v;
    }
    if (src.type === "group") {
      delete input.width;
      delete input.height;
    }
    if (!isInstance) scaleGeometry(input, scale, false);
    if (!isConnector) {
      const factor = isRoot ? 1 : scale;
      input.x = round4((num(rec.x) ?? 0) * factor + (isRoot ? offset : 0));
      input.y = round4((num(rec.y) ?? 0) * factor + (isRoot ? offset : 0));
    }
    if (isConnector) {
      const factor = isRoot ? 1 : scale;
      const shift = isRoot ? offset : 0;
      for (const end of ["from", "to"] as const) {
        const e = rec[end] as Record<string, unknown> | undefined;
        if (!e) continue;
        const next: Record<string, unknown> = { ...e };
        if (typeof e.nodeId === "string") next.nodeId = map.get(e.nodeId) ?? e.nodeId;
        if (num(e.x) !== undefined) next.x = round4(num(e.x)! * factor + shift);
        if (num(e.y) !== undefined) next.y = round4(num(e.y)! * factor + shift);
        input[end] = next;
      }
    }
    if (isInstance) input.scale = round4((num(rec.scale) ?? 1) * scale);
    const kids = childNodes(doc, src).map((c) => build(c, false));
    if (kids.length) input.children = kids;
    return input;
  };

  const ops: Op[] = [];
  const copies: string[] = [];
  for (const id of roots) {
    const src = doc.nodes[id]!;
    const node = build(src, true);
    if (opts.props) Object.assign(node, opts.props);
    const op: Op = { op: "create", parentId: opts.parentId !== undefined ? opts.parentId : src.parentId, node };
    if (placed && opts.place) {
      const beside = (opts.place === "right" || opts.place === "below") && src.type !== "connector";
      op.place = beside ? { near: id, side: opts.place as "right" | "below" } : opts.place;
    } else if (placeBeside && src.type !== "connector") op.place = { near: id, side: "right" };
    ops.push(op);
    copies.push(node.id!);
  }
  return { ops, copies, map: Object.fromEntries(map) };
}
