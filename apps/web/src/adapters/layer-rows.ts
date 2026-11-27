import { isContainer, isInstance, type ConnectorEnd, type Document, type Node, type Op, type SceneNode } from "@paprika/core";
import type { LayerAgent, LayerKind, LayerMove, LayerRowData } from "@/components/frontends/layers-panel";

/** Rows of the layers panel, derived from the page in view and kept INCREMENTAL: see `deriveLayerRows`. */

type Entry = {
  node: Node;
  level: number;
  selected: boolean;
  agent: LayerAgent | undefined;
  inInstance: boolean;
  /** Connector labels depend on the nodes at their ends, so they are part of the comparison. */
  label: string | undefined;
  row: LayerRowData;
};

export type LayerRowsCache = {
  entries: Map<string, Entry>;
  rows: readonly LayerRowData[];
  /** The page and the doc roots the rows were made from: another page rebuilds from the entries, it does not reuse stale rows. */
  pageId: string | null;
};

export const createLayerRowsCache = (): LayerRowsCache => ({ entries: new Map(), rows: [], pageId: null });

function connectorEnd(doc: Document, end: ConnectorEnd): string {
  const target = end.nodeId ? doc.nodes[end.nodeId] : undefined;
  if (!target) return "•";
  return target.name || (target.type === "shape" || target.type === "text" ? target.text.slice(0, 12) : target.id);
}

/** What a layer is called when it has no name: its text, the two ends of a connector, or its type (as the old app did). */
export function layerLabel(doc: Document, node: Node): string {
  if (node.name) return node.name;
  if (node.type === "text" || (node.type === "shape" && node.text)) return node.text.slice(0, 24);
  if (node.type === "connector") return `${connectorEnd(doc, node.from)} → ${connectorEnd(doc, node.to)}`;
  return node.type;
}

export function layerKind(node: Node): LayerKind {
  if (node.type === "frame" && node.component) return "component";
  if (isInstance(node)) return "instance";
  if (node.type === "page") return "frame";
  return node.type;
}

const sameAgent = (a: LayerAgent | undefined, b: LayerAgent | undefined) => a === b || (a !== undefined && b !== undefined && a.name === b.name && a.tone === b.tone);

function sameRow(a: LayerRowData, b: LayerRowData) {
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.level === b.level &&
    a.hasChildren === b.hasChildren &&
    a.visible === b.visible &&
    a.locked === b.locked &&
    a.selected === b.selected &&
    a.draggable === b.draggable &&
    a.renamable === b.renamable &&
    a.lockable === b.lockable &&
    a.container === b.container &&
    a.dropTarget === b.dropTarget &&
    sameAgent(a.agent, b.agent)
  );
}

function buildRow(doc: Document, node: SceneNode, level: number, selected: boolean, agent: LayerAgent | undefined, inInstance: boolean): LayerRowData {
  const copy = node.sourceId !== undefined && inInstance;
  const row: LayerRowData = {
    id: node.id,
    name: layerLabel(doc, node),
    kind: layerKind(node),
    level,
    hasChildren: isContainer(node) && node.children.length > 0,
    visible: node.visible,
    locked: node.locked,
    selected,
    draggable: node.sourceId === undefined && !node.locked && !copy && node.type !== "connector",
    renamable: node.sourceId === undefined,
    lockable: !copy,
    container: isContainer(node) && !isInstance(node) && !copy,
    dropTarget: !inInstance,
  };
  if (agent) row.agent = agent;
  return row;
}

/**
 * Rows of the page in view, in tree order (the panel folds the collapsed ones itself). INCREMENTAL: `cache` keeps one
 * entry per layer, and a layer whose node, depth, selection and agent are the same object/value as last time hands back
 * the SAME row object; a layer whose node changed in something the row does not show (its position) also does.
 * When nothing at all changed it returns the previous ARRAY, so a delta that moves a node commits nothing downstream,
 * and a rename or a selection change produces one array with only the affected row objects new (the memoized rows of
 * the panel then re-render just those).
 *
 * The cache is a memo handed in by the caller (made once per hook), not module state. The walk is O(rows) with only
 * identity checks in the unchanged case.
 */
export function deriveLayerRows(
  cache: LayerRowsCache,
  doc: Document,
  pageId: string | null,
  selection: ReadonlySet<string>,
  touched: ReadonlyMap<string, LayerAgent>,
): readonly LayerRowData[] {
  const page = pageId ? doc.nodes[pageId] : undefined;
  const roots = page?.type === "page" ? page.children : doc.rootIds;
  const next = new Map<string, Entry>();
  const rows: LayerRowData[] = [];
  let changed = cache.pageId !== pageId;

  const walk = (ids: readonly string[], level: number, inInstance: boolean) => {
    for (const id of ids) {
      const node = doc.nodes[id];
      if (!node || node.type === "page") continue;
      const selected = selection.has(id);
      const agent = touched.get(id);
      const label = node.type === "connector" ? layerLabel(doc, node) : undefined;
      const previous = cache.entries.get(id);
      let entry: Entry;
      if (previous && previous.node === node && previous.level === level && previous.selected === selected && sameAgent(previous.agent, agent) && previous.inInstance === inInstance && previous.label === label) {
        entry = previous;
      } else {
        const built = buildRow(doc, node, level, selected, agent, inInstance);
        entry = { node, level, selected, agent, inInstance, label, row: previous && sameRow(previous.row, built) ? previous.row : built };
      }
      next.set(id, entry);
      rows.push(entry.row);
      if (isContainer(node) && node.children.length > 0) walk(node.children, level + 1, inInstance || isInstance(node));
    }
  };
  walk(roots, 0, false);

  if (!changed) {
    if (rows.length !== cache.rows.length) changed = true;
    else for (let i = 0; i < rows.length; i += 1) if (rows[i] !== cache.rows[i]) {
      changed = true;
      break;
    }
  }
  cache.entries = next;
  cache.pageId = pageId;
  if (changed) cache.rows = rows;
  return cache.rows;
}

/**
 * `move` ops for a drop in the layers panel (the pointer and the keyboard give the same shape). The ids go in the
 * order given and keep it; each op's `index` counts the siblings WITHOUT the moved layer, which is what `move` takes.
 * Layers that cannot move (locked, a copy inside an instance, a connector) and no-op moves are left out.
 */
export function moveOps(doc: Document, move: LayerMove): Op[] {
  const target = doc.nodes[move.targetId];
  if (!target) return [];
  const lists = new Map<string | null, string[]>();
  const listOf = (parentId: string | null): string[] => {
    let list = lists.get(parentId);
    if (!list) {
      const parent = parentId ? doc.nodes[parentId] : undefined;
      list = isContainer(parent) ? [...parent.children] : parentId === null ? [...doc.rootIds] : [];
      lists.set(parentId, list);
    }
    return list;
  };
  const underOrSelf = (id: string, ancestor: string) => {
    for (let cur: string | null | undefined = id; cur; cur = doc.nodes[cur]?.parentId) if (cur === ancestor) return true;
    return false;
  };
  const targetParent = move.position === "inside" ? move.targetId : target.parentId;
  const parentNode = targetParent ? doc.nodes[targetParent] : undefined;
  if (targetParent && !isContainer(parentNode)) return [];
  const ops: Op[] = [];
  let anchor = move.targetId;
  for (const id of move.ids) {
    const node = doc.nodes[id];
    if (!node || node.type === "page" || node.locked || node.sourceId !== undefined || node.type === "connector") continue;
    if (underOrSelf(targetParent ?? "", id) || id === move.targetId) continue;
    const from = listOf(node.parentId);
    const fromIndex = from.indexOf(id);
    if (fromIndex < 0) continue;
    from.splice(fromIndex, 1);
    const into = listOf(targetParent);
    let index: number;
    if (move.position === "inside") index = into.length;
    else if (move.position === "before") index = into.indexOf(move.targetId);
    else index = into.indexOf(anchor) + 1;
    if (index < 0) index = into.length;
    if (node.parentId === targetParent && fromIndex === index) {
      into.splice(index, 0, id);
      anchor = id;
      continue;
    }
    into.splice(index, 0, id);
    anchor = id;
    ops.push({ op: "move", id, parentId: targetParent, index });
  }
  return ops;
}

/**
 * The selection a click in the layers panel means. The panel's tree is a multi-select, so for a plain click it hands
 * over the selection with the clicked layer TOGGLED and says `replace`: the layer the person clicked is the one that
 * differs from the current selection, and a plain click selects just that one. Ctrl (`toggle`) and Shift (`extend`,
 * a range) take the list as it comes; so does an answer that differs by more than one layer (Enter on a layer sends only it).
 * Known blind spot: Enter on a layer that is already in a multiple selection looks like a click that toggled it off.
 */
export function resolveLayerSelection(current: readonly string[], next: readonly string[], mode: "replace" | "toggle" | "extend"): string[] {
  if (mode !== "replace") return [...next];
  const was = new Set(current);
  const now = new Set(next);
  const differing = [...now].filter((id) => !was.has(id)).concat([...was].filter((id) => !now.has(id)));
  return differing.length === 1 ? [differing[0] as string] : [...next];
}
