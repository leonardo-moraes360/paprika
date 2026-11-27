import { defaultPageName, firstPage, type Document, type NameLocale, type Op } from "@paprika/core";
import type { PageEntry } from "@/components/frontends/pages-panel";

export type PageBase = { id: string; name: string; hasContent: boolean };

/** The page in view: the one chosen when it still exists, else the first page; `null` for a document without pages. */
export function resolvePageId(doc: Document | null, chosen: string | null): string | null {
  if (!doc) return null;
  if (chosen && doc.nodes[chosen]?.type === "page") return chosen;
  return firstPage(doc)?.id ?? null;
}

/** Pages of the document in order, with what the panel needs. A selector for `useLive`: compare with `samePages`. */
export function pageBases(doc: Document | null): PageBase[] {
  if (!doc) return [];
  const out: PageBase[] = [];
  for (const id of doc.rootIds) {
    const node = doc.nodes[id];
    if (node?.type === "page") out.push({ id, name: node.name || node.id, hasContent: node.children.length > 0 });
  }
  return out;
}

export function samePages(a: readonly PageBase[], b: readonly PageBase[]) {
  return a.length === b.length && a.every((page, i) => page.id === b[i]?.id && page.name === b[i]?.name && page.hasContent === b[i]?.hasContent);
}

const entries = new WeakMap<PageBase, Map<number, PageEntry>>();

/** Panel entries: the same base and agent count give the same entry object, so an unchanged row does not re-render. */
export function toPageEntries(bases: readonly PageBase[], agentsByPage: ReadonlyMap<string, number>): PageEntry[] {
  return bases.map((base) => {
    const agents = agentsByPage.get(base.id) ?? 0;
    let byCount = entries.get(base);
    if (!byCount) entries.set(base, (byCount = new Map()));
    let entry = byCount.get(agents);
    if (!entry) {
      entry = { id: base.id, name: base.name, hasContent: base.hasContent, ...(agents > 0 ? { agents } : {}) };
      byCount.set(agents, entry);
    }
    return entry;
  });
}

/**
 * The op that adds a page, as the old app did: a document whose layers sit straight under the root gets its first
 * page ("firstName") around them, and the new page is named after how many pages there will be.
 */
export function addPageOp(doc: Document, id: string, locale: NameLocale): Op {
  const count = pageBases(doc).length;
  const adopting = count === 0 && doc.rootIds.length > 0;
  const op: Op = { op: "add_page", id, name: defaultPageName(adopting ? 2 : count + 1, locale) };
  if (adopting) (op as { firstName?: string }).firstName = defaultPageName(1, locale);
  return op;
}
