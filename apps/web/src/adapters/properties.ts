import type { Document, Node } from "@paprika/core";

/** What the properties panel is told: the document it reads, the primary node and the ids that exist. */
export type PanelInput = {
  doc: Document | null;
  node: Node | null;
  selected: readonly string[];
};

const NONE: readonly string[] = Object.freeze([]);
const EMPTY: PanelInput = { doc: null, node: null, selected: NONE };

const sameIds = (a: readonly string[], b: readonly string[]) => a === b || (a.length === b.length && a.every((id, i) => id === b[i]));

/** Ids of the document-level fields the panel reads. A node delta never replaces them, so the comparison is by identity. */
const docFields = ["name", "rootIds", "tokens", "modes", "tokenMeta", "assets"] as const;

/**
 * The nodes the panel reads for a selection: the selected nodes themselves, their ancestors (mode, owning component,
 * copy owner, parent layout), the targets of connectors, the source of a copy, and the component an instance points at
 * (with its whole subtree: the instance values list walks it). Everything else on the page is invisible to the panel.
 */
function watched(doc: Document, selected: readonly string[]) {
  const exact = new Set<string>(selected);
  const subtrees = new Set<string>();
  for (const id of selected) {
    let current: Node | undefined = doc.nodes[id];
    let depth = 0;
    while (current && depth++ < 1000) {
      exact.add(current.id);
      if (current.type === "connector") {
        if (current.from.nodeId) exact.add(current.from.nodeId);
        if (current.to.nodeId) exact.add(current.to.nodeId);
      }
      const rec = current as { instanceOf?: string; sourceId?: string };
      if (rec.instanceOf) subtrees.add(rec.instanceOf);
      if (rec.sourceId) exact.add(rec.sourceId);
      current = current.parentId ? doc.nodes[current.parentId] : undefined;
    }
  }
  return { exact, subtrees };
}

/** True when a delta touched something the panel shows for `selected`, comparing the document the panel holds with the live one. */
export function affectsPanel(held: Document, next: Document, selected: readonly string[]): boolean {
  if (held === next) return false;
  for (const key of docFields) if (held[key] !== next[key]) return true;
  if (held.nodes === next.nodes) return false;
  const { exact, subtrees } = selected.length > 0 ? watched(next, selected) : { exact: new Set<string>(), subtrees: new Set<string>() };
  if (exact.size === 0 && subtrees.size === 0) return false;
  const relevant = (id: string, nodes: Document["nodes"]) => {
    if (exact.has(id) || subtrees.has(id)) return true;
    if (subtrees.size === 0) return false;
    let parent = nodes[id]?.parentId;
    for (let depth = 0; parent && depth < 1000; depth++) {
      if (subtrees.has(parent)) return true;
      parent = nodes[parent]?.parentId;
    }
    return false;
  };
  let count = 0;
  let added = false;
  for (const id in next.nodes) {
    count++;
    const before = held.nodes[id];
    if (before === next.nodes[id]) continue;
    if (before === undefined) added = true;
    if (relevant(id, next.nodes)) return true;
  }
  if (added || count !== Object.keys(held.nodes).length) {
    for (const id in held.nodes) if (!Object.hasOwn(next.nodes, id) && relevant(id, held.nodes)) return true;
  }
  return false;
}

/**
 * Props of the properties panel from the live document and the editor selection. The panel takes the whole document
 * by contract and has no memoization inside, so this keeps the SAME `PanelInput` (and the same document reference)
 * while a delta only touches nodes the panel does not show: nothing downstream re-renders. `prev` is compared, not
 * the previous live document, so skipped deltas accumulate against what the panel actually holds.
 * Selected ids that are not in the document yet (an ack that comes before its delta) or no longer are left out.
 */
export function panelInput(prev: PanelInput | null, doc: Document | null, selection: readonly string[]): PanelInput {
  if (!doc) return prev && prev.doc === null ? prev : EMPTY;
  const existing = selection.filter((id) => Object.hasOwn(doc.nodes, id));
  const selected = prev && sameIds(prev.selected, existing) ? prev.selected : existing.length === 0 ? NONE : existing;
  if (prev?.doc && prev.doc.id === doc.id && prev.selected === selected && !affectsPanel(prev.doc, doc, selected)) return prev;
  const node = selected.length > 0 ? (doc.nodes[selected[selected.length - 1] as string] ?? null) : null;
  return { doc, node, selected };
}
