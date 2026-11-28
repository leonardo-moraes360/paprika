import { copyOwner, isContainer, isInstance, isScene, type Document, type Node, type SceneNode } from "@paprika/core";

/** The rules the selection and transform gestures share about WHAT a press means (no DOM, no state). */

/**
 * The layer a press on `id` means: a click lands on the outermost group or instance above it that the selection is not already
 * inside of (so a first click picks the group, and once the group is selected the next click goes one level in). Ctrl asks for
 * the node itself (deep selection) and skips this.
 */
export function pickTarget(doc: Document, id: string, selected: readonly string[]): string {
  const groups: string[] = [];
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) if (doc.nodes[p]?.type === "group" || isInstance(doc.nodes[p])) groups.push(p);
  const within = (group: string) =>
    selected.some((s) => {
      for (let cur = doc.nodes[s]?.parentId ?? null; cur; cur = doc.nodes[cur]?.parentId ?? null) if (cur === group) return true;
      return false;
    });
  for (let k = groups.length - 1; k >= 0; k--) {
    const group = groups[k]!;
    if (selected.includes(group) || !within(group)) return group;
  }
  return id;
}

export const isFlowFrame = (node: Node | undefined): boolean => node?.type === "frame" && !!node.layout && node.layout.mode !== "none";

/** Placed by `x`/`y` (the page, a frame without auto layout, or a node that opted out of the flow) rather than by its parent's layout. */
export function isAbsolute(doc: Document, node: Node): boolean {
  if (node.type === "page") return false;
  if ("layoutPositioning" in node && node.layoutPositioning === "absolute") return true;
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  return !parent || parent.type !== "frame" || !parent.layout || parent.layout.mode === "none";
}

export function isUnder(doc: Document, id: string, ancestor: string): boolean {
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) if (p === ancestor) return true;
  return false;
}

/** May the dragged nodes be dropped into `parentId` (`null` is the page): not into themselves or their own children, not into a leaf, an instance or a copy. */
export function dropAccepts(doc: Document, parentId: string | null, dragged: ReadonlySet<string>): boolean {
  if (parentId === null) return true;
  if (dragged.has(parentId)) return false;
  for (const id of dragged) if (isUnder(doc, parentId, id)) return false;
  const node = doc.nodes[parentId];
  if (!isContainer(node) || node.type === "page") return false;
  if (isInstance(node) || copyOwner(doc, node)) return false;
  return true;
}

/** The nodes a press may move: not connectors (they follow their ends), not locked, not the inside of an instance. */
export function movableNodes(doc: Document, ids: readonly string[]): SceneNode[] {
  return ids
    .map((id) => doc.nodes[id])
    .filter((n): n is SceneNode => isScene(n) && n.type !== "connector" && !n.locked && !copyOwner(doc, n));
}

/** Gets handles: one selected node that is a plain box (not a group, a connector, an instance or inside one). */
export function isResizable(doc: Document, node: Node | undefined): node is SceneNode {
  return !!node && isScene(node) && node.type !== "group" && node.type !== "connector" && !isInstance(node) && !copyOwner(doc, node);
}

/** Resize and rotate also need the node not to be locked. */
export const isTransformable = (doc: Document, node: Node | undefined): node is SceneNode => isResizable(doc, node) && !node.locked;

/** The turn of a node, `0` for the kinds that have none. */
export const rotationOf = (node: Node | undefined): number => (node && node.type !== "group" && node.type !== "connector" && node.type !== "page" ? node.rotation : 0);

type Modifiers = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };
/** Shift, Cmd or Ctrl: a marquee adds to the selection instead of replacing it. */
export const isAdditive = (e: Modifiers) => e.shiftKey || e.metaKey || e.ctrlKey;
/** Ctrl alone: select the node under the pointer itself, not the group or instance it belongs to. */
export const isDeep = (e: Modifiers) => e.ctrlKey && !e.metaKey && !e.shiftKey;
/** Shift or Cmd (Ctrl with one of them too): a click toggles the node in the selection. */
export const isToggle = (e: Modifiers) => isAdditive(e) && !isDeep(e);
