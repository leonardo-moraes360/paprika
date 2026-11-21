import type { Document, Node } from "./schema.js";
import { cssToString, nodeStyle, pathAttrs, type CSS } from "./style.js";

const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const svgAttrs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k === "viewBox" || k === "preserveAspectRatio" ? k : kebab(k)}="${escapeHtml(String(v))}"`)
    .join("");

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Caixa aproximada de um nó raiz (números; "hug"/"fill" caem no mínimo de 1px). */
export function rootBounds(doc: Document, id: string): Bounds {
  const n = doc.nodes[id];
  if (!n) throw new Error(`nó "${id}" não existe`);
  const w = typeof n.width === "number" ? n.width : 1;
  const h = typeof n.height === "number" ? n.height : 1;
  return { x: n.x, y: n.y, width: Math.max(1, w), height: Math.max(1, h) };
}

/** Caixa que contém todos os nós de nível superior. */
export function canvasBounds(doc: Document): Bounds {
  if (doc.rootIds.length === 0) return { x: 0, y: 0, width: 800, height: 600 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const id of doc.rootIds) {
    const b = rootBounds(doc, id);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function renderNode(doc: Document, node: Node, asRoot: boolean, offset?: { x: number; y: number }): string {
  const css: CSS = nodeStyle(doc, node, { asRoot });
  if (offset && !asRoot) {
    css.left = `${node.x - offset.x}px`;
    css.top = `${node.y - offset.y}px`;
  }
  const attrs = `data-paprika-id="${escapeHtml(node.id)}" data-paprika-type="${node.type}"${
    node.name ? ` data-name="${escapeHtml(node.name)}"` : ""
  } style="${escapeHtml(cssToString(css))}"`;
  switch (node.type) {
    case "frame": {
      const kids = node.children
        .map((c) => doc.nodes[c])
        .filter((c): c is Node => !!c)
        .map((c) => renderNode(doc, c, false))
        .join("");
      return `<div ${attrs}>${kids}</div>`;
    }
    case "text":
      return `<div ${attrs}>${escapeHtml(node.text)}</div>`;
    case "image":
      return `<img ${attrs} src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}">`;
    case "path": {
      const a = pathAttrs(doc, node);
      return `<svg ${attrs} xmlns="http://www.w3.org/2000/svg"${svgAttrs(a.svg)}><path${svgAttrs(a.path)}/></svg>`;
    }
    default:
      return `<div ${attrs}></div>`;
  }
}

export interface RenderOptions {
  /** Renderiza só este nó (em 0,0). Sem ele, renderiza o canvas inteiro. */
  rootId?: string;
  /** Cor de fundo da página. */
  background?: string;
}

/** Gera um documento HTML autocontido. Usado pelo export de código e pelo screenshot. */
export function renderHTML(doc: Document, opts: RenderOptions = {}): { html: string; bounds: Bounds } {
  let body: string;
  let bounds: Bounds;
  if (opts.rootId) {
    const node = doc.nodes[opts.rootId];
    if (!node) throw new Error(`nó "${opts.rootId}" não existe`);
    bounds = rootBounds(doc, opts.rootId);
    body = renderNode(doc, node, true);
  } else {
    bounds = canvasBounds(doc);
    body = doc.rootIds
      .map((id) => doc.nodes[id])
      .filter((n): n is Node => !!n)
      .map((n) => renderNode(doc, n, false, { x: bounds.x, y: bounds.y }))
      .join("");
  }
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>
<style>html,body{margin:0;padding:0}body{position:relative;width:${bounds.width}px;height:${bounds.height}px;background:${escapeHtml(
    opts.background ?? "#ffffff",
  )};font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}</style>
</head><body>${body}</body></html>`;
  return { html, bounds };
}

function jsxStyle(css: CSS): string {
  return `{{ ${Object.entries(css)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? v : JSON.stringify(v)}`)
    .join(", ")} }}`;
}

function jsxText(s: string): string {
  return s.replace(/[{}<>]/g, (c) => `{${JSON.stringify(c)}}`).replace(/\n/g, "{'\\n'}");
}

function jsxNode(doc: Document, node: Node, asRoot: boolean, indent: string): string {
  const style = jsxStyle(nodeStyle(doc, node, { asRoot }));
  const name = node.name ? ` data-name=${JSON.stringify(node.name)}` : "";
  switch (node.type) {
    case "frame": {
      const kids = node.children
        .map((c) => doc.nodes[c])
        .filter((c): c is Node => !!c)
        .map((c) => jsxNode(doc, c, false, indent + "  "))
        .join("\n");
      return kids
        ? `${indent}<div${name} style=${style}>\n${kids}\n${indent}</div>`
        : `${indent}<div${name} style=${style} />`;
    }
    case "text":
      return `${indent}<div${name} style=${style}>${jsxText(node.text)}</div>`;
    case "image":
      return `${indent}<img${name} style=${style} src=${JSON.stringify(node.src)} alt=${JSON.stringify(node.alt)} />`;
    case "path": {
      const a = pathAttrs(doc, node);
      const jsx = (o: Record<string, string | number | undefined>) =>
        Object.entries(o)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => ` ${k}=${typeof v === "number" ? `{${v}}` : JSON.stringify(v)}`)
          .join("");
      return `${indent}<svg${name} style=${style}${jsx(a.svg)}>\n${indent}  <path${jsx(a.path)} />\n${indent}</svg>`;
    }
    default:
      return `${indent}<div${name} style=${style} />`;
  }
}

function componentName(s: string): string {
  const base = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))
    .replace(/^[^A-Za-z]+/, "");
  return base ? base[0]!.toUpperCase() + base.slice(1) : "Design";
}

/** Exporta um nó como componente React (TSX) com estilos inline. */
export function exportReact(doc: Document, rootId: string): string {
  const node = doc.nodes[rootId];
  if (!node) throw new Error(`nó "${rootId}" não existe`);
  const name = componentName(node.name || node.id);
  return `export function ${name}() {\n  return (\n${jsxNode(doc, node, true, "    ")}\n  );\n}\n`;
}
