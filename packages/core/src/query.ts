import { placementFooter } from "./placement.js";
import { isContainer, type Document, type Node, type NodeType, type SceneNode } from "./schema.js";

function sizeStr(n: SceneNode): string {
  return `${n.width}×${n.height}`;
}

/** Uma linha compacta por nó: barato em tokens e suficiente para o agente se orientar. */
export function describeNode(n: Node): string {
  const parts = [`${n.type}#${n.id}`];
  if (n.name) parts.push(JSON.stringify(n.name));
  if (n.type === "page") {
    if (n.fill) parts.push(`fill=${n.fill}`);
    if (n.mode) parts.push(`mode=${n.mode}`);
    return parts.join(" ");
  }
  parts.push(sizeStr(n), `@${n.x},${n.y}`);
  if (n.type !== "group" && n.type !== "connector" && n.gradient) parts.push(`gradient=${n.gradient.type}`);
  if (n.type !== "group" && n.type !== "connector" && n.fill) parts.push(`fill=${n.fill}`);
  if (n.type === "frame" && n.layout && n.layout.mode !== "none") {
    parts.push(`${n.layout.mode} gap=${n.layout.gap}`);
  }
  if (n.type === "frame" && n.mode) parts.push(`mode=${n.mode}`);
  if (n.type === "frame" && n.component) parts.push("component");
  if (n.type === "frame" && n.componentProps?.length) parts.push(`props=${n.componentProps.length}`);
  if ("slot" in n && n.slot) parts.push(`slot=${n.slot}`);
  if (n.type === "frame" && n.instanceOf !== undefined) {
    parts.push(`instanceOf=${n.instanceOf}`);
    if (n.scale !== undefined && n.scale !== 1) parts.push(`scale=${n.scale}`);
    if (n.overrides) parts.push(`overrides=${Object.keys(n.overrides).length}`);
    if (n.propValues) parts.push(`propValues=${Object.keys(n.propValues).length}`);
    if (n.slots) parts.push(`slots=${Object.keys(n.slots).length}`);
  }
  if (n.sourceId !== undefined) parts.push(`from=${n.sourceId}`);
  if (n.type === "text") {
    const t = n.text.length > 60 ? n.text.slice(0, 57) + "..." : n.text;
    parts.push(JSON.stringify(t), `${n.fontSize}/${n.fontWeight}`, `color=${n.color}`);
    if (n.runs?.length) parts.push(`runs=${n.runs.length}`);
  }
  if (n.type === "path") {
    const d = n.d.length > 48 ? n.d.slice(0, 45) + "..." : n.d;
    parts.push(`d=${JSON.stringify(d)}`);
    if (n.stroke) parts.push(`stroke=${n.stroke.color}/${n.stroke.width}`);
    if (n.viewBox) parts.push(`viewBox=${n.viewBox.join(",")}`);
  }
  if (n.type === "shape") {
    const t = n.text.length > 60 ? n.text.slice(0, 57) + "..." : n.text;
    parts.push(n.shape, JSON.stringify(t));
  }
  if (n.type === "connector") {
    const end = (e: typeof n.from) =>
      e.nodeId !== undefined ? `${e.nodeId}${e.side && e.side !== "auto" ? `.${e.side}` : ""}` : `(${e.x ?? "?"},${e.y ?? "?"})`;
    parts.push(`${end(n.from)}->${end(n.to)}`, n.route);
    if (n.startArrow !== "none" || n.endArrow !== "arrow") parts.push(`arrows=${n.startArrow}/${n.endArrow}`);
    if (n.dashed) parts.push("dashed");
    if (n.label) parts.push(`label=${JSON.stringify(n.label)}`);
  }
  if (n.type === "image") parts.push(`src=${n.src.startsWith("data:") ? "data:…" : n.src}`);
  if (!n.visible) parts.push("hidden");
  if (n.locked) parts.push("locked");
  return parts.join(" ");
}

/** Árvore indentada do documento (ou de um nó), limitada por profundidade. */
export function outline(doc: Document, opts: { rootId?: string; depth?: number } = {}): string {
  const maxDepth = opts.depth ?? Infinity;
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const n = doc.nodes[id];
    if (!n) return;
    lines.push(`${"  ".repeat(depth)}${describeNode(n)}`);
    if (isContainer(n)) {
      if (depth + 1 > maxDepth) {
        if (n.children.length) lines.push(`${"  ".repeat(depth + 1)}… ${n.children.length} filho(s)`);
        return;
      }
      n.children.forEach((c) => walk(c, depth + 1));
    }
  };
  const roots = opts.rootId ? [opts.rootId] : doc.rootIds;
  roots.forEach((r) => walk(r, 0));
  const body = lines.join("\n") || "(empty document)";
  return `${body}\n${placementFooter(doc, opts.rootId)}`;
}

export interface NodeQuery {
  type?: NodeType;
  /** Substring (case-insensitive) do nome. */
  name?: string;
  /** Substring (case-insensitive) do conteúdo de texto. */
  text?: string;
  /** Restringe à subárvore deste nó. */
  within?: string;
  limit?: number;
}

export function queryNodes(doc: Document, q: NodeQuery): Node[] {
  const name = q.name?.toLowerCase();
  const text = q.text?.toLowerCase();
  const pool = q.within ? subtreeIds(doc, q.within) : Object.keys(doc.nodes);
  const out: Node[] = [];
  for (const id of pool) {
    const n = doc.nodes[id];
    if (!n) continue;
    if (q.type && n.type !== q.type) continue;
    if (name && !n.name.toLowerCase().includes(name)) continue;
    if (text && !((n.type === "text" || n.type === "shape") && n.text.toLowerCase().includes(text))) continue;
    out.push(n);
    if (q.limit && out.length >= q.limit) break;
  }
  return out;
}

export function subtreeIds(doc: Document, rootId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    out.push(id);
    if (isContainer(n)) n.children.forEach(walk);
  };
  walk(rootId);
  return out;
}

/** Caminho de nomes do topo até o nó, útil em mensagens. */
export function nodePath(doc: Document, id: string): string {
  const names: string[] = [];
  let cur: Node | undefined = doc.nodes[id];
  while (cur) {
    names.unshift(cur.name || cur.id);
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return names.join(" / ");
}
