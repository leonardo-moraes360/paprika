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
    return parts.join(" ");
  }
  parts.push(sizeStr(n), `@${n.x},${n.y}`);
  if (n.type !== "group" && n.fill) parts.push(`fill=${n.fill}`);
  if (n.type === "frame" && n.layout && n.layout.mode !== "none") {
    parts.push(`${n.layout.mode} gap=${n.layout.gap}`);
  }
  if (n.type === "text") {
    const t = n.text.length > 60 ? n.text.slice(0, 57) + "..." : n.text;
    parts.push(JSON.stringify(t), `${n.fontSize}/${n.fontWeight}`, `color=${n.color}`);
  }
  if (n.type === "path") {
    const d = n.d.length > 48 ? n.d.slice(0, 45) + "..." : n.d;
    parts.push(`d=${JSON.stringify(d)}`);
    if (n.stroke) parts.push(`stroke=${n.stroke.color}/${n.stroke.width}`);
    if (n.viewBox) parts.push(`viewBox=${n.viewBox.join(",")}`);
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
  return lines.join("\n") || "(documento vazio)";
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
    if (text && !(n.type === "text" && n.text.toLowerCase().includes(text))) continue;
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
