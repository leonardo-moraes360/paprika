import type { Document, Node } from "@paprika/core";
import type { DeltaMessage, MapPatch } from "./protocol";

export type DeltaResult = {
  doc: Document;
  /** Ids of the nodes the delta set (changed or created), straight from the message. */
  changed: string[];
  created: string[];
};

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

/**
 * Copy-on-write: the document and every map the delta touches are copied once, every other object keeps its
 * identity (an untouched node is the same reference as before, which is what lets rows and panels skip rendering).
 * `owned` carries the copies made earlier in the same batch so a burst of deltas copies each map once.
 */
export function applyDelta(doc: Document, delta: DeltaMessage, owned: Set<object> = new Set()): DeltaResult {
  let next = doc as unknown as Bag;
  if (!owned.has(next)) {
    next = { ...next };
    owned.add(next);
  }
  const prevNodes = (doc as unknown as { nodes: Record<string, Node> }).nodes;
  const changed: string[] = [];
  const created: string[] = [];
  if (delta.nodes?.set) {
    for (const id of Object.keys(delta.nodes.set)) {
      changed.push(id);
      if (!prevNodes[id]) created.push(id);
    }
  }
  if (delta.name !== undefined) next.name = delta.name;
  if (delta.rootIds) next.rootIds = delta.rootIds;
  if (delta.nodes) patchMap(owned, next, "nodes", delta.nodes);
  if (delta.tokens) patchMap(owned, next, "tokens", delta.tokens);
  if (delta.modes) patchMap(owned, next, "modes", delta.modes);
  if (delta.tokenMeta) patchMap(owned, next, "tokenMeta", delta.tokenMeta);
  if (delta.assets) patchMap(owned, next, "assets", delta.assets);
  return { doc: next as unknown as Document, changed, created };
}

/** Ids of nodes whose content differs between two documents (a full `doc` frame has no references to compare). */
export function changedBetween(prev: Document | null, next: Document): string[] {
  if (!prev) return [];
  const out: string[] = [];
  for (const [id, node] of Object.entries(next.nodes)) {
    const before = prev.nodes[id];
    if (before === node) continue;
    if (!before || JSON.stringify(before) !== JSON.stringify(node)) out.push(id);
  }
  return out;
}
