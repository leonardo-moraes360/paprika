import { z } from "zod";
import {
  Document,
  IMMUTABLE_KEYS,
  Node,
  NodeType,
  TokenName,
  TokenValue,
  type Document as DocumentT,
  type GroupNode,
  type Node as NodeT,
  isContainer,
  isScene,
  knownKeys,
} from "./schema.js";
import { newId } from "./id.js";
import { parsePath, pathBounds } from "./path.js";

/** Entrada de criação: um nó parcial, com filhos aninhados opcionais (só para frames). */
export type NodeInput = { type: z.infer<typeof NodeType>; id?: string; children?: NodeInput[] } & Record<
  string,
  unknown
>;

export const NodeInputSchema: z.ZodType<NodeInput> = z.lazy(() =>
  z
    .object({
      type: NodeType,
      id: z.string().optional(),
      children: z.array(NodeInputSchema).optional(),
    })
    .catchall(z.unknown()),
) as z.ZodType<NodeInput>;

export const CreateOp = z.object({
  op: z.literal("create"),
  node: NodeInputSchema,
  parentId: z.string().nullable().default(null),
  index: z.number().int().min(0).optional(),
});

export const UpdateOp = z.object({
  op: z.literal("update"),
  id: z.string(),
  /** Campos a alterar. `null` remove o campo (volta ao padrão). Objetos (layout, stroke...) são substituídos inteiros. */
  props: z.record(z.string(), z.unknown()),
});

export const DeleteOp = z.object({ op: z.literal("delete"), id: z.string() });

export const MoveOp = z.object({
  op: z.literal("move"),
  id: z.string(),
  parentId: z.string().nullable(),
  index: z.number().int().min(0).optional(),
});

export const SetTokensOp = z.object({
  op: z.literal("set_tokens"),
  /** `null` remove o token. */
  tokens: z.record(TokenName, TokenValue.nullable()),
});

export const RenameDocumentOp = z.object({ op: z.literal("rename_document"), name: z.string().min(1).max(200) });

/** Operação interna usada como inversa de `delete` (desfazer). */
export const RestoreOp = z.object({
  op: z.literal("restore"),
  nodes: z.array(Node),
  rootId: z.string(),
  parentId: z.string().nullable(),
  index: z.number().int().min(0),
});

export const Op = z.discriminatedUnion("op", [
  CreateOp,
  UpdateOp,
  DeleteOp,
  MoveOp,
  SetTokensOp,
  RenameDocumentOp,
  RestoreOp,
]);

export type Op = z.input<typeof Op>;
type ParsedOp = z.output<typeof Op>;

export class OpError extends Error {
  constructor(
    message: string,
    readonly opIndex: number,
  ) {
    super(`op[${opIndex}]: ${message}`);
    this.name = "OpError";
  }
}

export interface ApplyResult {
  doc: DocumentT;
  /** Operações que desfazem esta transação, já na ordem de aplicação. */
  inverse: Op[];
  /** Ids criados, na ordem (raízes e filhos aninhados). */
  created: string[];
}

function formatZod(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("; ");
}

function container(doc: DocumentT, parentId: string | null, i: number): string[] {
  if (parentId === null) return doc.rootIds;
  const parent = doc.nodes[parentId];
  if (!parent) throw new OpError(`pai "${parentId}" não existe`, i);
  if (!isContainer(parent)) throw new OpError(`pai "${parentId}" é ${parent.type}; só frame, group e page têm filhos`, i);
  return parent.children;
}

function insertAt(list: string[], id: string, index: number | undefined): number {
  const at = index === undefined ? list.length : Math.min(index, list.length);
  list.splice(at, 0, id);
  return at;
}

function subtree(doc: DocumentT, id: string): NodeT[] {
  const out: NodeT[] = [];
  const walk = (nid: string) => {
    const n = doc.nodes[nid];
    if (!n) return;
    out.push(n);
    if (isContainer(n)) n.children.forEach(walk);
  };
  walk(id);
  return out;
}

const PAGE_AT_ROOT = "página só pode ficar no nível do canvas (parentId null)";

/** Página só no topo; nada além de páginas pode ficar no topo de um documento com páginas (checado no fim). */
function checkPlacement(doc: DocumentT, type: string, parentId: string | null, i: number) {
  if (type === "page" && parentId !== null) throw new OpError(PAGE_AT_ROOT, i);
  if (type !== "page" && parentId === null && doc.nodes[doc.rootIds[0] ?? ""]?.type === "page")
    throw new OpError(`o documento tem páginas: crie ou mova ${type} para dentro de uma página (parentId = id da página)`, i);
}

function isDescendant(doc: DocumentT, maybeChild: string, ancestor: string): boolean {
  let cur = doc.nodes[maybeChild]?.parentId ?? null;
  while (cur) {
    if (cur === ancestor) return true;
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return false;
}

const CONTAINER_TYPES = new Set(["frame", "group", "page"]);
const GROUP_SIZE = "width/height de um group seguem os filhos; mova ou redimensione os filhos";

function createNode(
  doc: DocumentT,
  input: NodeInput,
  parentId: string | null,
  index: number | undefined,
  i: number,
  created: string[],
): string {
  const { children, ...rest } = input;
  const id = input.id ?? newId();
  if (doc.nodes[id]) throw new OpError(`id "${id}" já existe`, i);
  if (children && !CONTAINER_TYPES.has(input.type))
    throw new OpError(`só frame, group e page aceitam children (recebido ${input.type})`, i);
  const allowed = knownKeys(input.type);
  const unknown = Object.keys(rest).filter((k) => !allowed.has(k));
  if (unknown.length) throw new OpError(`campos desconhecidos para ${input.type}: ${unknown.join(", ")}`, i);
  if ("parentId" in rest) throw new OpError(`use o parentId da operação, não do nó`, i);
  if (input.type === "group" && ("width" in rest || "height" in rest)) throw new OpError(GROUP_SIZE, i);
  const list = container(doc, parentId, i);
  checkPlacement(doc, input.type, parentId, i);
  const props: Record<string, unknown> = { ...rest };
  // Sem width/height, um path ganha a caixa do próprio desenho (ou do viewBox): o agente só escreve `d`.
  if (input.type === "path" && typeof props.d === "string" && (props.width === undefined || props.height === undefined)) {
    const vb = Array.isArray(props.viewBox) ? (props.viewBox as number[]) : null;
    let w: number, h: number;
    if (vb) [w, h] = [vb[2]!, vb[3]!];
    else {
      try {
        const b = pathBounds(parsePath(props.d));
        [w, h] = [b.x + b.width, b.y + b.height];
      } catch {
        [w, h] = [100, 100]; // o erro de `d` sai da validação abaixo, com a posição
      }
    }
    props.width ??= Math.max(1, Math.ceil(w));
    props.height ??= Math.max(1, Math.ceil(h));
  }
  const parsed = Node.safeParse({ ...props, id, parentId, children: CONTAINER_TYPES.has(input.type) ? [] : undefined });
  if (!parsed.success) throw new OpError(`nó inválido: ${formatZod(parsed.error)}`, i);
  doc.nodes[id] = parsed.data;
  insertAt(list, id, index);
  created.push(id);
  for (const child of children ?? []) createNode(doc, child, id, undefined, i, created);
  return id;
}

function applyOne(doc: DocumentT, op: ParsedOp, i: number, created: string[]): Op[] {
  switch (op.op) {
    case "create": {
      const id = createNode(doc, op.node, op.parentId, op.index, i, created);
      return [{ op: "delete", id }];
    }
    case "update": {
      const node = doc.nodes[op.id];
      if (!node) throw new OpError(`nó "${op.id}" não existe`, i);
      const allowed = knownKeys(node.type);
      const next: Record<string, unknown> = { ...node };
      const prev: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(op.props)) {
        if (IMMUTABLE_KEYS.has(k)) throw new OpError(`campo "${k}" não pode ser alterado por update (use move/create)`, i);
        if (!allowed.has(k)) throw new OpError(`campo desconhecido para ${node.type}: ${k}`, i);
        if (node.type === "group" && (k === "width" || k === "height")) throw new OpError(GROUP_SIZE, i);
        prev[k] = k in node ? (node as Record<string, unknown>)[k] : null;
        if (v === null) delete next[k];
        else next[k] = v;
      }
      const parsed = Node.safeParse(next);
      if (!parsed.success) throw new OpError(`update inválido em "${op.id}": ${formatZod(parsed.error)}`, i);
      doc.nodes[op.id] = parsed.data;
      return [{ op: "update", id: op.id, props: prev }];
    }
    case "delete": {
      const node = doc.nodes[op.id];
      if (!node) throw new OpError(`nó "${op.id}" não existe`, i);
      const nodes = subtree(doc, op.id);
      const list = container(doc, node.parentId, i);
      const index = list.indexOf(op.id);
      list.splice(index, 1);
      for (const n of nodes) delete doc.nodes[n.id];
      return [{ op: "restore", nodes: structuredClone(nodes), rootId: op.id, parentId: node.parentId, index }];
    }
    case "restore": {
      for (const n of op.nodes) {
        if (doc.nodes[n.id]) throw new OpError(`id "${n.id}" já existe`, i);
      }
      const list = container(doc, op.parentId, i);
      const root = op.nodes.find((n) => n.id === op.rootId);
      if (root) checkPlacement(doc, root.type, op.parentId, i);
      for (const n of op.nodes) doc.nodes[n.id] = structuredClone(n);
      insertAt(list, op.rootId, op.index);
      return [{ op: "delete", id: op.rootId }];
    }
    case "move": {
      const node = doc.nodes[op.id];
      if (!node) throw new OpError(`nó "${op.id}" não existe`, i);
      if (op.parentId === op.id || (op.parentId && isDescendant(doc, op.parentId, op.id))) {
        throw new OpError(`mover "${op.id}" para dentro de si mesmo criaria um ciclo`, i);
      }
      const from = container(doc, node.parentId, i);
      const fromIndex = from.indexOf(op.id);
      const to = container(doc, op.parentId, i);
      if (node.type === "page" && op.parentId !== null) throw new OpError(PAGE_AT_ROOT, i);
      from.splice(fromIndex, 1);
      if (op.parentId === null && node.parentId !== null) checkPlacement(doc, node.type, null, i);
      insertAt(to, op.id, op.index);
      const oldParent = node.parentId;
      node.parentId = op.parentId;
      return [{ op: "move", id: op.id, parentId: oldParent, index: fromIndex }];
    }
    case "set_tokens": {
      const prev: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(op.tokens)) {
        prev[k] = doc.tokens[k] ?? null;
        if (v === null) delete doc.tokens[k];
        else doc.tokens[k] = v;
      }
      return [{ op: "set_tokens", tokens: prev }];
    }
    case "rename_document": {
      const prev = doc.name;
      doc.name = op.name;
      return [{ op: "rename_document", name: prev }];
    }
  }
}

/**
 * Aplica uma transação de operações de forma atômica: ou todas são aplicadas, ou nenhuma
 * (o documento de entrada nunca é mutado). Retorna o novo documento e as operações inversas.
 */
export function applyOps(doc: DocumentT, ops: readonly Op[]): ApplyResult {
  const draft = structuredClone(doc);
  const inverse: Op[] = [];
  const created: string[] = [];
  ops.forEach((raw, i) => {
    const parsed = Op.safeParse(raw);
    if (!parsed.success) throw new OpError(`operação inválida: ${formatZod(parsed.error)}`, i);
    inverse.unshift(...applyOne(draft, parsed.data, i, created));
  });
  if (ops.length) {
    checkPages(draft, ops.length - 1);
    inverse.unshift(...fitGroups(draft));
  }
  return { doc: draft, inverse, created };
}

/** Cria um documento vazio válido. */
export function createDocument(name = "Sem título", id = newId()): DocumentT {
  return Document.parse({ format: "paprika/1", id, name });
}

/** Valida e normaliza um documento lido do disco (preenche defaults; checa integridade da árvore). */
export function parseDocument(input: unknown): DocumentT {
  const doc = Document.parse(input);
  const seen = new Set<string>();
  const check = (ids: string[], parentId: string | null) => {
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n) throw new Error(`documento inconsistente: "${id}" referenciado mas ausente`);
      if (seen.has(id)) throw new Error(`documento inconsistente: "${id}" aparece mais de uma vez`);
      if (n.parentId !== parentId) throw new Error(`documento inconsistente: parentId de "${id}" diverge`);
      seen.add(id);
      if (n.type === "page" && parentId !== null) throw new Error(`documento inconsistente: página "${id}" fora do nível superior`);
      if (isContainer(n)) check(n.children, id);
    }
  };
  check(doc.rootIds, null);
  const rootTypes = new Set(doc.rootIds.map((id) => doc.nodes[id]!.type === "page"));
  if (rootTypes.size > 1) throw new Error("documento inconsistente: com páginas, todo nó de nível superior precisa ser página");
  const orphans = Object.keys(doc.nodes).filter((id) => !seen.has(id));
  if (orphans.length) throw new Error(`documento inconsistente: nós órfãos ${orphans.join(", ")}`);
  return doc;
}

/** Num documento com páginas, o nível superior só tem páginas (checado no fim da transação). */
function checkPages(doc: DocumentT, i: number) {
  if (!doc.rootIds.some((id) => doc.nodes[id]?.type === "page")) return;
  const loose = doc.rootIds.filter((id) => doc.nodes[id]?.type !== "page");
  if (loose.length)
    throw new OpError(
      `o documento tem páginas, mas ${loose.map((id) => `"${id}"`).join(", ")} ficou no nível do canvas; mova para uma página (parentId = id da página)`,
      i,
    );
}

/** Arredonda a 4 casas (e troca -0 por 0) para coordenadas calculadas: estável entre TS e Go. */
export function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000 + 0;
}

const EPS = 1e-3;

/** Caixa (sem rotação do pai) de um nó dentro do pai: considera a própria rotação em torno do centro. */
export function localBox(n: NodeT): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!isScene(n)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const w = typeof n.width === "number" ? n.width : 0;
  const h = typeof n.height === "number" ? n.height : 0;
  const rotation = n.type === "group" ? 0 : n.rotation;
  if (!rotation) return { minX: n.x, minY: n.y, maxX: n.x + w, maxY: n.y + h };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const hw = (w * cos + h * sin) / 2;
  const hh = (w * sin + h * cos) / 2;
  const cx = n.x + w / 2;
  const cy = n.y + h / 2;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}

/**
 * Ajusta a caixa de cada group aos filhos (do mais fundo para o mais raso), mantendo o desenho
 * parado: os filhos são deslocados e o grupo muda de origem. width/height do grupo são sempre
 * derivados dos filhos, então a inversa só precisa das posições. Retorna as operações inversas.
 */
function fitGroups(doc: DocumentT): Op[] {
  const inverse: Op[] = [];
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (!isContainer(n)) return;
    n.children.forEach(visit);
    if (n.type === "group") fitGroup(doc, n, inverse);
  };
  doc.rootIds.forEach(visit);
  return inverse;
}

function fitGroup(doc: DocumentT, g: GroupNode, inverse: Op[]) {
  const kids = g.children.map((c) => doc.nodes[c]).filter(isScene);
  if (!kids.length) return;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const k of kids) {
    const b = localBox(k);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  minX = round4(minX);
  minY = round4(minY);
  const w = round4(maxX - minX);
  const h = round4(maxY - minY);
  const shift = Math.abs(minX) >= EPS || Math.abs(minY) >= EPS;
  if (!shift && Math.abs(w - g.width) < EPS && Math.abs(h - g.height) < EPS) return;
  if (shift) {
    for (const k of kids) {
      inverse.push({ op: "update", id: k.id, props: { x: k.x, y: k.y } });
      k.x = round4(k.x - minX);
      k.y = round4(k.y - minY);
    }
    inverse.push({ op: "update", id: g.id, props: { x: g.x, y: g.y } });
    g.x = round4(g.x + minX);
    g.y = round4(g.y + minY);
  }
  g.width = w;
  g.height = h;
}
