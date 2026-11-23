import { z } from "zod";
import {
  Document,
  IMMUTABLE_KEYS,
  type FrameNode,
  Node,
  NodeType,
  ModeName,
  CollectionName,
  TokenName,
  TokenTypeName,
  TokenValue,
  type Document as DocumentT,
  type GroupNode,
  type Node as NodeT,
  type ShadowSpec,
  isContainer,
  isScene,
  knownKeys,
} from "./schema.js";
import { newId } from "./id.js";
import { defaultUntitledName } from "./names.js";
import { normalizePath as shiftPathToOrigin, parsePath, pathBounds, serializePath } from "./path.js";
import { addPageOps, alignOps, distributeOps, groupOps, localBox, revealOps, ungroupOps, wrapOps } from "./structure.js";
import { combinePathsOps } from "./boolean.js";
import { round4 } from "./num.js";
import { PlaceSpecSchema, resolvePlace } from "./placement.js";
import { ConnectorError, connectorsAttachedTo, routeConnectors, shapeDefaults } from "./diagram.js";
import { parseColor } from "./lint.js";
import { lengthTokenError, modeOf, resolveValue } from "./style.js";
import { applyConstraints } from "./constraints.js";
import {
  COPY_OVERRIDES,
  InstanceError,
  copyOwner,
  detachOps,
  instanceOwner,
  isCopyOverride,
  isInstance,
  isRootDerived,
  setOverride,
  syncInstances,
} from "./component.js";
export { round4 } from "./num.js";

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
  place: PlaceSpecSchema.optional(),
});

export const UpdateOp = z.object({
  op: z.literal("update"),
  id: z.string(),
  /**
   * Campos a alterar. `null` remove o campo (volta ao padrão). Objetos (layout, stroke...) são substituídos inteiros.
   * `index` não é campo do nó: é uma diretiva de ordem Z (número a partir de 0, ou "front"/"back"/
   * "forward"/"backward") que reordena o nó dentro do pai atual, no mesmo passo de desfazer.
   */
  props: z.record(z.string(), z.unknown()),
});

export const DeleteOp = z.object({ op: z.literal("delete"), id: z.string() });

/** Posição na pilha dentro do pai: número a partir de 0 (o fundo) ou por nome. */
const Z_STEPS = ["front", "back", "forward", "backward"] as const;
type ZStep = (typeof Z_STEPS)[number];
const ZIndexSchema = z.union([z.number().int().min(0), z.enum(Z_STEPS)]);
const Z_INDEX_HINT = `props.index must be a number (0 is the back) or "front", "back", "forward" or "backward"`;

const isValidZIndex = (v: unknown): v is number | ZStep =>
  typeof v === "number" ? Number.isInteger(v) && v >= 0 : typeof v === "string" && (Z_STEPS as readonly string[]).includes(v);

/**
 * Resolve a posição pedida para índice de inserção na lista do pai *sem* o nó (o `move` tira antes
 * de inserir): `undefined` = fim da fila, o topo da pilha ("front"). `forward`/`backward` partem do
 * índice atual do nó. A inversa de qualquer dessas é sempre um índice numérico.
 */
function zStepToIndex(v: number | ZStep | undefined, fromIndex: number): number | undefined {
  if (v === undefined || v === "front") return undefined;
  if (typeof v === "number") return v;
  if (v === "back") return 0;
  if (v === "forward") return fromIndex + 1;
  return Math.max(0, fromIndex - 1);
}

export const MoveOp = z.object({
  op: z.literal("move"),
  id: z.string(),
  parentId: z.string().nullable(),
  index: z.optional(ZIndexSchema),
});

export const SetTokensOp = z.object({
  op: z.literal("set_tokens"),
  /** `null` remove o token. */
  tokens: z.record(TokenName, TokenValue.nullable()),
  /** Grava os valores do modo de tema `mode` em vez dos tokens base; um modo sem tokens some. */
  mode: ModeName.optional(),
  /** Tipo dos tokens desta chamada. `null` tira o tipo (o valor volta a ser livre). */
  type: TokenTypeName.nullable().optional(),
  /** Coleção nomeada dos tokens desta chamada. `null` tira a coleção. */
  collection: CollectionName.nullable().optional(),
});

export const RenameDocumentOp = z.object({ op: z.literal("rename_document"), name: z.string().min(1).max(200) });

/** Agrupa nós irmãos num `group` novo (expandida em create + move no momento da aplicação). */
export const GroupOp = z.object({
  op: z.literal("group"),
  ids: z.array(z.string()).min(1).max(500),
  id: z.string().optional(),
  name: z.string().max(200).optional(),
});

/** Desfaz groups (expandida em move + update + delete no momento da aplicação). */
export const UngroupOp = z.object({ op: z.literal("ungroup"), ids: z.array(z.string()).min(1).max(500) });

/** Cria uma página; a primeira leva o conteúdo atual para o nome padrão (`firstId`/`firstName`). */
export const AddPageOp = z.object({
  op: z.literal("add_page"),
  id: z.string().optional(),
  name: z.string().max(200).optional(),
  firstId: z.string().optional(),
  firstName: z.string().max(200).optional(),
});

/** Desanexa instâncias: viram frames comuns com cópias normais (expandida em updates). */
export const DetachOp = z.object({ op: z.literal("detach"), ids: z.array(z.string()).min(1).max(500) });

const TokenField = z.string().regex(/^[a-zA-Z][a-zA-Z.]{0,39}$/, "field must be a token field name");

/** Troca referências `$token` de um nó pelo valor resolvido. */
export const DetachTokensOp = z.object({
  op: z.literal("detach_tokens"),
  ids: z.array(z.string()).min(1).max(500),
  fields: z.array(TokenField).max(20).optional(),
});

/** Alinha irmãos pela caixa da seleção (um passo de desfazer). */
export const AlignOp = z.object({
  op: z.literal("align"),
  ids: z.array(z.string()).min(2).max(500),
  edge: z.enum(["left", "center", "right", "top", "middle", "bottom"]),
});

/** Distribui irmãos com o mesmo vão (um passo de desfazer). */
export const DistributeOp = z.object({
  op: z.literal("distribute"),
  ids: z.array(z.string()).min(3).max(500),
  axis: z.enum(["horizontal", "vertical"]),
});

/** Envolve irmãos num frame novo (um passo de desfazer). */
export const WrapOp = z.object({
  op: z.literal("wrap"),
  ids: z.array(z.string()).min(1).max(500),
  id: z.string().optional(),
  name: z.string().max(200).optional(),
});

/** Mostra tudo o que está oculto, ou destrava tudo, na página ou no documento. */
export const RevealOp = z.object({
  op: z.literal("reveal"),
  kind: z.enum(["hidden", "locked"]),
  pageId: z.string().optional(),
});

/** Combina path/rect/ellipse/shape numa path via união, subtração, interseção ou exclusão. */
export const CombinePathsOp = z.object({
  op: z.literal("combine_paths"),
  ids: z.array(z.string()).min(2).max(500),
  operation: z.enum(["union", "subtract", "intersect", "exclude"]),
  id: z.string().optional(),
  name: z.string().max(200).optional(),
});

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
  GroupOp,
  UngroupOp,
  AddPageOp,
  DetachOp,
  DetachTokensOp,
  CombinePathsOp,
  AlignOp,
  DistributeOp,
  WrapOp,
  RevealOp,
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
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

function container(doc: DocumentT, parentId: string | null, i: number): string[] {
  if (parentId === null) return doc.rootIds;
  const parent = doc.nodes[parentId];
  if (!parent) throw new OpError(`parent "${parentId}" does not exist`, i);
  if (!isContainer(parent)) throw new OpError(`parent "${parentId}" is ${parent.type}; only frame, group and page have children`, i);
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

const PAGE_AT_ROOT = "a page can only be at the canvas level (parentId null)";

/**
 * Página só no topo. Que o topo de um documento com páginas só tenha páginas é checado no fim da
 * transação (checkPages), porque no meio dela pode haver estados mistos (ex.: desfazer add_page).
 */
function checkPlacement(type: string, parentId: string | null, i: number) {
  if (type === "page" && parentId !== null) throw new OpError(PAGE_AT_ROOT, i);
}

function isDescendant(doc: DocumentT, maybeChild: string, ancestor: string): boolean {
  let cur = doc.nodes[maybeChild]?.parentId ?? null;
  while (cur) {
    if (cur === ancestor) return true;
    cur = doc.nodes[cur]?.parentId ?? null;
  }
  return false;
}

const SOURCE_ID = "sourceId is generated by instances; it cannot be written";
const inInstance = (inst: string) =>
  `"${inst}" is an instance: its content comes from the component; edit the component, use overrides or detach it`;
const copyRule = (id: string, inst: string) =>
  `"${id}" is a copy inside the instance "${inst}": only ${COPY_OVERRIDES.join(", ")} can change (they become overrides); edit the component or detach it`;

function updatePlain(doc: DocumentT, node: NodeT, props: Record<string, unknown>, i: number): Op {
  const allowed = knownKeys(node.type);
  const next: Record<string, unknown> = { ...node };
  const prev: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (IMMUTABLE_KEYS.has(k)) throw new OpError(`field "${k}" cannot be changed by update (use move/create)`, i);
    if (!allowed.has(k)) throw new OpError(`unknown field for ${node.type}: ${k}`, i);
    if (node.type === "group" && (k === "width" || k === "height")) throw new OpError(GROUP_SIZE, i);
    if (node.type === "connector" && CONNECTOR_DERIVED.has(k)) throw new OpError(CONNECTOR_GEOMETRY, i);
    prev[k] = k in node ? (node as Record<string, unknown>)[k] : null;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  const parsed = Node.safeParse(next);
  if (!parsed.success) throw new OpError(`invalid update on "${node.id}": ${formatZod(parsed.error)}`, i);
  doc.nodes[node.id] = parsed.data;
  return { op: "update", id: node.id, props: prev };
}

/** `update` numa cópia (ou no fill da raiz de uma instância): grava em `overrides` da instância. */
function updateOverride(doc: DocumentT, inst: FrameNode, node: NodeT, srcId: string, props: Record<string, unknown>, i: number): Op {
  const src = doc.nodes[srcId];
  const prev: Record<string, unknown> = {};
  const allowed = knownKeys(node.type);
  const unknown = Object.keys(props).filter((k) => !allowed.has(k));
  if (unknown.length) throw new OpError(`unknown field for ${node.type}: ${unknown.join(", ")}`, i);
  for (const [k, v] of Object.entries(props)) setOverride(inst, srcId, k, v, src);
  const next: Record<string, unknown> = { ...doc.nodes[node.id] };
  for (const [k, v] of Object.entries(props)) {
    prev[k] = k in node ? (node as Record<string, unknown>)[k] : null;
    if (v === null) {
      const sv = src ? (src as Record<string, unknown>)[k] : undefined;
      if (sv === undefined) delete next[k];
      else next[k] = sv;
    } else next[k] = v;
  }
  const parsed = Node.safeParse(next);
  if (!parsed.success) throw new OpError(`invalid update on "${node.id}": ${formatZod(parsed.error)}`, i);
  doc.nodes[node.id] = parsed.data;
  return { op: "update", id: node.id, props: prev };
}

const CONTAINER_TYPES = new Set(["frame", "group", "page"]);
const GROUP_SIZE = "a group's width/height follow its children; move or resize the children";
const CONNECTOR_DERIVED = new Set(["x", "y", "width", "height", "d"]);
const CONNECTOR_GEOMETRY = "a connector's x, y, width, height and d follow its ends; change from/to (nodeId, side, or x/y of a free end)";

function createNode(
  doc: DocumentT,
  input: NodeInput,
  parentId: string | null,
  index: number | undefined,
  i: number,
  created: string[],
): string {
  const { children, ...restIn } = input;
  const rest: Record<string, unknown> = { ...restIn };
  let doNormalize = false;
  if ("normalize" in rest) {
    if (input.type !== "path") {
      /* leave it: knownKeys rejects unknown fields */
    } else if (rest.normalize !== true && rest.normalize !== false) {
      throw new OpError(`normalize must be true or false`, i);
    } else {
      doNormalize = rest.normalize === true;
      delete rest.normalize;
    }
  }
  const id = input.id ?? newId();
  if (doc.nodes[id]) throw new OpError(`id "${id}" already exists`, i);
  if (children && !CONTAINER_TYPES.has(input.type))
    throw new OpError(`only frame, group and page take children (got ${input.type})`, i);
  const allowed = knownKeys(input.type);
  const unknown = Object.keys(rest).filter((k) => !allowed.has(k));
  if (unknown.length) throw new OpError(`unknown fields for ${input.type}: ${unknown.join(", ")}`, i);
  if ("parentId" in rest) throw new OpError(`use the operation's parentId, not the node's`, i);
  if (input.type === "group" && ("width" in rest || "height" in rest)) throw new OpError(GROUP_SIZE, i);
  if (input.type === "connector" && Object.keys(rest).some((k) => CONNECTOR_DERIVED.has(k))) throw new OpError(CONNECTOR_GEOMETRY, i);
  if ("sourceId" in rest) throw new OpError(SOURCE_ID, i);
  const owner = instanceOwner(doc, parentId);
  if (owner) throw new OpError(inInstance(owner.id), i);
  if (typeof rest.instanceOf === "string" && children?.length)
    throw new OpError(`an instance's children come from the component; create the instance without children`, i);
  const list = container(doc, parentId, i);
  checkPlacement(input.type, parentId, i);
  const props: Record<string, unknown> = { ...rest };
  // normalize: true move o desenho para (0,0) e soma o deslocamento a x/y (fb#15).
  if (input.type === "path" && doNormalize && typeof props.d === "string") {
    try {
      const n = shiftPathToOrigin(parsePath(props.d));
      props.d = serializePath(n.segs);
      if (n.origin.x || n.origin.y) {
        props.x = (typeof props.x === "number" ? props.x : 0) + n.origin.x;
        props.y = (typeof props.y === "number" ? props.y : 0) + n.origin.y;
      }
    } catch {
      /* o erro de `d` sai da validação abaixo */
    }
  }
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
  // Sem width/height, um texto novo abraça o conteúdo (hug): o padrão 100×100 de Base virava um
  // quadrado em cada rótulo de row/column. Com só width, a altura segue as linhas.
  if (input.type === "text") {
    props.width ??= "hug";
    props.height ??= "hug";
  }
  // Campos ausentes de uma forma nova ganham o padrão do tipo (a nota adesiva: amarela, sem borda, com sombra).
  if (input.type === "shape") {
    const kind = typeof props.shape === "string" ? props.shape : "rect";
    if (kind === "rect" || kind === "ellipse" || kind === "diamond" || kind === "triangle" || kind === "note") {
      for (const [k, v] of Object.entries(shapeDefaults(kind))) if (props[k] === undefined) props[k] = v;
    }
  }
  const parsed = Node.safeParse({ ...props, id, parentId, children: CONTAINER_TYPES.has(input.type) ? [] : undefined });
  if (!parsed.success) throw new OpError(`invalid node: ${formatZod(parsed.error)}`, i);
  doc.nodes[id] = parsed.data;
  insertAt(list, id, index);
  created.push(id);
  for (const child of children ?? []) createNode(doc, child, id, undefined, i, created);
  return id;
}

function applyOne(doc: DocumentT, op: ParsedOp, i: number, created: string[]): Op[] {
  switch (op.op) {
    case "create": {
      let parentId = op.parentId;
      const node = op.node;
      if (op.place && op.place !== "none") {
        try {
          parentId = resolvePlace(doc, parentId, node, op.place);
        } catch (e) {
          throw new OpError(e instanceof Error ? e.message : String(e), i);
        }
      }
      const id = createNode(doc, node, parentId, op.index, i, created);
      return [{ op: "delete", id }];
    }
    case "update": {
      const node = doc.nodes[op.id];
      if (!node) throw new OpError(`node "${op.id}" does not exist`, i);
      // `index` nos props é a diretiva de ordem Z: reordena no pai atual antes de aplicar os campos.
      let props = op.props;
      const reorder: Op[] = [];
      if ("index" in props) {
        const v = props.index;
        if (!isValidZIndex(v)) throw new OpError(`${Z_INDEX_HINT} (got ${JSON.stringify(v)})`, i);
        const ownerCopy = copyOwner(doc, node);
        if (ownerCopy) throw new OpError(copyRule(op.id, ownerCopy.id), i);
        const list = container(doc, node.parentId, i);
        const fromIndex = list.indexOf(op.id);
        list.splice(fromIndex, 1);
        insertAt(list, op.id, zStepToIndex(v, fromIndex));
        reorder.push({ op: "move", id: op.id, parentId: node.parentId, index: fromIndex });
        props = { ...props };
        delete props.index;
      }
      const owner = copyOwner(doc, node);
      if (owner) {
        const bad = Object.keys(props).filter((k) => !isCopyOverride(k));
        if (bad.length) throw new OpError(`${copyRule(op.id, owner.id)} (got ${bad.join(", ")})`, i);
        return [...[updateOverride(doc, owner, node, (node as { sourceId: string }).sourceId, props, i)], ...reorder];
      }
      if ("sourceId" in props && instanceOwner(doc, node.parentId)) throw new OpError(SOURCE_ID, i);
      if (!isInstance(node)) return [updatePlain(doc, node, props, i), ...reorder];
      const derived = Object.keys(props).filter((k) => isRootDerived(k) && k !== "fill");
      if (derived.length)
        throw new OpError(`${derived.join(", ")} of "${op.id}" come from the component "${node.instanceOf}"; edit the component, change scale or detach it`, i);
      // O fill da raiz vira override, aplicado depois do resto (que pode trocar o componente).
      const { fill, ...rest } = props;
      const inverse: Op[] = [];
      if (Object.keys(rest).length) inverse.push(updatePlain(doc, node, rest, i));
      if ("fill" in props) {
        const cur = doc.nodes[op.id]!;
        inverse.unshift(isInstance(cur) ? updateOverride(doc, cur, cur, cur.instanceOf, { fill }, i) : updatePlain(doc, cur, { fill }, i));
      }
      return [...inverse, ...reorder];
    }
    case "delete": {
      const node = doc.nodes[op.id];
      if (!node) throw new OpError(`node "${op.id}" does not exist`, i);
      const owner = copyOwner(doc, node);
      if (owner) throw new OpError(`${copyRule(op.id, owner.id)}; to hide it, use visible: false`, i);
      // Conectores presos ao que sai vão junto (as cópias em instâncias somem na sincronização).
      const attached = connectorsAttachedTo(doc, new Set(subtree(doc, op.id).map((n) => n.id))).filter((id) => !copyOwner(doc, doc.nodes[id]!));
      if (attached.length) {
        const inverse: Op[] = [];
        for (const id of attached) inverse.unshift(...applyOne(doc, { op: "delete", id }, i, created));
        return [...applyOne(doc, op, i, created), ...inverse];
      }
      const nodes = subtree(doc, op.id);
      const list = container(doc, node.parentId, i);
      const index = list.indexOf(op.id);
      list.splice(index, 1);
      for (const n of nodes) delete doc.nodes[n.id];
      return [{ op: "restore", nodes: structuredClone(nodes), rootId: op.id, parentId: node.parentId, index }];
    }
    case "restore": {
      for (const n of op.nodes) {
        if (doc.nodes[n.id]) throw new OpError(`id "${n.id}" already exists`, i);
      }
      const list = container(doc, op.parentId, i);
      const root = op.nodes.find((n) => n.id === op.rootId);
      if (root) checkPlacement(root.type, op.parentId, i);
      for (const n of op.nodes) doc.nodes[n.id] = structuredClone(n);
      insertAt(list, op.rootId, op.index);
      return [{ op: "delete", id: op.rootId }];
    }
    case "move": {
      const node = doc.nodes[op.id];
      if (!node) throw new OpError(`node "${op.id}" does not exist`, i);
      if (op.parentId === op.id || (op.parentId && isDescendant(doc, op.parentId, op.id))) {
        throw new OpError(`moving "${op.id}" into itself would create a cycle`, i);
      }
      const owner = copyOwner(doc, node);
      if (owner) throw new OpError(copyRule(op.id, owner.id), i);
      const target = instanceOwner(doc, op.parentId);
      if (target) throw new OpError(inInstance(target.id), i);
      const from = container(doc, node.parentId, i);
      const fromIndex = from.indexOf(op.id);
      const to = container(doc, op.parentId, i);
      checkPlacement(node.type, op.parentId, i);
      from.splice(fromIndex, 1);
      insertAt(to, op.id, zStepToIndex(op.index, fromIndex));
      const oldParent = node.parentId;
      node.parentId = op.parentId;
      return [{ op: "move", id: op.id, parentId: oldParent, index: fromIndex }];
    }
    case "set_tokens": {
      // TokenName and ModeName already reject "__proto__"; these checks keep internal callers from
      // ever writing a prototype key into the plain objects of the document.
      if (op.mode === "__proto__") throw new Error("mode name cannot be __proto__");
      const prev: Record<string, string | number | null> = {};
      const prevMeta: Record<string, NonNullable<DocumentT["tokenMeta"]>[string] | undefined> = {};
      const target = op.mode ? ((doc.modes ??= {})[op.mode] ??= {}) : doc.tokens;
      const entries = Object.entries(op.tokens).filter(([k]) => k !== "__proto__");
      for (const [k, v] of entries) {
        prevMeta[k] = doc.tokenMeta?.[k] ? { ...doc.tokenMeta[k] } : undefined;
        prev[k] = Object.hasOwn(target, k) ? (target[k] ?? null) : null;
        if (v === null) delete target[k];
        else target[k] = v;
      }
      const metaTouched = op.type !== undefined || op.collection !== undefined;
      if (metaTouched) {
        for (const [k, v] of entries) {
          if (v === null) continue;
          writeTokenMeta(doc, k, op.type, op.collection);
        }
      }
      for (const [k] of entries) {
        if (!tokenAlive(doc, k)) clearTokenMeta(doc, k);
      }
      for (const [k, v] of entries) {
        if (v === null) continue;
        const type = doc.tokenMeta?.[k]?.type;
        if (!type) continue;
        const problem = tokenAssignProblem(doc, k, v, type, op.mode);
        if (problem) throw new OpError(problem, i);
      }
      if (op.mode && doc.modes) {
        if (Object.keys(target).length === 0) delete doc.modes[op.mode];
        if (Object.keys(doc.modes).length === 0) delete doc.modes;
      }
      const split = metaTouched || entries.some(([k]) => prevMeta[k]);
      if (!split) return [op.mode ? { op: "set_tokens", tokens: prev, mode: op.mode } : { op: "set_tokens", tokens: prev }];
      return entries.map(([k]) => {
        const was = prevMeta[k];
        const died = !tokenAlive(doc, k);
        const extra: { type?: NonNullable<DocumentT["tokenMeta"]>[string]["type"] | null; collection?: string | null } = {};
        if (op.type !== undefined || (died && was?.type)) extra.type = was?.type ?? null;
        if (op.collection !== undefined || (died && was?.collection)) extra.collection = was?.collection ?? null;
        return { op: "set_tokens" as const, tokens: { [k]: prev[k] ?? null }, ...(op.mode ? { mode: op.mode } : {}), ...extra };
      });
    }
    case "detach_tokens": {
      const inverse: Op[] = [];
      let changed = 0;
      for (const id of op.ids) {
        const node = doc.nodes[id];
        if (!node) throw new OpError(`node "${id}" does not exist`, i);
        const owner = copyOwner(doc, node);
        if (owner) throw new OpError(copyRule(id, owner.id), i);
        const props = detachTokenProps(doc, node, op.fields, i);
        if (!props) continue;
        changed++;
        inverse.unshift(...applyOne(doc, Op.parse({ op: "update", id, props }), i, created));
      }
      if (!changed) throw new OpError(`no token to detach on ${op.ids.map((id) => `"${id}"`).join(", ")}`, i);
      return inverse;
    }
    case "rename_document": {
      const prev = doc.name;
      doc.name = op.name;
      return [{ op: "rename_document", name: prev }];
    }
    case "group":
    case "ungroup":
    case "add_page":
    case "detach":
    case "combine_paths":
    case "align":
    case "distribute":
    case "wrap":
    case "reveal": {
      // Expandidas contra o documento *atual* (não o que o cliente via), dentro da mesma transação.
      let plan: Op[];
      try {
        plan =
          op.op === "group"
            ? groupOps(doc, op.ids, { id: op.id, name: op.name }).ops
            : op.op === "ungroup"
              ? ungroupOps(doc, op.ids).ops
              : op.op === "detach"
                ? (syncInstances(doc), detachOps(doc, op.ids))
                : op.op === "combine_paths"
                  ? combinePathsOps(doc, op.ids, { operation: op.operation, id: op.id, name: op.name }).ops
                  : op.op === "align"
                    ? alignOps(doc, op.ids, op.edge).ops
                    : op.op === "distribute"
                      ? distributeOps(doc, op.ids, op.axis).ops
                      : op.op === "wrap"
                        ? wrapOps(doc, op.ids, { id: op.id, name: op.name }).ops
                        : op.op === "reveal"
                          ? revealOps(doc, op.kind, op.pageId).ops
                          : addPageOps(doc, op).ops;
      } catch (e) {
        throw e instanceof OpError ? e : new OpError((e as Error).message, i);
      }
      const inverse: Op[] = [];
      for (const sub of plan) inverse.unshift(...applyOne(doc, Op.parse(sub), i, created));
      return inverse;
    }
  }
}

function tokenAlive(doc: DocumentT, name: string): boolean {
  if (Object.hasOwn(doc.tokens, name)) return true;
  return Object.values(doc.modes ?? {}).some((m) => Object.hasOwn(m, name));
}

function clearTokenMeta(doc: DocumentT, name: string) {
  if (!doc.tokenMeta || !Object.hasOwn(doc.tokenMeta, name)) return;
  delete doc.tokenMeta[name];
  if (Object.keys(doc.tokenMeta).length === 0) delete doc.tokenMeta;
}

function writeTokenMeta(doc: DocumentT, name: string, type: string | null | undefined, collection: string | null | undefined) {
  const next: { type?: string; collection?: string } = { ...(doc.tokenMeta?.[name] ?? {}) };
  if (type !== undefined) {
    if (type === null) delete next.type;
    else next.type = type;
  }
  if (collection !== undefined) {
    if (collection === null) delete next.collection;
    else next.collection = collection;
  }
  if (!next.type && !next.collection) clearTokenMeta(doc, name);
  else (doc.tokenMeta ??= {})[name] = next as NonNullable<DocumentT["tokenMeta"]>[string];
}

function tokenAssignProblem(doc: DocumentT, name: string, value: string | number, type: string, mode?: string): string | undefined {
  let literal: string | number = value;
  if (typeof value === "string" && value.startsWith("$")) {
    const resolved = resolveValue(doc, value, mode);
    if ((typeof resolved === "string" && resolved.startsWith("$")) || (typeof resolved !== "string" && typeof resolved !== "number"))
      return `token "${name}": "${value}" does not resolve to a ${type}`;
    literal = resolved;
  }
  const shown = JSON.stringify(literal);
  switch (type) {
    case "color":
      if (typeof literal !== "string" || !parseColor(literal)) return `token "${name}": type color expects a color, got ${shown}`;
      return;
    case "length":
      if (typeof literal !== "number" || !Number.isFinite(literal)) return `token "${name}": type length expects a number, got ${shown}`;
      return;
    case "fontFamily":
      if (typeof literal !== "string" || literal.length === 0 || literal.length > 200 || /[;{}<>()]/.test(literal))
        return `token "${name}": type fontFamily expects a font family, got ${shown}`;
      return;
    case "fontWeight":
      if (typeof literal !== "number" || !Number.isInteger(literal) || literal < 100 || literal > 900)
        return `token "${name}": type fontWeight expects an integer from 100 to 900, got ${shown}`;
      return;
    case "fontSize":
      if (typeof literal !== "number" || !Number.isFinite(literal) || literal < 1 || literal > 1000)
        return `token "${name}": type fontSize expects a number from 1 to 1000, got ${shown}`;
      return;
    case "lineHeight":
      if (typeof literal !== "number" || !Number.isFinite(literal) || literal < 0 || literal > 10)
        return `token "${name}": type lineHeight expects a number from 0 to 10, got ${shown}`;
      return;
    case "letterSpacing":
      if (typeof literal !== "number" || !Number.isFinite(literal)) return `token "${name}": type letterSpacing expects a number, got ${shown}`;
      return;
    default:
      return `token "${name}": unknown type ${type}`;
  }
}

const TOKEN_FIELDS = new Set([
  "fill",
  "radius",
  "stroke",
  "stroke.color",
  "stroke.width",
  "shadow",
  "shadow.x",
  "shadow.y",
  "shadow.blur",
  "shadow.spread",
  "shadow.color",
  "outline",
  "outline.color",
  "outline.width",
  "outline.offset",
  "filter",
  "filter.blur",
  "backdropFilter",
  "backdropFilter.blur",
  "layout",
  "layout.gap",
  "layout.padding",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
]);

function fieldOn(fields: ReadonlySet<string> | null, name: string): boolean {
  if (!fields) return true;
  if (fields.has(name)) return true;
  const head = name.split(".")[0] ?? name;
  return fields.has(head);
}

function detachScalar(doc: DocumentT, id: string, field: string, value: unknown, mode: string | undefined, kind: "number" | "string", opIndex: number): { value: string | number; changed: boolean } {
  if (typeof value !== "string" || !value.startsWith("$")) return { value: value as string | number, changed: false };
  const resolved = resolveValue(doc, value, mode);
  if (typeof resolved === "string" && resolved.startsWith("$")) throw new OpError(`node "${id}" ${field}: token "${value}" does not resolve`, opIndex);
  if (kind === "number" && typeof resolved !== "number")
    throw new OpError(`node "${id}" ${field}: token "${value}" resolved to ${JSON.stringify(resolved)}, expected a length`, opIndex);
  if (kind === "string" && typeof resolved !== "string")
    throw new OpError(`node "${id}" ${field}: token "${value}" resolved to ${JSON.stringify(resolved)}, expected text`, opIndex);
  return { value: resolved, changed: true };
}

function detachTokenProps(doc: DocumentT, node: NodeT, fields: readonly string[] | undefined, opIndex: number): Record<string, unknown> | undefined {
  if (fields) {
    for (const f of fields) {
      if (!TOKEN_FIELDS.has(f)) throw new OpError(`field "${f}" cannot hold a token`, opIndex);
    }
  }
  const picked = fields ? new Set(fields) : null;
  const mode = modeOf(doc, node);
  const props: Record<string, unknown> = {};
  const on = (name: string) => fieldOn(picked, name);
  if ("fill" in node && on("fill") && node.fill) {
    const got = detachScalar(doc, node.id, "fill", node.fill, mode, "string", opIndex);
    if (got.changed) props.fill = got.value;
  }
  if ("color" in node && on("color")) {
    const got = detachScalar(doc, node.id, "color", node.color, mode, "string", opIndex);
    if (got.changed) props.color = got.value;
  }
  if ("fontFamily" in node && on("fontFamily")) {
    const got = detachScalar(doc, node.id, "fontFamily", node.fontFamily, mode, "string", opIndex);
    if (got.changed) props.fontFamily = got.value;
  }
  if ("fontSize" in node && on("fontSize")) {
    const got = detachScalar(doc, node.id, "fontSize", node.fontSize, mode, "number", opIndex);
    if (got.changed) props.fontSize = got.value;
  }
  if ("fontWeight" in node && on("fontWeight")) {
    const got = detachScalar(doc, node.id, "fontWeight", node.fontWeight, mode, "number", opIndex);
    if (got.changed) props.fontWeight = got.value;
  }
  if ("lineHeight" in node && on("lineHeight")) {
    const got = detachScalar(doc, node.id, "lineHeight", node.lineHeight, mode, "number", opIndex);
    if (got.changed) props.lineHeight = got.value;
  }
  if ("letterSpacing" in node && on("letterSpacing")) {
    const got = detachScalar(doc, node.id, "letterSpacing", node.letterSpacing, mode, "number", opIndex);
    if (got.changed) props.letterSpacing = got.value;
  }
  if ("radius" in node && on("radius")) {
    const radius = node.radius;
    if (Array.isArray(radius)) {
      let changed = false;
      const next = radius.map((item, idx) => {
        const got = detachScalar(doc, node.id, `radius.${idx}`, item, mode, "number", opIndex);
        changed = changed || got.changed;
        return got.value;
      });
      if (changed) props.radius = next;
    } else {
      const got = detachScalar(doc, node.id, "radius", radius, mode, "number", opIndex);
      if (got.changed) props.radius = got.value;
    }
  }
  if ("stroke" in node && node.stroke && (on("stroke") || on("stroke.color") || on("stroke.width"))) {
    const stroke = { ...node.stroke };
    let changed = false;
    if (on("stroke") || on("stroke.color")) {
      const got = detachScalar(doc, node.id, "stroke.color", stroke.color, mode, "string", opIndex);
      if (got.changed) {
        stroke.color = String(got.value);
        changed = true;
      }
    }
    if (on("stroke") || on("stroke.width")) {
      const got = detachScalar(doc, node.id, "stroke.width", stroke.width, mode, "number", opIndex);
      if (got.changed) {
        stroke.width = got.value as number;
        changed = true;
      }
    }
    if (changed) props.stroke = stroke;
  }
  if ("shadow" in node && node.shadow && (on("shadow") || [...TOKEN_FIELDS].some((f) => f.startsWith("shadow.") && on(f)))) {
    const one = (shadow: ShadowSpec, prefix: string) => {
      const next = { ...shadow };
      let changed = false;
      for (const key of ["x", "y", "blur", "spread"] as const) {
        if (!(on("shadow") || on(`shadow.${key}`))) continue;
        const got = detachScalar(doc, node.id, `${prefix}.${key}`, shadow[key], mode, "number", opIndex);
        if (got.changed) {
          next[key] = got.value as number;
          changed = true;
        }
      }
      if (on("shadow") || on("shadow.color")) {
        const got = detachScalar(doc, node.id, `${prefix}.color`, shadow.color, mode, "string", opIndex);
        if (got.changed) {
          next.color = String(got.value);
          changed = true;
        }
      }
      return { next, changed };
    };
    if (Array.isArray(node.shadow)) {
      let changed = false;
      const next = node.shadow.map((shadow, i) => {
        const got = one(shadow, `shadow.${i}`);
        changed = changed || got.changed;
        return got.next;
      });
      if (changed) props.shadow = next;
    } else {
      const got = one(node.shadow, "shadow");
      if (got.changed) props.shadow = got.next;
    }
  }
  if ("outline" in node && node.outline && (on("outline") || on("outline.color") || on("outline.width") || on("outline.offset"))) {
    const outline = { ...node.outline };
    let changed = false;
    if (on("outline") || on("outline.color")) {
      const got = detachScalar(doc, node.id, "outline.color", outline.color, mode, "string", opIndex);
      if (got.changed) {
        outline.color = String(got.value);
        changed = true;
      }
    }
    if (on("outline") || on("outline.width")) {
      const got = detachScalar(doc, node.id, "outline.width", outline.width, mode, "number", opIndex);
      if (got.changed) {
        outline.width = got.value as number;
        changed = true;
      }
    }
    if ((on("outline") || on("outline.offset")) && outline.offset !== undefined) {
      const got = detachScalar(doc, node.id, "outline.offset", outline.offset, mode, "number", opIndex);
      if (got.changed) {
        outline.offset = got.value as number;
        changed = true;
      }
    }
    if (changed) props.outline = outline;
  }
  if ("filter" in node && node.filter?.blur !== undefined && (on("filter") || on("filter.blur"))) {
    const got = detachScalar(doc, node.id, "filter.blur", node.filter.blur, mode, "number", opIndex);
    if (got.changed) props.filter = { ...node.filter, blur: got.value as number };
  }
  if ("backdropFilter" in node && node.backdropFilter?.blur !== undefined && (on("backdropFilter") || on("backdropFilter.blur"))) {
    const got = detachScalar(doc, node.id, "backdropFilter.blur", node.backdropFilter.blur, mode, "number", opIndex);
    if (got.changed) props.backdropFilter = { ...node.backdropFilter, blur: got.value as number };
  }
  if (node.type === "frame" && node.layout && (on("layout") || on("layout.gap") || on("layout.padding"))) {
    const layout = { ...node.layout };
    let changed = false;
    if (on("layout") || on("layout.gap")) {
      const got = detachScalar(doc, node.id, "layout.gap", layout.gap, mode, "number", opIndex);
      if (got.changed) {
        layout.gap = got.value as number;
        changed = true;
      }
    }
    if (on("layout") || on("layout.padding")) {
      const padding = layout.padding;
      if (Array.isArray(padding)) {
        let padChanged = false;
        const next = padding.map((item, idx) => {
          const got = detachScalar(doc, node.id, `layout.padding.${idx}`, item, mode, "number", opIndex);
          padChanged = padChanged || got.changed;
          return got.value as number;
        });
        if (padChanged) {
          layout.padding = next as typeof layout.padding;
          changed = true;
        }
      } else {
        const got = detachScalar(doc, node.id, "layout.padding", padding, mode, "number", opIndex);
        if (got.changed) {
          layout.padding = got.value as number;
          changed = true;
        }
      }
    }
    if (changed) props.layout = layout;
  }
  return Object.keys(props).length ? props : undefined;
}

/**
 * Aplica uma transação de operações de forma atômica: ou todas são aplicadas, ou nenhuma
 * (o documento de entrada nunca é mutado). Retorna o novo documento e as operações inversas.
 */
export function applyOps(doc: DocumentT, ops: readonly Op[]): ApplyResult {
  const draft = structuredClone(doc);
  const inverse: Op[] = [];
  const created: string[] = [];
  const deleted = new Set<string>();
  ops.forEach((raw, i) => {
    const parsed = Op.safeParse(raw);
    if (!parsed.success) throw new OpError(`invalid operation: ${formatZod(parsed.error)}`, i);
    const op = parsed.data;
    if (op.op === "delete") {
      // Um conector que já saiu junto com a forma (ex.: delete_nodes com a forma e a seta) não é erro.
      if (!draft.nodes[op.id] && doc.nodes[op.id]?.type === "connector" && !deleted.has(op.id)) return void deleted.add(op.id);
      deleted.add(op.id);
    }
    inverse.unshift(...applyOne(draft, op, i, created));
  });
  if (ops.length) {
    const last = ops.length - 1;
    checkPages(draft, last);
    applyConstraints(doc, draft);
    inverse.unshift(...fitGroups(draft));
    try {
      syncInstances(draft);
    } catch (e) {
      if (e instanceof InstanceError) throw new OpError(e.message, last);
      throw e;
    }
    // Um group que contém instâncias só sabe o tamanho delas depois da sincronização.
    inverse.unshift(...fitGroups(draft));
    // Conectores seguem as pontas: geometria derivada, sem inversa (o desfazer recalcula).
    const lengthErr = lengthTokenError(draft);
    if (lengthErr) throw new OpError(lengthErr, last);
    try {
      routeConnectors(draft);
    } catch (e) {
      if (e instanceof ConnectorError) throw new OpError(e.message, last);
      throw e;
    }
  }
  return { doc: draft, inverse, created };
}

/** Cria um documento vazio válido. */
export function createDocument(name = defaultUntitledName(), id = newId()): DocumentT {
  return Document.parse({ format: "paprika/1", id, name });
}

/** Valida e normaliza um documento lido do disco (preenche defaults; checa integridade da árvore). */
export function parseDocument(input: unknown): DocumentT {
  const doc = Document.parse(input);
  const seen = new Set<string>();
  const check = (ids: string[], parentId: string | null) => {
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n) throw new Error(`inconsistent document: "${id}" is referenced but missing`);
      if (seen.has(id)) throw new Error(`inconsistent document: "${id}" appears more than once`);
      if (n.parentId !== parentId) throw new Error(`inconsistent document: parentId of "${id}" differs`);
      seen.add(id);
      if (n.type === "page" && parentId !== null) throw new Error(`inconsistent document: page "${id}" outside the top level`);
      if (isContainer(n)) check(n.children, id);
    }
  };
  check(doc.rootIds, null);
  const rootTypes = new Set(doc.rootIds.map((id) => doc.nodes[id]!.type === "page"));
  if (rootTypes.size > 1) throw new Error("inconsistent document: with pages, every top-level node must be a page");
  const orphans = Object.keys(doc.nodes).filter((id) => !seen.has(id));
  if (orphans.length) throw new Error(`inconsistent document: orphan nodes ${orphans.join(", ")}`);
  return doc;
}

/** Num documento com páginas, o nível superior só tem páginas (checado no fim da transação). */
function checkPages(doc: DocumentT, i: number) {
  if (!doc.rootIds.some((id) => doc.nodes[id]?.type === "page")) return;
  const loose = doc.rootIds.filter((id) => doc.nodes[id]?.type !== "page");
  if (loose.length)
    throw new OpError(
      `the document has pages, but ${loose.map((id) => `"${id}"`).join(", ")} is at the canvas level; move it to a page (parentId = the page id)`,
      i,
    );
}


const EPS = 1e-3;

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
    if (n.type === "group" && n.sourceId === undefined) fitGroup(doc, n, inverse);
  };
  doc.rootIds.forEach(visit);
  return inverse;
}

function fitGroup(doc: DocumentT, g: GroupNode, inverse: Op[]) {
  // Conectores não contam: a caixa deles é derivada das pontas (e recalculada depois).
  const kids = g.children.map((c) => doc.nodes[c]).filter(isScene).filter((k) => k.type !== "connector");
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
