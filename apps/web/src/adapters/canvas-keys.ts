import { copyOwner, isContainer, isScene, type Document, type Op, type SceneNode } from "@paprika/core";

/** What Enter, Tab and PageUp/PageDown do on the canvas, as plain functions of the document and the selection. */

const scenes = (doc: Document, ids: readonly string[]) => ids.filter((id) => isScene(doc.nodes[id]));

/** The layers inside a container (not the page), in order. */
export function containerChildren(doc: Document, id: string): string[] {
  const node = doc.nodes[id];
  return !isContainer(node) || node.type === "page" ? [] : scenes(doc, node.children);
}

/** Enter: the children of every selected container, each once. */
export function childrenSelection(doc: Document, selected: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of selected) for (const child of containerChildren(doc, id)) out.add(child);
  return [...out];
}

function siblingIds(doc: Document, id: string): string[] {
  const node = doc.nodes[id];
  if (!node || !isScene(node)) return [];
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  return scenes(doc, isContainer(parent) ? parent.children : doc.rootIds);
}

/** Tab (`1`) and Shift+Tab (`-1`): the next or previous sibling of the last (first) selected layer, wrapping round; `null` when it has none. */
export function cycleSibling(doc: Document, selected: readonly string[], dir: 1 | -1): string | null {
  if (!selected.length) return null;
  const anchor = dir === 1 ? selected[selected.length - 1]! : selected[0]!;
  const sibs = siblingIds(doc, anchor);
  const at = sibs.indexOf(anchor);
  if (at < 0 || sibs.length < 2) return null;
  return sibs[(at + dir + sibs.length) % sibs.length] ?? null;
}

export type StackStep = "front" | "forward" | "back" | "backward";

/** PageUp is forward, PageDown backward; with Ctrl or Cmd it goes all the way (front, back). */
export const stackStep = (key: "PageUp" | "PageDown", mod: boolean): StackStep => (key === "PageUp" ? (mod ? "front" : "forward") : mod ? "back" : "backward");

/** The ops that move the selected layers in the stack (a locked layer or the inside of an instance stays). */
export function stackPlan(doc: Document, ids: readonly string[], step: StackStep): { ops: Op[]; step: StackStep } | null {
  const nodes = ids.map((id) => doc.nodes[id]).filter((n): n is SceneNode => !!isScene(n) && !n.locked && !copyOwner(doc, n));
  if (!nodes.length) return null;
  return { ops: nodes.map((n) => ({ op: "update", id: n.id, props: { index: step } }) as Op), step };
}
