import type { Document } from "@paprika/core";

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

export interface RenderIndex {
  doc: Document;
  vers: ReadonlyMap<string, number>;
  envVer: number;
}

export class RenderIndexer {
  private input: Document | null = null;
  private result: RenderIndex | null = null;
  private own = new Map<string, number>();
  private counter = 0;
  private count = 0;
  private envVer = 0;

  index(doc: Document): RenderIndex {
    if (doc === this.input && this.result) return this.result;
    const prev = this.result?.doc ?? null;
    const prevNodes = prev?.nodes ?? null;
    const own = this.own;
    const changed: string[] = [];
    const reused: string[] = [];
    let count = 0;
    let added = false;
    for (const id in doc.nodes) {
      count++;
      const n = doc.nodes[id]!;
      const p = prevNodes?.[id];
      if (p === n) continue;
      if (p && deepEqual(p, n)) {
        reused.push(id);
        continue;
      }
      changed.push(id);
      if (!p) added = true;
    }
    const prevCount = prevNodes ? this.count : -1;
    this.count = count;
    const sameNodes = !!prev && prevCount === count && changed.length === 0;
    const removed: string[] = [];
    if (prevNodes && (added || prevCount !== count)) {
      for (const id of own.keys()) {
        if (Object.hasOwn(doc.nodes, id)) continue;
        own.delete(id);
        removed.push(id);
      }
    }
    for (const id of changed) own.set(id, ++this.counter);
    let nodes: Document["nodes"];
    if (sameNodes && prev) nodes = prev.nodes;
    else if (reused.length === 0) nodes = doc.nodes;
    else {
      nodes = { ...doc.nodes };
      for (const id of reused) nodes[id] = prevNodes![id]!;
    }
    const next: Record<string, unknown> = { ...doc, nodes };
    let envChanged = !prev;
    for (const k of Object.keys(doc)) {
      if (k === "nodes") continue;
      const before = prev ? (prev as Record<string, unknown>)[k] : undefined;
      if (prev && deepEqual(before, (doc as Record<string, unknown>)[k])) next[k] = before;
      else envChanged = true;
    }
    if (prev) for (const k of Object.keys(prev)) if (k !== "nodes" && !Object.hasOwn(doc, k)) envChanged = true;
    if (envChanged) this.envVer++;
    this.input = doc;
    if (prev && sameNodes && !envChanged && this.result) {
      this.result = { ...this.result };
      return this.result;
    }
    const stable = next as unknown as Document;
    const vers = this.result ? this.bump(this.result.vers, stable, changed, removed) : this.versions(stable);
    this.result = { doc: stable, vers, envVer: this.envVer };
    return this.result;
  }

  private bump(prev: ReadonlyMap<string, number>, doc: Document, changed: readonly string[], removed: readonly string[]): Map<string, number> {
    const vers = new Map(prev);
    for (const id of removed) vers.delete(id);
    for (const id of changed) {
      const v = this.own.get(id) ?? 0;
      vers.set(id, v);
      let a = doc.nodes[id]?.parentId;
      for (let depth = 0; a && doc.nodes[a] && depth < 2000; depth++) {
        vers.set(a, v);
        a = doc.nodes[a]!.parentId;
      }
      const stack = [id];
      while (stack.length) {
        const cur = doc.nodes[stack.pop()!];
        if (!cur || !("children" in cur)) continue;
        for (const c of cur.children) {
          if (!doc.nodes[c]) continue;
          vers.set(c, v);
          stack.push(c);
        }
      }
    }
    return vers;
  }

  private versions(doc: Document): Map<string, number> {
    const sub = new Map<string, number>();
    const up = new Map<string, number>();
    const own = this.own;
    const down = (id: string, depth: number): number => {
      const hit = sub.get(id);
      if (hit !== undefined) return hit;
      let v = own.get(id) ?? 0;
      sub.set(id, v);
      const n = doc.nodes[id];
      if (n && "children" in n && depth < 2000) for (const c of n.children) if (doc.nodes[c]) v = Math.max(v, down(c, depth + 1));
      sub.set(id, v);
      return v;
    };
    const above = (id: string, depth: number): number => {
      const hit = up.get(id);
      if (hit !== undefined) return hit;
      up.set(id, 0);
      const p = doc.nodes[id]?.parentId;
      let v = 0;
      if (p && doc.nodes[p] && depth < 2000) v = Math.max(own.get(p) ?? 0, above(p, depth + 1));
      up.set(id, v);
      return v;
    };
    const out = new Map<string, number>();
    for (const id of Object.keys(doc.nodes)) out.set(id, Math.max(own.get(id) ?? 0, down(id, 0), above(id, 0)));
    return out;
  }
}
