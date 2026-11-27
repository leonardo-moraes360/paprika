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

let last: readonly string[] = [];

/**
 * The font families the document uses, sorted. Memoized per `nodes` map and per node (a delta keeps the untouched
 * nodes by reference, so a re-scan after one change is one lookup per node and a recompute for the changed one), and
 * the result keeps its identity while the list is the same.
 */
export function documentFonts(doc: Document | null): readonly string[] {
  if (!doc) return [];
  const cached = perNodes.get(doc.nodes);
  if (cached) return cached;
  const seen = new Set<string>();
  for (const id in doc.nodes) {
    const family = familyOf(doc.nodes[id] as Node);
    if (family) seen.add(family);
  }
  const list = [...seen].sort((a, b) => a.localeCompare(b));
  const result = sameList(last, list) ? last : list;
  last = result;
  perNodes.set(doc.nodes, result);
  return result;
}
