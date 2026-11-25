import {
  Node,
  isContainer,
  type ConnectorEnd,
  type Document,
  type FrameNode,
  type Node as NodeT,
} from "./schema.js";
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
 *
 * Um componente declara `componentProps` (text, boolean, variant). Nós dentro dele usam `bind`
 * para ligar `text`, `visible` ou uma variante. `slot` num frame ou grupo marca um buraco que a
 * instância preenche com `slots` (ids de nós clonados). Instâncias dentro de componentes são
 * permitidas; um override nelas usa o caminho `instancia/copia` na instância de fora.
 */

/** Campos de uma cópia que podem ser trocados numa instância. */
export const COPY_OVERRIDES = ["fill", "color", "text", "src", "alt", "visible", "opacity", "runs"] as const;
/** Campos da raiz da instância que vêm do componente (só `fill` aceita override). */
export const ROOT_DERIVED = ["fill", "stroke", "radius", "shadow", "outline", "filter", "backdropFilter", "layout", "clip", "width", "height"] as const;

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
  for (const k of ["width", "height", "radius", "letterSpacing", "fontSize"]) {
    if (!(k in n)) continue;
    const v = n[k];
    n[k] = k === "radius" && Array.isArray(v) ? v.map(sc) : sc(v);
  }
  if (Array.isArray(n.runs)) {
    n.runs = n.runs.map((item) => {
      if (!item || typeof item !== "object") return item;
      const run = { ...(item as Record<string, unknown>) };
      if ("fontSize" in run) run.fontSize = sc(run.fontSize);
      return run;
    });
  }
  const stroke = n.stroke as Record<string, unknown> | undefined;
  if (stroke) n.stroke = { ...stroke, width: sc(stroke.width) };
  const shadow = n.shadow as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (shadow) {
    const scaleOne = (s: Record<string, unknown>) => ({ ...s, x: sc(s.x), y: sc(s.y), blur: sc(s.blur), spread: sc(s.spread) });
    n.shadow = Array.isArray(shadow) ? shadow.map(scaleOne) : scaleOne(shadow);
  }
  const outline = n.outline as Record<string, unknown> | undefined;
  if (outline) n.outline = { ...outline, width: sc(outline.width), ...( "offset" in outline ? { offset: sc(outline.offset) } : {}) };
  for (const key of ["filter", "backdropFilter"] as const) {
    const fx = n[key] as Record<string, unknown> | undefined;
    if (fx && "blur" in fx) n[key] = { ...fx, blur: sc(fx.blur) };
  }
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

type PropDecl = { name: string; type: "text" | "boolean" | "variant"; default?: string | boolean; options?: string[] };
type BindSpec = { text?: string; visible?: string; variant?: Record<string, string> };

function propDecls(comp: FrameNode): PropDecl[] {
  return comp.componentProps ?? [];
}

function nodeBind(n: NodeT): BindSpec | undefined {
  return "bind" in n ? n.bind : undefined;
}

function nodeSlot(n: NodeT): string | undefined {
  return "slot" in n ? n.slot : undefined;
}

function nodeSource(n: NodeT | undefined): string | undefined {
  if (!n || n.type === "page") return undefined;
  return n.sourceId;
}

/** Componente cuja definição inclui `id` (para antes de uma instância no caminho). */
export function owningComponent(doc: Document, id: string): FrameNode | undefined {
  let cur = doc.nodes[id]?.parentId ?? null;
  while (cur) {
    const n = doc.nodes[cur];
    if (!n) return undefined;
    if (isInstance(n)) return undefined;
    if (n.type === "frame" && n.component) return n;
    cur = n.parentId;
  }
  return undefined;
}

function resolvedProps(comp: FrameNode, inst: FrameNode): Record<string, string | boolean> {
  const given = inst.propValues ?? {};
  const out: Record<string, string | boolean> = {};
  for (const p of propDecls(comp)) {
    const v = given[p.name];
    if (v !== undefined) out[p.name] = v;
    else if (p.default !== undefined) out[p.name] = p.default;
    else if (p.type === "boolean") out[p.name] = false;
    else if (p.type === "text") out[p.name] = "";
    else out[p.name] = p.options?.[0] ?? "";
  }
  return out;
}

function variantShows(bind: BindSpec | undefined, values: Record<string, string | boolean>): boolean {
  if (!bind?.variant) return true;
  for (const [k, want] of Object.entries(bind.variant)) if (values[k] !== want) return false;
  return true;
}

function applyBind(n: Record<string, unknown>, bind: BindSpec | undefined, values: Record<string, string | boolean>) {
  if (!bind) return;
  if (bind.text && (n.type === "text" || n.type === "shape")) {
    const v = values[bind.text];
    if (typeof v === "string") n.text = v;
  }
  if (bind.visible) {
    const v = values[bind.visible];
    if (typeof v === "boolean") n.visible = v;
  }
}

function componentRefs(doc: Document, compId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!isContainer(n)) return;
    for (const c of n.children) {
      const ch = doc.nodes[c];
      if (!ch || nodeSource(ch)) continue;
      if (isInstance(ch)) out.push(ch.instanceOf);
      else walk(c);
    }
  };
  walk(compId);
  return out;
}

function checkCycles(doc: Document) {
  const comps = Object.values(doc.nodes).filter((n): n is FrameNode => n.type === "frame" && n.component === true);
  const edges = new Map<string, string[]>();
  for (const c of comps) edges.set(c.id, componentRefs(doc, c.id));
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const dfs = (id: string) => {
    color.set(id, 1);
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (!edges.has(next)) continue;
      const state = color.get(next) ?? 0;
      if (state === 1) {
        const i = stack.indexOf(next);
        throw new InstanceError(`component cycle: ${[...stack.slice(i), next].map((s) => `"${s}"`).join(" → ")}`);
      }
      if (state === 0) dfs(next);
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const c of comps) if ((color.get(c.id) ?? 0) === 0) dfs(c.id);
}

function definitionSlots(doc: Document, compId: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!isContainer(n)) return;
    for (const c of n.children) {
      const ch = doc.nodes[c];
      if (!ch || nodeSource(ch)) continue;
      const slot = nodeSlot(ch);
      if (slot) {
        if (out.has(slot)) throw new InstanceError(`component "${compId}": duplicate slot "${slot}"`);
        out.set(slot, ch.id);
      }
      if (!isInstance(ch)) walk(c);
    }
  };
  walk(compId);
  return out;
}

function validatePropDecl(comp: FrameNode, p: PropDecl) {
  if (p.type === "text" && p.default !== undefined && typeof p.default !== "string")
    throw new InstanceError(`component "${comp.id}": text prop "${p.name}" default must be text`);
  if (p.type === "boolean" && p.default !== undefined && typeof p.default !== "boolean")
    throw new InstanceError(`component "${comp.id}": boolean prop "${p.name}" default must be boolean`);
  if (p.type === "variant") {
    if (!p.options?.length) throw new InstanceError(`component "${comp.id}": variant "${p.name}" needs options`);
    if (typeof p.default !== "string" || !p.options.includes(p.default))
      throw new InstanceError(`component "${comp.id}": variant "${p.name}" default "${String(p.default)}" is not an option`);
  }
}

function bindOutsideMessage(doc: Document, id: string): string {
  let inInstance: string | undefined;
  for (let cur = doc.nodes[id]?.parentId ?? null; cur; cur = doc.nodes[cur]?.parentId ?? null) {
    const a = doc.nodes[cur];
    if (a && isInstance(a)) {
      inInstance = a.id;
      break;
    }
  }
  const why = inInstance
    ? `it sits inside the instance "${inInstance}", and a bind belongs on the component's own nodes`
    : `none of its ancestors is a component`;
  return `"${id}" has a bind outside a component: ${why}; the frame that contains it must be a component (component: true, or create_component) when the transaction ends`;
}

function validateBind(comp: FrameNode, n: NodeT, byName: Map<string, PropDecl>) {
  const bind = nodeBind(n);
  if (!bind) return;
  if (bind.text) {
    const p = byName.get(bind.text);
    if (!p || p.type !== "text") throw new InstanceError(`component "${comp.id}": "${n.id}" binds text prop "${bind.text}", which is not a text prop`);
    if (n.type !== "text" && n.type !== "shape")
      throw new InstanceError(`component "${comp.id}": "${n.id}" binds text, but only text and shape nodes can`);
  }
  if (bind.visible) {
    const p = byName.get(bind.visible);
    if (!p || p.type !== "boolean")
      throw new InstanceError(`component "${comp.id}": "${n.id}" binds visible prop "${bind.visible}", which is not a boolean prop`);
  }
  for (const [k, want] of Object.entries(bind.variant ?? {})) {
    const p = byName.get(k);
    if (!p || p.type !== "variant" || !p.options?.includes(want))
      throw new InstanceError(`component "${comp.id}": "${n.id}" variant bind "${k}=${want}" does not match a variant prop`);
  }
}

function insideOf(doc: Document, id: string, ancestor: string): boolean {
  for (let cur: string | null = id; cur; cur = doc.nodes[cur]?.parentId ?? null) if (cur === ancestor) return true;
  return false;
}

function subtreeHas(doc: Document, root: string, target: string): boolean {
  if (root === target) return true;
  const n = doc.nodes[root];
  if (!isContainer(n)) return false;
  return n.children.some((c) => subtreeHas(doc, c, target));
}

/**
 * Instância onde um override de cópia é gravado, e a chave (id ou caminho `instancia/copia`).
 * Cópias dentro de uma instância aninhada sobem até a instância que não é cópia.
 */
export function copyOverrideTarget(
  doc: Document,
  node: NodeT,
): { inst: FrameNode & { instanceOf: string }; key: string } | undefined {
  const owner = copyOwner(doc, node);
  if (!owner || nodeSource(node) === undefined) return undefined;
  let key = nodeSource(node)!;
  let inst = owner;
  while (inst.sourceId) {
    key = `${inst.sourceId}/${key}`;
    const outer = copyOwner(doc, inst);
    if (!outer) return undefined;
    inst = outer;
  }
  return { inst, key };
}

export function overrideFields(node: NodeT): readonly string[] {
  return isInstance(node) ? [...COPY_OVERRIDES, "propValues", "slots"] : COPY_OVERRIDES;
}

function overrideSource(doc: Document, srcId: string): NodeT | undefined {
  const leaf = srcId.includes("/") ? srcId.slice(srcId.lastIndexOf("/") + 1) : srcId;
  return doc.nodes[leaf];
}

/**
 * Checa as regras e gera de novo as cópias de todas as instâncias. Chamado no fim de cada
 * transação; muta `doc`.
 */
function propMap(comp: FrameNode): Map<string, PropDecl> {
  const byName = new Map<string, PropDecl>();
  for (const p of propDecls(comp)) {
    if (byName.has(p.name)) throw new InstanceError(`component "${comp.id}": duplicate prop "${p.name}"`);
    validatePropDecl(comp, p);
    byName.set(p.name, p);
  }
  return byName;
}

function validateInstanceValues(doc: Document, inst: FrameNode & { instanceOf: string }, comp: FrameNode) {
  const byName = propMap(comp);
  for (const [k, v] of Object.entries(inst.propValues ?? {})) {
    const p = byName.get(k);
    if (!p) throw new InstanceError(`instance "${inst.id}": unknown prop "${k}"`);
    if (p.type === "boolean" && typeof v !== "boolean") throw new InstanceError(`instance "${inst.id}": prop "${k}" expects a boolean`);
    if (p.type !== "boolean" && typeof v !== "string") throw new InstanceError(`instance "${inst.id}": prop "${k}" expects text`);
    if (p.type === "variant" && !p.options?.includes(v as string))
      throw new InstanceError(`instance "${inst.id}": prop "${k}" value "${String(v)}" is not an option`);
  }
  const slots = definitionSlots(doc, comp.id);
  for (const [name, ids] of Object.entries(inst.slots ?? {})) {
    if (!slots.has(name)) throw new InstanceError(`instance "${inst.id}": unknown slot "${name}"`);
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n || n.type === "page") throw new InstanceError(`instance "${inst.id}": slot "${name}" node "${id}" does not exist`);
      if (insideOf(doc, id, inst.id) || subtreeHas(doc, id, inst.id))
        throw new InstanceError(`instance "${inst.id}": slot "${name}" node "${id}" is inside the instance`);
    }
  }
}

function mergeOverrideMaps(
  base: FrameNode["overrides"] | undefined,
  extra: Record<string, Record<string, unknown>>,
): FrameNode["overrides"] {
  const all = new Map(Object.entries(base ?? {}));
  for (const [k, v] of Object.entries(extra)) {
    const prev = new Map(Object.entries(all.get(k) ?? {}));
    for (const [fk, fv] of Object.entries(v)) prev.set(fk, fv);
    if (prev.size) all.set(k, Object.fromEntries(prev));
    else all.delete(k);
  }
  return all.size ? (Object.fromEntries(all) as FrameNode["overrides"]) : undefined;
}

function ownedBy(doc: Document, nodeId: string | null, instId: string): boolean {
  let cur = instanceOwner(doc, nodeId);
  while (cur) {
    if (cur.id === instId) return true;
    if (!cur.sourceId) return false;
    cur = instanceOwner(doc, cur.parentId);
  }
  return false;
}

/**
 * Checa as regras e gera de novo as cópias de todas as instâncias. Chamado no fim de cada
 * transação; muta `doc`.
 */
export function syncInstances(doc: Document): void {
  const all = Object.values(doc.nodes);
  for (const n of all) {
    if (n.type === "page") continue;
    if (n.type === "frame" && n.component && isInstance(n)) throw new InstanceError(`"${n.id}" is an instance and cannot be a component`);
    if (n.type === "frame" && n.componentProps && !n.component)
      throw new InstanceError(`"${n.id}" has componentProps but is not a component`);
    if (n.type === "frame" && n.propValues && !isInstance(n)) throw new InstanceError(`"${n.id}" has propValues but is not an instance`);
    if (n.type === "frame" && n.slots && !isInstance(n)) throw new InstanceError(`"${n.id}" has slots but is not an instance`);
    if (n.type === "frame" && n.component) {
      propMap(n);
      definitionSlots(doc, n.id);
    }
    if (isInstance(n)) {
      const c = doc.nodes[n.instanceOf];
      if (!c) throw new InstanceError(`instance "${n.id}": component "${n.instanceOf}" does not exist`);
      if (c.type !== "frame" || !c.component)
        throw new InstanceError(`instance "${n.id}": "${n.instanceOf}" is not a component (set component: true on a frame)`);
      else validateInstanceValues(doc, n, c);
    }
    if (nodeBind(n) && nodeSource(n) === undefined && !(n.type === "frame" && n.component)) {
      const owner = owningComponent(doc, n.id);
      if (!owner) throw new InstanceError(bindOutsideMessage(doc, n.id));
      validateBind(owner, n, propMap(owner));
    }
    if (nodeSource(n) !== undefined && !copyOwner(doc, n))
      throw new InstanceError(`"${n.id}" has a sourceId outside an instance; sourceId is generated by instances`);
  }
  checkCycles(doc);
  for (const n of Object.values(doc.nodes)) if (isInstance(n) && doc.nodes[n.id] === n) buildInstance(doc, n);
}

function overrideAllowed(doc: Document, comp: FrameNode, srcId: string, key: string): boolean {
  if (srcId === comp.id) return key === "fill";
  if (key === "propValues" || key === "slots") return isInstance(doc.nodes[srcId.split("/")[0] ?? ""]);
  return COPY_SET.has(key);
}

function materialize(doc: Document, inst: FrameNode & { instanceOf: string }): { root: NodeT; nodes: NodeT[] } {
  const comp = doc.nodes[inst.instanceOf] as FrameNode;
  const s = inst.scale ?? 1;
  const overrides = inst.overrides ?? {};
  const values = resolvedProps(comp, inst);
  for (const [srcId, ov] of Object.entries(overrides))
    for (const k of Object.keys(ov))
      if (!overrideAllowed(doc, comp, srcId, k))
        throw new InstanceError(
          `instance "${inst.id}": override "${k}" in "${srcId}" is not allowed (root: fill; copies: ${COPY_OVERRIDES.join(", ")}; instance path: propValues, slots)`,
        );

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

  const inComp = definitionIds(doc, comp.id);
  const want: NodeT[] = [];
  const claim = (id: string, srcId: string) => {
    const existing = doc.nodes[id];
    if (existing && (existing.type === "page" || nodeSource(existing) !== srcId || !ownedBy(doc, existing.parentId, inst.id)))
      throw new InstanceError(`instance "${inst.id}": the generated id "${id}" is already used by another node`);
  };
  const copy = (srcId: string, parentId: string): string | undefined => {
    const srcNode = doc.nodes[srcId];
    if (!srcNode || nodeSource(srcNode)) return undefined;
    if (!variantShows(nodeBind(srcNode), values)) return undefined;
    const id = copyId(inst.id, srcId);
    claim(id, srcId);
    if (isInstance(srcNode)) return nest(srcNode, srcId, id, parentId);
    const n = structuredClone(srcNode) as Record<string, unknown>;
    n.id = id;
    n.parentId = parentId;
    n.sourceId = srcId;
    delete n.component;
    scaleGeometry(n, s, true);
    if (n.type === "connector") {
      for (const k of ["from", "to"] as const) n[k] = copyEnd(n[k] as ConnectorEnd, inst.id, inComp, s);
      if (s !== 1 && n.control && typeof n.control === "object") {
        const ctl = n.control as { x: number; y: number };
        n.control = { x: round4(ctl.x * s), y: round4(ctl.y * s) };
      }
    }
    applyBind(n, nodeBind(srcNode), values);
    for (const [k, v] of Object.entries(overrides[srcId] ?? {})) n[k] = structuredClone(v);
    const slot = want.length;
    want.push(undefined as unknown as NodeT);
    const slotName = nodeSlot(srcNode);
    if (slotName && inst.slots && Object.hasOwn(inst.slots, slotName)) n.children = cloneSlot(srcId, id, inst.slots[slotName] ?? []);
    else if (isContainer(srcNode)) {
      const kids: string[] = [];
      for (const c of srcNode.children) {
        const cid = copy(c, id);
        if (cid) kids.push(cid);
      }
      n.children = kids;
    }
    const parsed = Node.safeParse(n);
    if (!parsed.success) throw new InstanceError(`instance "${inst.id}": invalid override on "${srcId}": ${formatIssues(parsed.error)}`);
    want[slot] = parsed.data;
    return id;
  };
  function nest(srcNode: FrameNode & { instanceOf: string }, srcId: string, id: string, parentId: string): string {
    const n = structuredClone(srcNode) as Record<string, unknown>;
    n.id = id;
    n.parentId = parentId;
    n.sourceId = srcId;
    delete n.component;
    const own = (overrides[srcId] ?? {}) as Record<string, unknown>;
    const prefix = `${srcId}/`;
    const nested: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(overrides)) if (k.startsWith(prefix)) nested[k.slice(prefix.length)] = v;
    let merged = mergeOverrideMaps(srcNode.overrides, nested);
    if ("fill" in own) merged = mergeOverrideMaps(merged, { [srcNode.instanceOf]: { fill: own.fill } });
    if (merged) n.overrides = merged;
    else delete n.overrides;
    applyBind(n, nodeBind(srcNode), values);
    for (const [k, v] of Object.entries(own)) {
      if (k === "fill") continue;
      if (k === "propValues" || k === "slots" || COPY_SET.has(k)) n[k] = structuredClone(v);
    }
    const inner = typeof n.scale === "number" ? n.scale : 1;
    const eff = round4(inner * s);
    if (eff !== 1) n.scale = eff;
    else delete n.scale;
    if (s !== 1) {
      n.x = round4(Number(n.x) * s);
      n.y = round4(Number(n.y) * s);
    }
    n.children = [];
    const shell = Node.safeParse(n);
    if (!shell.success) throw new InstanceError(`instance "${inst.id}": invalid override on "${srcId}": ${formatIssues(shell.error)}`);
    const shellNode = shell.data;
    if (shellNode.type !== "frame" || typeof shellNode.instanceOf !== "string")
      throw new InstanceError(`instance "${inst.id}": invalid override on "${srcId}": not an instance`);
    const innerTree = materialize(doc, { ...shellNode, instanceOf: shellNode.instanceOf });
    want.push(innerTree.root, ...innerTree.nodes);
    return innerTree.root.id;
  }
  function cloneSlot(slotFrameId: string, parentId: string, ids: readonly string[]): string[] {
    const map = new Map<string, string>();
    const index = (nid: string) => {
      const node = doc.nodes[nid];
      if (!node || node.type === "page") return;
      map.set(nid, copyId(inst.id, `${slotFrameId}/${nid}`));
      if (isContainer(node) && !isInstance(node)) for (const c of node.children) index(c);
    };
    for (const id of ids) index(id);
    const walk = (nid: string, parent: string): string => {
      const srcNode = doc.nodes[nid];
      if (!srcNode || srcNode.type === "page") throw new InstanceError(`instance "${inst.id}": slot node "${nid}" does not exist`);
      const path = `${slotFrameId}/${nid}`;
      const id = map.get(nid)!;
      claim(id, path);
      if (isInstance(srcNode)) return nest(srcNode, path, id, parent);
      const n = structuredClone(srcNode) as Record<string, unknown>;
      n.id = id;
      n.parentId = parent;
      n.sourceId = path;
      delete n.component;
      scaleGeometry(n, s, true);
      if (n.type === "connector") {
        for (const k of ["from", "to"] as const) {
          const end = { ...(n[k] as ConnectorEnd) };
          if (end.nodeId && map.has(end.nodeId)) end.nodeId = map.get(end.nodeId);
          if (s !== 1) {
            if (end.x !== undefined) end.x = round4(end.x * s);
            if (end.y !== undefined) end.y = round4(end.y * s);
          }
          n[k] = end;
        }
        if (s !== 1 && n.control && typeof n.control === "object") {
          const ctl = n.control as { x: number; y: number };
          n.control = { x: round4(ctl.x * s), y: round4(ctl.y * s) };
        }
      }
      for (const [k, v] of Object.entries(overrides[path] ?? {})) n[k] = structuredClone(v);
      const slot = want.length;
      want.push(undefined as unknown as NodeT);
      if (isContainer(srcNode)) n.children = srcNode.children.map((c) => walk(c, id));
      const parsed = Node.safeParse(n);
      if (!parsed.success) throw new InstanceError(`instance "${inst.id}": invalid override on "${path}": ${formatIssues(parsed.error)}`);
      want[slot] = parsed.data;
      return id;
    };
    return ids.map((id) => walk(id, parentId));
  }
  const children: string[] = [];
  for (const c of comp.children) {
    const cid = copy(c, inst.id);
    if (cid) children.push(cid);
  }
  const nextRoot = { ...parsedRoot.data, children } as NodeT;
  return { root: nextRoot, nodes: want };
}

function definitionIds(doc: Document, compId: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!isContainer(n)) return;
    for (const c of n.children) {
      const ch = doc.nodes[c];
      if (!ch || nodeSource(ch)) continue;
      out.add(c);
      if (!isInstance(ch)) walk(c);
    }
  };
  walk(compId);
  return out;
}

function buildInstance(doc: Document, inst: FrameNode & { instanceOf: string }) {
  const { root, nodes } = materialize(doc, inst);
  const old = descendants(doc, inst.id);
  const same =
    jsonEqual(root, inst) && old.length === nodes.length && nodes.every((n, k) => old[k] === n.id && jsonEqual(doc.nodes[n.id], n));
  if (same) return;
  for (const id of old) delete doc.nodes[id];
  doc.nodes[inst.id] = root;
  for (const n of nodes) doc.nodes[n.id] = n;
}

export function detachOps(doc: Document, ids: readonly string[]): { op: "update"; id: string; props: Record<string, unknown> }[] {
  if (!ids.length) throw new Error("pass at least one instance id");
  const ops: { op: "update"; id: string; props: Record<string, unknown> }[] = [];
  for (const id of new Set(ids)) {
    const n = doc.nodes[id];
    if (!n) throw new Error(`node "${id}" does not exist`);
    if (!isInstance(n)) throw new Error(`node "${id}" is not an instance (a frame with instanceOf)`);
    ops.push({ op: "update", id, props: { instanceOf: null, scale: null, overrides: null, propValues: null, slots: null } });
    // The resolved prop values are already on the copies, so a bind has nothing left to follow.
    for (const d of descendants(doc, id)) {
      const dn = doc.nodes[d];
      ops.push({ op: "update", id: d, props: { sourceId: null, ...(dn && nodeBind(dn) ? { bind: null } : {}) } });
    }
  }
  return ops;
}
