import { isContainer, isScene, type Document } from "@paprika/core";

export function containerChildren(doc: Document, id: string): string[] {
  const n = doc.nodes[id];
  if (!isContainer(n) || n.type === "page") return [];
  return n.children.filter((c) => isScene(doc.nodes[c]));
}

export function childrenSelection(doc: Document, selected: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of selected) {
    for (const child of containerChildren(doc, id)) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
    }
  }
  return out;
}

function siblingIds(doc: Document, id: string): string[] {
  const n = doc.nodes[id];
  if (!n || !isScene(n)) return [];
  const parent = n.parentId ? doc.nodes[n.parentId] : undefined;
  const kids = parent && isContainer(parent) ? parent.children : doc.rootIds;
  return kids.filter((c) => isScene(doc.nodes[c]));
}

export function cycleSibling(doc: Document, selected: readonly string[], dir: 1 | -1): string | null {
  if (!selected.length) return null;
  const anchor = dir === 1 ? selected[selected.length - 1]! : selected[0]!;
  const sibs = siblingIds(doc, anchor);
  const at = sibs.indexOf(anchor);
  if (at < 0 || sibs.length < 2) return null;
  return sibs[(at + dir + sibs.length) % sibs.length] ?? null;
}

export function layersUnderPoint(doc: Document, clientX: number, clientY: number, root: Element | null): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const host = el.closest<HTMLElement | SVGElement>("[data-paprika-id]");
    if (!host) continue;
    if (root && !root.contains(host)) continue;
    const id = host.dataset.paprikaId;
    if (!id || seen.has(id)) continue;
    if (!isScene(doc.nodes[id])) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
