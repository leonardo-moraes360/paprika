import type { Document, Node } from "@paprika/core";

export interface MapPatch<T> {
  set?: Record<string, T>;
  del?: string[];
}

export interface DeltaMsg {
  type: "delta";
  id: string;
  version: number;
  base: number;
  actor: string;
  label: string;
  kind: string;
  canUndo: boolean;
  canRedo: boolean;
  name?: string;
  rootIds?: string[];
  nodes?: MapPatch<Node>;
  tokens?: MapPatch<unknown>;
  modes?: MapPatch<unknown>;
  tokenMeta?: MapPatch<unknown>;
  assets?: MapPatch<string>;
}

export interface DeltaResult {
  doc: Document;
  changed: string[];
  created: string[];
}

type Bag = Record<string, unknown>;

function patchMap(owned: Set<object>, parent: Bag, key: string, patch: MapPatch<unknown>): void {
  let map = parent[key] as Bag | undefined;
  if (!map) {
    map = {};
    parent[key] = map;
    owned.add(map);
  } else if (!owned.has(map)) {
    map = { ...map };
    parent[key] = map;
    owned.add(map);
  }
  if (patch.set) {
    for (const k of Object.keys(patch.set)) {
      Object.defineProperty(map, k, { value: patch.set[k], writable: true, enumerable: true, configurable: true });
    }
  }
  if (patch.del) for (const k of patch.del) if (Object.hasOwn(map, k)) Reflect.deleteProperty(map, k);
}

export function applyDelta(doc: Document, d: DeltaMsg, owned: Set<object> = new Set()): DeltaResult {
  let next = doc as unknown as Bag;
  if (!owned.has(next)) {
    next = { ...next };
    owned.add(next);
  }
  const prevNodes = (doc as unknown as { nodes: Record<string, Node> }).nodes;
  const changed: string[] = [];
  const created: string[] = [];
  if (d.nodes?.set) {
    for (const id of Object.keys(d.nodes.set)) {
      changed.push(id);
      if (!prevNodes[id]) created.push(id);
    }
  }
  if (d.name !== undefined) next.name = d.name;
  if (d.rootIds) next.rootIds = d.rootIds;
  if (d.nodes) patchMap(owned, next, "nodes", d.nodes);
  if (d.tokens) patchMap(owned, next, "tokens", d.tokens);
  if (d.modes) patchMap(owned, next, "modes", d.modes);
  if (d.tokenMeta) patchMap(owned, next, "tokenMeta", d.tokenMeta);
  if (d.assets) patchMap(owned, next, "assets", d.assets);
  return { doc: next as unknown as Document, changed, created };
}

export function orderCreated(doc: Document, created: string[]): string[] {
  if (created.length < 2) return created.filter((id) => doc.nodes[id] && doc.nodes[id]!.type !== "page");
  const index = new Map<string, Map<string, number>>();
  const posIn = (parent: string, list: readonly string[], child: string): number => {
    let m = index.get(parent);
    if (!m) {
      m = new Map(list.map((c, i) => [c, i]));
      index.set(parent, m);
    }
    return m.get(child) ?? Number.MAX_SAFE_INTEGER;
  };
  const pathOf = (id: string): number[] => {
    const path: number[] = [];
    const seen = new Set<string>();
    let cur: Node | undefined = doc.nodes[id];
    let curId = id;
    while (cur && !seen.has(curId)) {
      seen.add(curId);
      const pid = cur.parentId;
      const parent = pid ? doc.nodes[pid] : undefined;
      if (parent && "children" in parent) path.unshift(posIn(pid!, parent.children, curId));
      else path.unshift(posIn("", doc.rootIds, curId));
      if (!parent) break;
      cur = parent;
      curId = pid!;
    }
    return path;
  };
  const keyed = created.filter((id) => doc.nodes[id] && doc.nodes[id]!.type !== "page").map((id) => ({ id, path: pathOf(id) }));
  keyed.sort((a, b) => {
    const n = Math.min(a.path.length, b.path.length);
    for (let i = 0; i < n; i++) if (a.path[i] !== b.path[i]) return a.path[i]! - b.path[i]!;
    return a.path.length - b.path.length;
  });
  return keyed.map((k) => k.id);
}
