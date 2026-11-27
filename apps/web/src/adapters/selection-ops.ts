import {
  centerContentOps,
  groupOps,
  isContainer,
  isScene,
  newId,
  ungroupOps,
  wrapOps,
  type ConnectorEnd,
  type Document,
  type Node,
  type NodeInput,
  type Op,
  type SceneNode,
} from "@paprika/core";

/** What the editor does with the selection (menu and keyboard share it): the ops, the label of the history step, and the selection after. */

export type SelectionLabel = "group" | "wrap" | "ungroup" | "duplicate" | "delete" | "nudge" | "center" | "convert";

export type SelectionPlan = { ops: Op[]; label: SelectionLabel; select?: string[] };

export type SelectionResult = SelectionPlan | { error: string } | null;

export const NUDGE = 1;
export const NUDGE_BIG = 10;
export const DUPLICATE_OFFSET = 20;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function sceneNodes(doc: Document, ids: readonly string[]): SceneNode[] {
  return ids.map((id) => doc.nodes[id]).filter(isScene);
}

export const siblingsOf = (doc: Document, parentId: string | null): readonly string[] => {
  const parent = parentId ? doc.nodes[parentId] : undefined;
  return isContainer(parent) ? parent.children : doc.rootIds;
};

export function groupPlan(doc: Document, ids: readonly string[], makeId: () => string = newId): SelectionResult {
  const nodes = sceneNodes(doc, ids);
  if (!nodes.length) return null;
  const picked = nodes.map((n) => n.id);
  try {
    groupOps(doc, picked);
  } catch (error) {
    return { error: message(error) };
  }
  const id = makeId();
  return { ops: [{ op: "group", ids: picked, id }], label: "group", select: [id] };
}

export function wrapPlan(doc: Document, ids: readonly string[], makeId: () => string = newId): SelectionResult {
  const nodes = sceneNodes(doc, ids);
  if (!nodes.length) return null;
  const picked = nodes.map((n) => n.id);
  try {
    wrapOps(doc, picked);
  } catch (error) {
    return { error: message(error) };
  }
  const id = makeId();
  return { ops: [{ op: "wrap", ids: picked, id }], label: "wrap", select: [id] };
}

export function ungroupPlan(doc: Document, ids: readonly string[]): SelectionResult {
  const groups = sceneNodes(doc, ids)
    .filter((n) => n.type === "group")
    .map((n) => n.id);
  if (!groups.length) return null;
  try {
    const { released } = ungroupOps(doc, groups);
    return { ops: [{ op: "ungroup", ids: groups }], label: "ungroup", select: released };
  } catch (error) {
    return { error: message(error) };
  }
}

function toInput(doc: Document, id: string, makeId: () => string): NodeInput {
  const node = doc.nodes[id] as Node;
  const { id: _id, parentId: _parent, ...rest } = node as Record<string, unknown> & { id: string; parentId: string | null };
  const input: NodeInput = { ...(rest as Omit<NodeInput, "id">), type: node.type, id: makeId() };
  if (isContainer(node)) input.children = node.children.map((child) => toInput(doc, child, makeId));
  else delete input.children;
  if (node.type === "group") {
    delete input.width;
    delete input.height;
  }
  if (node.type === "connector") for (const key of ["x", "y", "width", "height", "d"]) delete (input as Record<string, unknown>)[key];
  return input;
}

/** A copy of each selected layer, 20 px down and right, right above its original (connectors free at both ends move too). */
export function duplicatePlan(doc: Document, ids: readonly string[], makeId: () => string = newId): SelectionResult {
  const nodes = sceneNodes(doc, ids);
  if (!nodes.length) return null;
  const ops: Op[] = [];
  const created: string[] = [];
  for (const node of [...nodes].reverse()) {
    const input = toInput(doc, node.id, makeId);
    if (node.type === "connector") {
      const shift = (end: ConnectorEnd): ConnectorEnd => (end.nodeId ? end : { ...end, x: (end.x ?? 0) + DUPLICATE_OFFSET, y: (end.y ?? 0) + DUPLICATE_OFFSET });
      Object.assign(input, { from: shift(node.from), to: shift(node.to) });
    } else {
      input.x = node.x + DUPLICATE_OFFSET;
      input.y = node.y + DUPLICATE_OFFSET;
    }
    ops.push({ op: "create", node: input, parentId: node.parentId, index: siblingsOf(doc, node.parentId).indexOf(node.id) + 1 });
    created.unshift(input.id as string);
  }
  return { ops, label: "duplicate", select: created };
}

/** Deletes the selected layers; one under another selected layer goes with it, so it gets no op of its own. */
export function deletePlan(doc: Document, ids: readonly string[]): SelectionResult {
  const nodes = sceneNodes(doc, ids);
  if (!nodes.length) return null;
  const set = new Set(nodes.map((n) => n.id));
  const under = (id: string) => {
    for (let parent = doc.nodes[id]?.parentId; parent; parent = doc.nodes[parent]?.parentId ?? null) if (set.has(parent)) return true;
    return false;
  };
  return { ops: nodes.filter((n) => !under(n.id)).map((n): Op => ({ op: "delete", id: n.id })), label: "delete", select: [] };
}

/** Moves the selected layers by (dx, dy); locked ones and connectors stay. */
export function nudgePlan(doc: Document, ids: readonly string[], dx: number, dy: number): SelectionPlan | null {
  const ops = sceneNodes(doc, ids)
    .filter((n) => !n.locked && n.type !== "connector")
    .map((n): Op => ({ op: "update", id: n.id, props: { x: (n as { x: number }).x + dx, y: (n as { y: number }).y + dy } }));
  return ops.length ? { ops, label: "nudge" } : null;
}

export function centerPlan(doc: Document, ids: readonly string[]): { plan: SelectionPlan | null; centered: boolean } {
  const { ops, centered } = centerContentOps(doc, ids);
  return { plan: ops.length ? { ops, label: "center" } : null, centered };
}

export function convertToPathPlan(doc: Document, ids: readonly string[]): SelectionPlan | null {
  const target = sceneNodes(doc, ids).find((n) => (n.type === "rect" || n.type === "ellipse") && n.sourceId === undefined);
  return target ? { ops: [{ op: "convert_to_path", ids: [target.id] }], label: "convert", select: [target.id] } : null;
}

/** Ctrl+A: every layer next to the first selected one (or on the page in view when nothing is selected). */
export function selectAllIds(doc: Document, selection: readonly string[], pageId: string | null): string[] {
  const parent = sceneNodes(doc, selection)[0]?.parentId ?? pageId;
  return [...siblingsOf(doc, parent)];
}

/** Esc: select the parent of the first selected layer, or nothing when that parent is the page. */
export function escapeSelection(doc: Document, selection: readonly string[]): string[] {
  const parent = sceneNodes(doc, selection)[0]?.parentId;
  return parent && doc.nodes[parent]?.type !== "page" ? [parent] : [];
}
