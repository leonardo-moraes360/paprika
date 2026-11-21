import type { Op } from "./ops.js";
import { round4 } from "./num.js";
import { newId } from "./id.js";
import { firstPage, isContainer, isScene, type Document } from "./schema.js";

/**
 * Operações compostas (grupos e páginas). Cada função só *gera* operações primitivas
 * (create/move/update/delete); quem aplica é `applyOps`, então tudo continua atômico, com uma
 * entrada de histórico e desfazer. O canvas e as ferramentas MCP usam as mesmas funções.
 */

function siblingsOf(doc: Document, parentId: string | null): string[] {
  if (parentId === null) return doc.rootIds;
  const p = doc.nodes[parentId];
  return isContainer(p) ? p.children : [];
}

export interface GroupPlan {
  ops: Op[];
  /** Id do grupo criado. */
  id: string;
}

/**
 * Agrupa nós irmãos num `group` novo, na posição do mais alto deles na pilha. A ordem entre
 * eles é mantida e o desenho não se move (a caixa do grupo é ajustada aos filhos).
 */
export function groupOps(doc: Document, ids: readonly string[], opts: { id?: string; name?: string } = {}): GroupPlan {
  if (!ids.length) throw new Error("pass at least one id to group");
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => !doc.nodes[id]);
  if (missing.length) throw new Error(`nodes do not exist: ${missing.join(", ")}`);
  const nodes = unique.map((id) => doc.nodes[id]!);
  const page = nodes.find((n) => n.type === "page");
  if (page) throw new Error(`"${page.id}" is a page; pages cannot be grouped`);
  const parentId = nodes[0]!.parentId;
  const other = nodes.find((n) => n.parentId !== parentId);
  if (other)
    throw new Error(`only nodes with the same parent can be grouped ("${other.id}" is in ${other.parentId ?? "canvas"}, "${nodes[0]!.id}" in ${parentId ?? "canvas"})`);
  const parent = parentId ? doc.nodes[parentId] : undefined;
  if (parent?.type === "frame" && parent.layout && parent.layout.mode !== "none")
    throw new Error(`"${parent.id}" has layout ${parent.layout.mode}: its children follow the flow and cannot be grouped; set the layout to none or use a frame`);
  const siblings = siblingsOf(doc, parentId);
  const ordered = [...unique].sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b));
  const top = siblings.indexOf(ordered[ordered.length - 1]!);
  const id = opts.id ?? newId();
  const name = opts.name || `Grupo ${Object.values(doc.nodes).filter((n) => n.type === "group").length + 1}`;
  const ops: Op[] = [{ op: "create", parentId, index: top + 1, node: { type: "group", id, name } }];
  for (const nid of ordered) ops.push({ op: "move", id: nid, parentId: id });
  return { ops, id };
}

/**
 * Desfaz grupos: os filhos voltam ao pai do grupo, no lugar dele, com a mesma aparência
 * (posição, opacidade e visibilidade do grupo são aplicadas a cada filho). Retorna os ops e os
 * ids dos filhos liberados (para selecionar).
 */
export function ungroupOps(doc: Document, ids: readonly string[]): { ops: Op[]; released: string[] } {
  if (!ids.length) throw new Error("pass at least one group id");
  const ops: Op[] = [];
  const released: string[] = [];
  for (const id of new Set(ids)) {
    const g = doc.nodes[id];
    if (!g) throw new Error(`node "${id}" does not exist`);
    if (g.type !== "group") throw new Error(`node "${id}" is ${g.type}, not a group`);
    const index = siblingsOf(doc, g.parentId).indexOf(id);
    g.children.forEach((cid, k) => {
      const c = doc.nodes[cid];
      if (!isScene(c)) return;
      ops.push({ op: "move", id: cid, parentId: g.parentId, index: index + k });
      const props: Record<string, unknown> = { x: round4(c.x + g.x), y: round4(c.y + g.y) };
      if (g.opacity !== 1) props.opacity = round4(c.opacity * g.opacity);
      if (!g.visible) props.visible = false;
      ops.push({ op: "update", id: cid, props });
      released.push(cid);
    });
    ops.push({ op: "delete", id });
  }
  return { ops, released };
}

/**
 * Cria uma página. Se o documento ainda não tem páginas e já tem conteúdo, esse conteúdo vai
 * antes para uma primeira página (`firstName`), porque com páginas o topo só aceita páginas.
 */
export function addPageOps(
  doc: Document,
  opts: { id?: string; name?: string; firstId?: string; firstName?: string } = {},
): { ops: Op[]; id: string } {
  const ops: Op[] = [];
  const pages = doc.rootIds.filter((r) => doc.nodes[r]?.type === "page").length;
  let count = pages;
  if (!firstPage(doc) && doc.rootIds.length) {
    const firstId = opts.firstId ?? newId();
    ops.push({ op: "create", parentId: null, index: 0, node: { type: "page", id: firstId, name: opts.firstName || "Página 1" } });
    for (const r of doc.rootIds) ops.push({ op: "move", id: r, parentId: firstId });
    count = 1;
  }
  const id = opts.id ?? newId();
  ops.push({ op: "create", parentId: null, node: { type: "page", id, name: opts.name || `Página ${count + 1}` } });
  return { ops, id };
}
