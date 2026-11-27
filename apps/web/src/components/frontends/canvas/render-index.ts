import { pageRoots, type Document, type Node } from "@paprika/core";

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return false;
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

/**
 * The properties of a node that change nothing in how ITS DESCENDANTS are painted. `nodeStyle` reads from a node's ancestors
 * only the mode, the parent's layout, the fill a connector's label halo is drawn over and the component a variant belongs to:
 * a change in any other key (a move, a resize, a rename, a stroke) leaves the descendants as they are.
 */
const OWN_ONLY = new Set(["x", "y", "width", "height", "name", "rotation", "opacity", "visible", "locked", "stroke", "shadow", "radius", "clip", "filter", "backdropFilter", "outline", "children", "href", "text", "runs"]);

/** The document keys outside `nodes` that change how any node is painted. */
const ENV_KEYS = ["tokens", "modes", "tokenMeta", "assets"] as const;

const isContainerType = (node: Node) => node.type === "frame" || node.type === "group" || node.type === "page";

function reachesDescendants(prev: Node, next: Node): boolean {
  if (!isContainerType(next) && !isContainerType(prev)) return false;
  const a = prev as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!OWN_ONLY.has(key) && !deepEqual(a[key], b[key])) return true;
  }
  return false;
}

export type DocDiff = {
  /** Nodes that are new, gone or different in value (a replaced object with the same content is NOT one). */
  changed: string[];
  /** Nodes that must paint again: the changed ones plus whoever's painting depends on them (see `OWN_ONLY`). */
  dirty: Set<string>;
  /** A token, mode or asset changed: every node paints again. */
  env: boolean;
};

/**
 * What a new document changes, from the one before it. Cost: one pass over the nodes comparing references, a value comparison
 * only for the ones whose object was replaced.
 */
export function diffDocs(prev: Document | null, next: Document): DocDiff {
  const dirty = new Set<string>();
  if (!prev) return { changed: Object.keys(next.nodes), dirty, env: true };
  const changed: string[] = [];
  const before = prev.nodes;
  const after = next.nodes;
  let count = 0;
  let added = 0;
  for (const id in after) {
    count += 1;
    const node = after[id]!;
    const old = before[id];
    if (old === node) continue;
    if (!old) {
      added += 1;
      changed.push(id);
    } else if (!deepEqual(old, node)) changed.push(id);
  }
  const removed: string[] = [];
  if (added > 0 || count !== Object.keys(before).length) {
    for (const id in before) if (!Object.hasOwn(after, id)) removed.push(id);
  }
  let env = false;
  for (const key of ENV_KEYS) if (prev[key] !== next[key] && !deepEqual(prev[key], next[key])) env = true;
  if (env) return { changed: [...changed, ...removed], dirty, env };

  const ancestors = (from: string | null | undefined, doc: Document) => {
    for (let id = from ?? null, depth = 0; id && depth < 2000; depth += 1) {
      const node = doc.nodes[id];
      if (!node) return;
      dirty.add(id);
      id = node.parentId;
    }
  };
  const descendants = (id: string) => {
    const stack = [id];
    while (stack.length) {
      const node = next.nodes[stack.pop() as string];
      if (!node || !("children" in node)) continue;
      for (const child of node.children) {
        if (dirty.has(child) && child !== id) continue;
        dirty.add(child);
        stack.push(child);
      }
    }
  };
  for (const id of changed) {
    dirty.add(id);
    const node = after[id];
    const old = before[id];
    if (!node) continue;
    if (!old) {
      // A node that appears can change the bleed a clipping ancestor leaves for outlines.
      ancestors(node.parentId, next);
      continue;
    }
    if (reachesDescendants(old, node)) descendants(id);
    const o = old as unknown as { outline?: unknown };
    const n = node as unknown as { outline?: unknown };
    if (!deepEqual(o.outline, n.outline)) ancestors(node.parentId, next);
  }
  for (const id of removed) {
    dirty.add(id);
    // The ancestors that still exist: their list of children and their outline bleed changed.
    ancestors(before[id]?.parentId, next);
  }
  return { changed: [...changed, ...removed], dirty, env: false };
}

export type NodeSnapshot = { node: Node | null; ver: number };

export type RenderStore = {
  /** The document the nodes are painted from (read it while rendering). */
  doc: () => Document;
  /** Takes a new document: only the nodes that must paint again are told. */
  setDoc: (doc: Document, pageId: string | null) => void;
  /** Same object until the node must paint again. */
  snapshot: (id: string) => NodeSnapshot;
  subscribe: (id: string, listener: () => void) => () => void;
  /** The roots of the page in view, same array until they change. */
  roots: () => readonly string[];
  subscribeRoots: (listener: () => void) => () => void;
  /** Counts every `setDoc` that changed anything. Overlays that measure the DOM listen to it. */
  subscribeDoc: (listener: () => void) => () => void;
  /** The count `subscribeDoc` is called at (for `useSyncExternalStore`). */
  docVersion: () => number;
  /** The element a node is painted in, by id (set by the node itself): a lookup, not a scan of the page, so measuring a few nodes stays cheap with thousands. */
  element: (id: string) => HTMLElement | null;
  /** A node tells where it is painted; returns the way to forget it. */
  attach: (id: string, el: HTMLElement) => () => void;
  /** Node renders so far (what the tests and `?perf=1` count). */
  renders: () => number;
  countRender: (id: string) => void;
  /** Tells `listener` which node rendered, each time. For tests; returns the way to stop. */
  watchRenders: (listener: (id: string) => void) => () => void;
};

export const emptyDocument = (): Document => ({ format: "paprika/1", id: "", name: "", tokens: {}, rootIds: [], nodes: {} }) as unknown as Document;

function rootsOf(doc: Document, pageId: string | null): readonly string[] {
  try {
    return pageRoots(doc, pageId);
  } catch {
    return [];
  }
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Index of the painting state of one canvas: each node has a snapshot that is replaced only when the node (or what its
 * style depends on) changed, and its listeners are called only then. A node component subscribes to its own id, so a delta
 * on one node renders one node, however many the page has.
 */
export function createRenderStore(initial: Document | null = null, pageId: string | null = null): RenderStore {
  let current = initial ?? emptyDocument();
  let tick = 0;
  let roots = rootsOf(current, pageId);
  const snaps = new Map<string, NodeSnapshot>();
  const listeners = new Map<string, Set<() => void>>();
  const rootListeners = new Set<() => void>();
  const docListeners = new Set<() => void>();
  let renders = 0;
  let docVersion = 0;
  const watchers = new Set<(id: string) => void>();
  const elements = new Map<string, HTMLElement>();

  const snapshot = (id: string): NodeSnapshot => {
    let snap = snaps.get(id);
    if (!snap) {
      snap = { node: current.nodes[id] ?? null, ver: ++tick };
      snaps.set(id, snap);
    }
    return snap;
  };

  return {
    doc: () => current,
    snapshot,
    setDoc: (doc, page) => {
      const prev = current;
      const nextRoots = rootsOf(doc, page);
      const rootsChanged = !sameList(roots, nextRoots);
      if (doc === prev && !rootsChanged) return;
      current = doc;
      const diff = doc === prev ? { changed: [] as string[], dirty: new Set<string>(), env: false } : diffDocs(prev, doc);
      const told: (() => void)[] = [];
      const touch = (id: string) => {
        const snap = snaps.get(id);
        if (!snap) return;
        snaps.set(id, { node: doc.nodes[id] ?? null, ver: ++tick });
        const set = listeners.get(id);
        if (set) for (const listener of set) told.push(listener);
      };
      if (diff.env) for (const id of [...snaps.keys()]) touch(id);
      else for (const id of diff.dirty) touch(id);
      // Gone nodes that nobody reads any more should not pile up.
      for (const id of diff.changed) if (!doc.nodes[id] && !listeners.get(id)?.size) snaps.delete(id);
      for (const listener of told) listener();
      if (rootsChanged) {
        roots = nextRoots;
        for (const listener of [...rootListeners]) listener();
      }
      if (diff.env || diff.dirty.size > 0 || diff.changed.length > 0 || rootsChanged) {
        docVersion += 1;
        for (const listener of [...docListeners]) listener();
      }
    },
    subscribe: (id, listener) => {
      snapshot(id);
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size > 0) return;
        listeners.delete(id);
        if (!Object.hasOwn(current.nodes, id)) snaps.delete(id);
      };
    },
    roots: () => roots,
    subscribeRoots: (listener) => {
      rootListeners.add(listener);
      return () => void rootListeners.delete(listener);
    },
    subscribeDoc: (listener) => {
      docListeners.add(listener);
      return () => void docListeners.delete(listener);
    },
    docVersion: () => docVersion,
    element: (id) => elements.get(id) ?? null,
    attach: (id, el) => {
      elements.set(id, el);
      return () => {
        if (elements.get(id) === el) elements.delete(id);
      };
    },
    renders: () => renders,
    countRender: (id) => {
      renders += 1;
      for (const watcher of watchers) watcher(id);
    },
    watchRenders: (listener) => {
      watchers.add(listener);
      return () => void watchers.delete(listener);
    },
  };
}
