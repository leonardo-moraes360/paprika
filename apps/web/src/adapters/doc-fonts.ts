import type { Document, Node } from "@paprika/core";

const perNode = new WeakMap<Node, string>();
const perNodes = new WeakMap<Document["nodes"], readonly string[]>();

const familyOf = (node: Node): string => {
  let family = perNode.get(node);
  if (family === undefined) {
    const value = "fontFamily" in node ? node.fontFamily : undefined;
    family = typeof value === "string" ? value.trim() : "";
    perNode.set(node, family);
  }
  return family;
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * The font families the document uses, sorted. Memoized per `nodes` map and per node (a delta keeps the untouched
 * nodes by reference, so a re-scan after one change is one lookup per node and a recompute for the changed one).
 * Pure: the result depends only on the arguments. The caller that wants the identity kept while the list is the same
 * passes the list it holds as `previous` (or compares with `shallow`, as `useLive` does).
 */
export function documentFonts(doc: Document | null, previous?: readonly string[]): readonly string[] {
  if (!doc) return [];
  const cached = perNodes.get(doc.nodes);
  if (cached) return previous && sameList(previous, cached) ? previous : cached;
  const seen = new Set<string>();
  for (const id in doc.nodes) {
    const family = familyOf(doc.nodes[id] as Node);
    if (family) seen.add(family);
  }
  const list = [...seen].sort((a, b) => a.localeCompare(b));
  perNodes.set(doc.nodes, list);
  return previous && sameList(previous, list) ? previous : list;
}
