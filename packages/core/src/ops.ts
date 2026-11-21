import { z } from "zod";
import {
  Document,
  IMMUTABLE_KEYS,
  Node,
  NodeType,
  TokenName,
  TokenValue,
  type Document as DocumentT,
  type FrameNode,
  type Node as NodeT,
  knownKeys,
} from "./schema.js";
import { newId } from "./id.js";

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
  if (parent.type !== "frame") throw new OpError(`pai "${parentId}" é ${parent.type}; só frames têm filhos`, i);
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
    if (n.type === "frame") n.children.forEach(walk);
  };
  walk(id);
  return out;
}

function isDescendant(doc: DocumentT, maybeChild: string, ancestor: string): boolean {
  let cur = doc.nodes[maybeChild]?.parentId ?? null;
  while (cur) {
    if (cur === ancestor) return true;
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return false;
}

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
  if (children && input.type !== "frame") throw new OpError(`só frames aceitam children (recebido ${input.type})`, i);
  const allowed = knownKeys(input.type);
  const unknown = Object.keys(rest).filter((k) => !allowed.has(k));
  if (unknown.length) throw new OpError(`campos desconhecidos para ${input.type}: ${unknown.join(", ")}`, i);
  if ("parentId" in rest) throw new OpError(`use o parentId da operação, não do nó`, i);
  const list = container(doc, parentId, i);
  const parsed = Node.safeParse({ ...rest, id, parentId, children: input.type === "frame" ? [] : undefined });
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
      from.splice(fromIndex, 1);
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
      if (n.type === "frame") check((n as FrameNode).children, id);
    }
  };
  check(doc.rootIds, null);
  const orphans = Object.keys(doc.nodes).filter((id) => !seen.has(id));
  if (orphans.length) throw new Error(`documento inconsistente: nós órfãos ${orphans.join(", ")}`);
  return doc;
}
