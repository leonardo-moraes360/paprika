import { Node, isContainer, type ConnectorEnd, type Document, type FrameNode, type Node as NodeT } from "./schema.js";
import { round4 } from "./num.js";

/**
 * Componentes e instâncias.
 *
 * Um componente é um frame com `component: true`. Uma instância é um frame com
 * `instanceOf: <id do componente>`: os filhos dela são cópias do desenho do componente, geradas
 * de novo ao fim de cada transação (`syncInstances`), escaladas por `scale` e com `overrides`
 * aplicados. As cópias têm ids derivados (instância + nó de origem) e `sourceId` apontando para o
 * nó do componente. Como são derivadas, não entram no desfazer: desfazer a mudança no componente
 * (ou na instância) e sincronizar de novo basta.
 *
 * Numa cópia, `update` só troca campos de aparência (`COPY_OVERRIDES`) e grava o valor em
 * `overrides` da instância; geometria e estrutura vêm do componente.
 */

/** Campos de uma cópia que podem ser trocados numa instância. */
export const COPY_OVERRIDES = ["fill", "color", "text", "src", "alt", "visible", "opacity"] as const;
/** Campos da raiz da instância que vêm do componente (só `fill` aceita override). */
export const ROOT_DERIVED = ["fill", "stroke", "radius", "shadow", "layout", "clip", "width", "height"] as const;

const COPY_SET = new Set<string>(COPY_OVERRIDES);
const ROOT_SET = new Set<string>(ROOT_DERIVED);

export function isInstance(n: NodeT | undefined): n is FrameNode & { instanceOf: string } {
  return n?.type === "frame" && typeof n.instanceOf === "string";
}

/** Instância que contém `id` (o próprio nó, se for instância, ou o ancestral mais próximo). */
export function instanceOwner(doc: Document, id: string | null): (FrameNode & { instanceOf: string }) | undefined {
  for (let cur = id; cur; cur = doc.nodes[cur]?.parentId ?? null) {
    const n = doc.nodes[cur];
    if (isInstance(n)) return n;
  }
  return undefined;
}

/** Se `n` é uma cópia gerada dentro de uma instância, devolve a instância. */
export function copyOwner(doc: Document, n: NodeT): (FrameNode & { instanceOf: string }) | undefined {
  if (n.type === "page" || n.sourceId === undefined) return undefined;
  return instanceOwner(doc, n.parentId);
}

export function isCopyOverride(key: string): boolean {
  return COPY_SET.has(key);
}

export function isRootDerived(key: string): boolean {
  return ROOT_SET.has(key);
}

function formatIssues(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619) >>> 0;
  return h;
}

/** Id determinístico da cópia de `srcId` dentro da instância `instId` (igual em TS e Go). */
export function copyId(instId: string, srcId: string): string {
  const a = fnv(`${instId}/${srcId}`).toString(36).padStart(7, "0");
  const b = fnv(`${srcId}/${instId}`).toString(36).padStart(7, "0");
  return `${instId.slice(0, 40)}-${a}${b}`;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Valor atual de um campo no nó do componente (undefined vira null). */
export function sourceValue(n: NodeT | undefined, key: string): unknown {
  const v = n ? (n as Record<string, unknown>)[key] : undefined;
  return v === undefined ? null : v;
}

/**
 * Grava um override: `v` null (ou igual ao componente) remove; senão substitui. Muta a instância.
 */
export function setOverride(inst: FrameNode, srcId: string, key: string, v: unknown, src: NodeT | undefined) {
  // Nunca grava chaves que mexem no protótipo (o schema já as recusa; isto protege chamadas internas).
  if (srcId === "__proto__" || key === "__proto__") return;
  // Work on Maps and build plain objects with Object.fromEntries: no key from the caller is ever
  // assigned with obj[key] = …, so nothing can reach Object.prototype.
  const all = new Map(Object.entries(inst.overrides ?? {}));
  const ov = new Map(Object.entries(all.get(srcId) ?? {}));
  if (v === null || jsonEqual(v, sourceValue(src, key))) ov.delete(key);
  else ov.set(key, v);
  if (ov.size) all.set(srcId, Object.fromEntries(ov));
  else all.delete(srcId);
  if (all.size) inst.overrides = Object.fromEntries(all);
  else delete inst.overrides;
}

export function scaleGeometry(n: Record<string, unknown>, s: number, withPosition: boolean) {
  if (s === 1) return;
  const sc = (v: unknown) => (typeof v === "number" ? round4(v * s) : v);
  if (n.type === "path" && !n.viewBox && typeof n.width === "number" && typeof n.height === "number")
    n.viewBox = [0, 0, n.width, n.height];
  if (withPosition) {
    n.x = sc(n.x);
    n.y = sc(n.y);
  }
  for (const k of ["width", "height", "radius", "letterSpacing", "fontSize"]) if (k in n) n[k] = sc(n[k]);
  const stroke = n.stroke as Record<string, unknown> | undefined;
  if (stroke) n.stroke = { ...stroke, width: sc(stroke.width) };
  const shadow = n.shadow as Record<string, unknown> | undefined;
  if (shadow) n.shadow = { ...shadow, x: sc(shadow.x), y: sc(shadow.y), blur: sc(shadow.blur), spread: sc(shadow.spread) };
  const layout = n.layout as Record<string, unknown> | undefined;
  if (layout)
    n.layout = { ...layout, gap: sc(layout.gap), padding: Array.isArray(layout.padding) ? layout.padding.map(sc) : sc(layout.padding) };
}

/** Ponta de um conector copiado: nó do componente vira a cópia; ponto solto escala com a instância. */
function copyEnd(e: ConnectorEnd, instId: string, inComp: ReadonlySet<string>, s: number): ConnectorEnd {
  const out = { ...e };
  if (out.nodeId !== undefined && inComp.has(out.nodeId)) out.nodeId = copyId(instId, out.nodeId);
  if (s !== 1) {
    if (out.x !== undefined) out.x = round4(out.x * s);
    if (out.y !== undefined) out.y = round4(out.y * s);
  }
  return out;
}

function descendants(doc: Document, id: string): string[] {
  const out: string[] = [];
  const walk = (nid: string) => {
    const n = doc.nodes[nid];
    if (!isContainer(n)) return;
    for (const c of n.children) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

/** Erro de regra de componentes, sem índice de op (quem chama adiciona). */
export class InstanceError extends Error {}

/**
 * Checa as regras e gera de novo as cópias de todas as instâncias. Chamado no fim de cada
 * transação; muta `doc`.
 */
export function syncInstances(doc: Document): void {
  const all = Object.values(doc.nodes);
  for (const n of all) {
    if (n.type === "page") continue;
    if (n.type === "frame" && n.component && isInstance(n)) throw new InstanceError(`"${n.id}" is an instance and cannot be a component`);
    if (n.type === "frame" && n.component) {
      const inner = descendants(doc, n.id).find((d) => isInstance(doc.nodes[d]));
      if (inner)
        throw new InstanceError(`component "${n.id}" contains the instance "${inner}"; instances inside components are not supported yet (detach it)`);
    }
    if (isInstance(n)) {
      const c = doc.nodes[n.instanceOf];
      if (!c) throw new InstanceError(`instance "${n.id}": component "${n.instanceOf}" does not exist`);
      if (c.type !== "frame" || !c.component)
        throw new InstanceError(`instance "${n.id}": "${n.instanceOf}" is not a component (set component: true on a frame)`);
    }
    if (n.sourceId !== undefined && !copyOwner(doc, n))
      throw new InstanceError(`"${n.id}" has a sourceId outside an instance; sourceId is generated by instances`);
  }
  for (const n of all) if (isInstance(n) && doc.nodes[n.id] === n) buildInstance(doc, n);
}

function buildInstance(doc: Document, inst: FrameNode & { instanceOf: string }) {
  const comp = doc.nodes[inst.instanceOf] as FrameNode;
  const s = inst.scale ?? 1;
  const overrides = inst.overrides ?? {};
  for (const [srcId, ov] of Object.entries(overrides))
    for (const k of Object.keys(ov)) {
      const ok = srcId === comp.id ? k === "fill" : COPY_SET.has(k);
      if (!ok)
        throw new InstanceError(
          `instance "${inst.id}": override "${k}" in "${srcId}" is not allowed (root: fill; copies: ${COPY_OVERRIDES.join(", ")})`,
        );
    }

  // Raiz: aparência e tamanho do componente (escalados); posição, rotação, opacidade etc. são da instância.
  const root: Record<string, unknown> = { ...inst };
  const src = comp as Record<string, unknown>;
  for (const k of ROOT_DERIVED) {
    if (k in src) root[k] = structuredClone(src[k]);
    else delete root[k];
  }
  scaleGeometry(root, s, false);
  if (overrides[comp.id] && "fill" in overrides[comp.id]!) root.fill = overrides[comp.id]!.fill;
  const parsedRoot = Node.safeParse(root);
  if (!parsedRoot.success) throw new InstanceError(`instance "${inst.id}": invalid override on the root: ${formatIssues(parsedRoot.error)}`);

  const inComp = new Set(descendants(doc, comp.id));
  const want: NodeT[] = [];
  const copy = (srcId: string, parentId: string): string => {
    const srcNode = doc.nodes[srcId]!;
    const id = copyId(inst.id, srcId);
    const existing = doc.nodes[id];
    if (existing && (existing.type === "page" || existing.sourceId !== srcId || instanceOwner(doc, existing.parentId) !== inst))
      throw new InstanceError(`instance "${inst.id}": the generated id "${id}" is already used by another node`);
    const n = structuredClone(srcNode) as Record<string, unknown>;
    n.id = id;
    n.parentId = parentId;
    n.sourceId = srcId;
    delete n.component;
    scaleGeometry(n, s, true);
    // Um conector dentro do componente se prende às cópias da mesma instância.
    if (n.type === "connector") {
      for (const k of ["from", "to"] as const) n[k] = copyEnd(n[k] as ConnectorEnd, inst.id, inComp, s);
      if (s !== 1 && n.control && typeof n.control === "object") {
        const ctl = n.control as { x: number; y: number };
        n.control = { x: round4(ctl.x * s), y: round4(ctl.y * s) };
      }
    }
    for (const [k, v] of Object.entries(overrides[srcId] ?? {})) n[k] = v;
    const slot = want.length;
    want.push(undefined as unknown as NodeT);
    if (isContainer(srcNode)) n.children = srcNode.children.map((c) => copy(c, id));
    const parsed = Node.safeParse(n);
    if (!parsed.success)
      throw new InstanceError(`instance "${inst.id}": invalid override on "${srcId}": ${formatIssues(parsed.error)}`);
    want[slot] = parsed.data;
    return id;
  };
  const children = comp.children.map((c) => copy(c, inst.id));
  const nextRoot = { ...parsedRoot.data, children } as NodeT;

  const old = descendants(doc, inst.id);
  const same =
    jsonEqual(nextRoot, inst) &&
    old.length === want.length &&
    want.every((n, k) => old[k] === n.id && jsonEqual(doc.nodes[n.id], n));
  if (same) return;
  for (const id of old) delete doc.nodes[id];
  doc.nodes[inst.id] = nextRoot;
  for (const n of want) doc.nodes[n.id] = n;
}

/**
 * Desanexa instâncias: viram frames comuns, com as cópias como nós normais (mesmos ids).
 * Gera só `update`s, então o desfazer volta à instância.
 */
export function detachOps(doc: Document, ids: readonly string[]): { op: "update"; id: string; props: Record<string, unknown> }[] {
  if (!ids.length) throw new Error("pass at least one instance id");
  const ops: { op: "update"; id: string; props: Record<string, unknown> }[] = [];
  for (const id of new Set(ids)) {
    const n = doc.nodes[id];
    if (!n) throw new Error(`node "${id}" does not exist`);
    if (!isInstance(n)) throw new Error(`node "${id}" is not an instance (a frame with instanceOf)`);
    ops.push({ op: "update", id, props: { instanceOf: null, scale: null, overrides: null } });
    for (const d of descendants(doc, id)) ops.push({ op: "update", id: d, props: { sourceId: null } });
  }
  return ops;
}
