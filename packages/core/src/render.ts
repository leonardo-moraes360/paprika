import { firstPage, pageRoots, type Document, type Node } from "./schema.js";
import { cssToString, modeOf, nodeStyle, pathAttrs, resolveValue, tokenStylesheet, type CSS } from "./style.js";

const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
export const svgAttrs = (o: Record<string, string | number | undefined>) =>
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

/** Caixa aproximada de um nó raiz (números; "hug"/"fill" caem no mínimo de 1px). Página: a caixa do conteúdo. */
export function rootBounds(doc: Document, id: string): Bounds {
  const n = doc.nodes[id];
  if (!n) throw new Error(`nó "${id}" não existe`);
  if (n.type === "page") return canvasBounds(doc, id);
  const w = typeof n.width === "number" ? n.width : 1;
  const h = typeof n.height === "number" ? n.height : 1;
  return { x: n.x, y: n.y, width: Math.max(1, w), height: Math.max(1, h) };
}

/** Caixa que contém todos os nós de nível superior (de uma página; sem `pageId`, da primeira ou do documento sem páginas). */
export function canvasBounds(doc: Document, pageId?: string): Bounds {
  const roots = pageRoots(doc, pageId);
  if (roots.length === 0) return { x: 0, y: 0, width: 800, height: 600 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const id of roots) {
    const b = rootBounds(doc, id);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** `data-paprika-mode` num frame/página com modo de tema: o seletor das variáveis CSS daquele modo. */
function modeAttr(node: Node): string {
  return (node.type === "frame" || node.type === "page") && node.mode ? ` data-paprika-mode="${escapeHtml(node.mode)}"` : "";
}

function renderNode(doc: Document, node: Node, asRoot: boolean, vars: boolean, offset?: { x: number; y: number }): string {
  const css: CSS = nodeStyle(doc, node, { asRoot, vars });
  if (offset && !asRoot && node.type !== "page") {
    css.left = `${node.x - offset.x}px`;
    css.top = `${node.y - offset.y}px`;
  }
  const attrs = `data-paprika-id="${escapeHtml(node.id)}" data-paprika-type="${node.type}"${
    node.name ? ` data-name="${escapeHtml(node.name)}"` : ""
  }${modeAttr(node)} style="${escapeHtml(cssToString(css))}"`;
  switch (node.type) {
    case "frame":
    case "group":
    case "page": {
      const kids = node.children
        .map((c) => doc.nodes[c])
        .filter((c): c is Node => !!c)
        .map((c) => renderNode(doc, c, false, vars))
        .join("");
      return `<div ${attrs}>${kids}</div>`;
    }
    case "text":
      return `<div ${attrs}>${escapeHtml(node.text)}</div>`;
    case "image":
      return `<img ${attrs} src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}">`;
    case "path": {
      const a = pathAttrs(doc, node, { vars });
      return `<svg ${attrs} xmlns="http://www.w3.org/2000/svg"${svgAttrs(a.svg)}><path${svgAttrs(a.path)}/></svg>`;
    }
    default:
      return `<div ${attrs}></div>`;
  }
}

export interface RenderOptions {
  /** Renderiza só este nó (em 0,0); uma página renderiza o canvas dela. Sem ele, o canvas (da primeira página, se houver). */
  rootId?: string;
  /** Cor de fundo da página HTML (padrão: o fill da página do Paprika, ou branco). */
  background?: string;
  /** Tokens como variáveis CSS (`var(--nome)`), com uma folha de estilos por modo de tema. */
  cssVariables?: boolean;
}

function renderCanvas(doc: Document, pageId: string | undefined, vars: boolean): { body: string; bounds: Bounds } {
  const bounds = canvasBounds(doc, pageId);
  const body = pageRoots(doc, pageId)
    .map((id) => doc.nodes[id])
    .filter((n): n is Node => !!n)
    .map((n) => renderNode(doc, n, false, vars, { x: bounds.x, y: bounds.y }))
    .join("");
  return { body, bounds };
}

/** Gera um documento HTML autocontido. Usado pelo export de código e pelo screenshot. */
export function renderHTML(doc: Document, opts: RenderOptions = {}): { html: string; bounds: Bounds } {
  const vars = !!opts.cssVariables;
  let body: string;
  let bounds: Bounds;
  const node = opts.rootId ? doc.nodes[opts.rootId] : undefined;
  if (opts.rootId && !node) throw new Error(`nó "${opts.rootId}" não existe`);
  const page = node ? (node.type === "page" ? node : undefined) : firstPage(doc);
  if (node && node.type !== "page") {
    bounds = rootBounds(doc, node.id);
    body = renderNode(doc, node, true, vars);
  } else ({ body, bounds } = renderCanvas(doc, page?.id, vars));
  const background = opts.background ?? (page?.fill ? String(resolveValue(doc, page.fill, page.mode)) : "#ffffff");
  // Um nó solto herda o modo dos ancestrais: no export ele vai no <body>, que é o novo topo.
  const inherited = node && node.type !== "page" && !modeAttr(node) ? modeOf(doc, node) : page?.mode;
  const bodyMode = vars && inherited ? ` data-paprika-mode="${escapeHtml(inherited)}"` : "";
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>
<style>html,body{margin:0;padding:0}body{position:relative;width:${bounds.width}px;height:${bounds.height}px;background:${escapeHtml(background)};font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}${vars ? tokenStylesheet(doc) : ""}</style>
</head><body${bodyMode}>${body}</body></html>`;
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

function jsxNode(doc: Document, node: Node, asRoot: boolean, indent: string, vars: boolean): string {
  const style = jsxStyle(nodeStyle(doc, node, { asRoot, vars }));
  const mode = (node.type === "frame" || node.type === "page") && node.mode ? node.mode : asRoot && vars ? modeOf(doc, node) : undefined;
  const name = `${node.name ? ` data-name=${JSON.stringify(node.name)}` : ""}${mode ? ` data-paprika-mode=${JSON.stringify(mode)}` : ""}`;
  switch (node.type) {
    case "frame":
    case "group":
    case "page": {
      const kids = node.children
        .map((c) => doc.nodes[c])
        .filter((c): c is Node => !!c)
        .map((c) => jsxNode(doc, c, false, indent + "  ", vars))
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
      const a = pathAttrs(doc, node, { vars });
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

/**
 * Exporta um nó como componente React (TSX) com estilos inline. Com `cssVariables`, as cores e
 * tamanhos de token saem como `var(--nome)` e o módulo exporta `tokensCss` (a folha com os
 * valores de cada modo) para incluir uma vez na aplicação.
 */
export function exportReact(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): string {
  const node = doc.nodes[rootId];
  if (!node) throw new Error(`nó "${rootId}" não existe`);
  if (node.type === "page") throw new Error(`"${rootId}" é uma página; exporte um frame dela (export_code com o id do frame)`);
  const name = componentName(node.name || node.id);
  const vars = !!opts.cssVariables;
  const css = vars ? `export const tokensCss = ${JSON.stringify(tokenStylesheet(doc))};\n\n` : "";
  return `${css}export function ${name}() {\n  return (\n${jsxNode(doc, node, true, "    ", vars)}\n  );\n}\n`;
}
