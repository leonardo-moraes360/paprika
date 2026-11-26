import { copyOwner, instanceOwner } from "./component.js";
import { layout } from "./layout.js";
import { localBox } from "./structure.js";
import { inFlow, siblingList } from "./shapeFrame.js";
import { isContainer, isScene, type Document, type Node, type SceneNode } from "./schema.js";

export const ADOPT_SCAN_LIMIT = 64;
const ADOPT_LAYOUT_NODES = 160;
const EPS = 1e-6;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const probePage = "__adopt_probe__";
const cache = new WeakMap<Document, Map<string, readonly string[]>>();

function measured(doc: Document, nodes: readonly SceneNode[]): Map<string, Box> {
  const out = new Map<string, Box>();
  const need: Node[] = [];
  for (const n of nodes) {
    if (!isScene(n)) continue;
    if (typeof n.width === "number" && typeof n.height === "number") out.set(n.id, localBox(n));
    else need.push(n);
  }
  if (!need.length) return out;
  const probe: Record<string, Node> = {};
  let budget = ADOPT_LAYOUT_NODES;
  const take = (id: string, parentId: string): boolean => {
    const n = doc.nodes[id];
    if (!n || n.type === "page") return true;
    if (budget-- <= 0) return false;
    const copy = { ...n, parentId } as Node;
    probe[id] = copy;
    if (isContainer(n)) for (const c of n.children) if (!take(c, id)) return false;
    return true;
  };
  const roots: string[] = [];
  for (const n of need) {
    const mark = budget;
    const before = Object.keys(probe);
    if (take(n.id, probePage)) roots.push(n.id);
    else {
      budget = mark;
      for (const k of Object.keys(probe)) if (!before.includes(k)) delete probe[k];
    }
  }
  if (!roots.length) return out;
  probe[probePage] = { type: "page", id: probePage, name: "", parentId: null, children: roots } as unknown as Node;
  const sandbox = { ...doc, nodes: probe, rootIds: [probePage] } as Document;
  let boxes: ReturnType<typeof layout>;
  try {
    boxes = layout(sandbox, { rootId: probePage });
  } catch {
    return out;
  }
  for (const id of roots) {
    const b = boxes[id];
    const n = probe[id]!;
    if (!b || !isScene(n)) continue;
    out.set(id, localBox(n, { width: b.width, height: b.height }));
  }
  return out;
}

const overlaps = (a: Box, b: Box) => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minY < b.maxY - EPS && b.minY < a.maxY - EPS;
const within = (inner: Box, outer: Box) =>
  inner.minX >= outer.minX - EPS && inner.minY >= outer.minY - EPS && inner.maxX <= outer.maxX + EPS && inner.maxY <= outer.maxY + EPS;

function compute(doc: Document, shape: Node): string[] {
  if (shape.type !== "rect" && shape.type !== "ellipse") return [];
  if (copyOwner(doc, shape) || instanceOwner(doc, shape.id)) return [];
  if (shape.rotation || typeof shape.width !== "number" || typeof shape.height !== "number") return [];
  if (shape.type === "ellipse" && shape.width !== shape.height) return [];
  if (inFlow(doc, shape.parentId)) return [];
  const list = siblingList(doc, shape.parentId);
  const at = list.indexOf(shape.id);
  if (at < 0) return [];
  const above: SceneNode[] = [];
  for (const id of list.slice(at + 1, at + 1 + ADOPT_SCAN_LIMIT)) {
    const n = doc.nodes[id];
    if (n && isScene(n) && n.visible !== false) above.push(n);
  }
  if (!above.length) return [];
  const bounds = localBox(shape);
  const boxes = measured(doc, above);
  const blockers: Box[] = [];
  let blocked = false;
  const adopted: string[] = [];
  for (const n of above) {
    const box = boxes.get(n.id);
    const eligible = n.type !== "connector" && !("locked" in n && n.locked) && !!box && !blocked && within(box, bounds) && !blockers.some((b) => overlaps(b, box));
    if (eligible) adopted.push(n.id);
    else if (!box) blocked = true;
    else blockers.push(box);
  }
  return adopted;
}

export function adoptableContent(doc: Document, id: string): readonly string[] {
  const shape = doc.nodes[id];
  if (!shape) return [];
  let byDoc = cache.get(doc);
  if (!byDoc) cache.set(doc, (byDoc = new Map()));
  const hit = byDoc.get(id);
  if (hit) return hit;
  const found = compute(doc, shape);
  byDoc.set(id, found);
  return found;
}
