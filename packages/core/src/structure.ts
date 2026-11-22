import type { NodeInput, Op } from "./ops.js";
import { round4 } from "./num.js";
import { newId } from "./id.js";
import { copyOwner, scaleGeometry } from "./component.js";
import { firstPage, isContainer, isScene, type Document, type Node as NodeT } from "./schema.js";

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

export const DUPLICATE_OFFSET = 40;

export interface DuplicateOptions {
  offset?: number;
  parentId?: string | null;
  scale?: number;
  props?: Record<string, unknown>;
}

export interface DuplicatePlan {
  ops: Op[];
  copies: string[];
  map: Record<string, string>;
}

const DUP_SKIP = new Set(["id", "parentId", "children", "sourceId"]);
const DUP_CONNECTOR_DERIVED = new Set(["x", "y", "width", "height", "d"]);
const DUP_PROPS_FORBIDDEN = new Set(["id", "type", "parentId", "children", "sourceId", "instanceOf"]);

function underNode(doc: Document, id: string, ancestor: string): boolean {
  let cur = doc.nodes[id]?.parentId ?? null;
  while (cur) {
    if (cur === ancestor) return true;
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return false;
}

function childNodes(doc: Document, n: NodeT): NodeT[] {
  if (typeof (n as Record<string, unknown>).instanceOf === "string") return [];
  if (!isContainer(n)) return [];
  return (n.children ?? []).map((c) => doc.nodes[c]).filter((c): c is NodeT => !!c && c.type !== "page");
}

export function duplicateOps(doc: Document, ids: readonly string[], opts: DuplicateOptions = {}): DuplicatePlan {
  if (!ids.length) throw new Error("pass at least one id to duplicate");
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => !doc.nodes[id]);
  if (missing.length) throw new Error(`nodes do not exist: ${missing.join(", ")}`);
  for (const id of unique) {
    const n = doc.nodes[id]!;
    if (n.type === "page") throw new Error(`"${id}" is a page; duplicate the frames on it instead`);
    const owner = copyOwner(doc, n);
    if (owner) throw new Error(`"${id}" is a copy inside the instance "${owner.id}"; duplicate the instance instead`);
  }
  const roots = unique.filter((id) => !unique.some((other) => other !== id && underNode(doc, id, other)));

  const offset = opts.offset ?? DUPLICATE_OFFSET;
  if (!Number.isFinite(offset)) throw new Error("offset must be a finite number");
  const scale = opts.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("scale must be a number above 0");
  if (opts.props) {
    const bad = Object.keys(opts.props).filter((k) => DUP_PROPS_FORBIDDEN.has(k));
    if (bad.length) throw new Error(`props cannot set ${bad.join(", ")}: the copy keeps those from its source`);
  }

  const map = new Map<string, string>();
  for (const id of roots) {
    const src = doc.nodes[id]!;
    const stack: NodeT[] = [src];
    while (stack.length) {
      const n = stack.pop()!;
      map.set(n.id, newId());
      stack.push(...childNodes(doc, n));
    }
  }

  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

  const build = (src: NodeT, isRoot: boolean): NodeInput => {
    const rec = src as Record<string, unknown>;
    const input: NodeInput = { type: src.type, id: map.get(src.id)! };
    const isConnector = src.type === "connector";
    const isInstance = typeof rec.instanceOf === "string";
    for (const [k, v] of Object.entries(rec)) {
      if (DUP_SKIP.has(k) || (isConnector && DUP_CONNECTOR_DERIVED.has(k))) continue;
      input[k] = v;
    }
    if (src.type === "group") {
      delete input.width;
      delete input.height;
    }
    if (!isInstance) scaleGeometry(input, scale, false);
    if (!isConnector) {
      const factor = isRoot ? 1 : scale;
      input.x = round4((num(rec.x) ?? 0) * factor + (isRoot ? offset : 0));
      input.y = round4((num(rec.y) ?? 0) * factor + (isRoot ? offset : 0));
    }
    if (isConnector) {
      const factor = isRoot ? 1 : scale;
      const shift = isRoot ? offset : 0;
      for (const end of ["from", "to"] as const) {
        const e = rec[end] as Record<string, unknown> | undefined;
        if (!e) continue;
        const next: Record<string, unknown> = { ...e };
        if (typeof e.nodeId === "string") next.nodeId = map.get(e.nodeId) ?? e.nodeId;
        if (num(e.x) !== undefined) next.x = round4(num(e.x)! * factor + shift);
        if (num(e.y) !== undefined) next.y = round4(num(e.y)! * factor + shift);
        input[end] = next;
      }
    }
    if (isInstance) input.scale = round4((num(rec.scale) ?? 1) * scale);
    const kids = childNodes(doc, src).map((c) => build(c, false));
    if (kids.length) input.children = kids;
    return input;
  };

  const ops: Op[] = [];
  const copies: string[] = [];
  for (const id of roots) {
    const src = doc.nodes[id]!;
    const node = build(src, true);
    if (opts.props) Object.assign(node, opts.props);
    ops.push({ op: "create", parentId: opts.parentId !== undefined ? opts.parentId : src.parentId, node });
    copies.push(node.id!);
  }
  return { ops, copies, map: Object.fromEntries(map) };
}
