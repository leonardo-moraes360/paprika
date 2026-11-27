import { routeConnector, type ConnectorNode, type Document, type Node } from "@paprika/core";
import type { PreviewPatch } from "./types";

/** The patches that change what a node IS (its outline, its ends, its layout), as opposed to where it sits. */
const CONTENT = ["d", "from", "to", "control", "layout"] as const;
const SHOWN = ["x", "y", "width", "height", "rotation", ...CONTENT] as const;

export const hasContentPatch = (patch: PreviewPatch | undefined): patch is PreviewPatch => !!patch && CONTENT.some((key) => patch[key] !== undefined);

/** The node with what a gesture shows laid over it (a copy; the document's node is never touched). */
export function withPatch<N extends Node>(node: N, patch: PreviewPatch): N {
  const next: Record<string, unknown> = { ...node };
  for (const key of SHOWN) if (patch[key] !== undefined) next[key] = patch[key];
  return next as N;
}

/** A flat `[id, patch, id, patch, ...]`: two reads of the same state give elements that are `===` one by one (see `sameLinked`). */
export type Linked = readonly (string | PreviewPatch)[];
export const NO_LINKS: Linked = [];

export function sameLinked(a: Linked, b: Linked): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The node and its ancestors, nearest first, up to (not including) the page. */
function chain(doc: Document, from: string | undefined, into: string[]) {
  for (let id = from ?? null, depth = 0; id && depth < 1000; depth += 1) {
    const node = doc.nodes[id];
    if (!node || node.type === "page") return;
    into.push(id);
    id = node.parentId;
  }
}

/**
 * What a connector must be routed from: the patches of the connector itself and of the nodes it is attached to, or of any
 * of their ancestors (a frame that moves takes its children's ends along). `NO_LINKS` for a node that is not a connector or
 * nothing it follows is being previewed, so a drag renders the connectors it moves and no others.
 */
export function linkedPatches(preview: Readonly<Record<string, PreviewPatch>>, doc: Document, node: Node | null | undefined): Linked {
  if (!node || node.type !== "connector") return NO_LINKS;
  let out: (string | PreviewPatch)[] | null = null;
  const take = (id: string) => {
    const patch = preview[id];
    if (!patch) return;
    out ??= [];
    out.push(id, patch);
  };
  take(node.id);
  const ids: string[] = [];
  chain(doc, node.from.nodeId, ids);
  chain(doc, node.to.nodeId, ids);
  for (const id of ids) if (id !== node.id) take(id);
  return out ?? NO_LINKS;
}

/** The document as the gesture shows it for the nodes in `linked` (a shallow copy of `nodes`: only for a connector that is being previewed). */
export function patchedDocument(doc: Document, linked: Linked): Document {
  const nodes = { ...doc.nodes };
  for (let i = 0; i < linked.length; i += 2) {
    const id = linked[i] as string;
    const node = nodes[id];
    if (node) nodes[id] = withPatch(node, linked[i + 1] as PreviewPatch);
  }
  return { ...doc, nodes };
}

/** The connector routed again over the nodes as they are shown (`routeConnector` writes its box and path). A copy; never throws. */
export function routedConnector(doc: Document, node: ConnectorNode, linked: Linked): ConnectorNode {
  const shown = patchedDocument(doc, linked);
  const copy = { ...(shown.nodes[node.id] as ConnectorNode) };
  shown.nodes[node.id] = copy;
  try {
    routeConnector(shown, copy);
    return copy;
  } catch {
    return shown.nodes[node.id] as ConnectorNode;
  }
}
