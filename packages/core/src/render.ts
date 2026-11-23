import { firstPage, frameFluid, isRootFrame, pageRoots, resolveAsset, type Document, type Node } from "./schema.js";
import {
  SHAPE_SVG_CSS,
  SHAPE_TEXT_CSS,
  connectorAttrs,
  connectorLabelAttrs,
  cssToString,
  gradientCSS,
  modeOf,
  nodeGradient,
  nodeStyle,
  pathAttrs,
  resolveValue,
  shapeAttrs,
  tokenStylesheet,
  type CSS,
} from "./style.js";

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
  if (!n) throw new Error(`node "${id}" does not exist`);
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

export type StyleEmitter = (css: CSS, owner: Node | string) => string;

export const htmlStyleAttr: StyleEmitter = (css) => ` style="${escapeHtml(cssToString(css))}"`;

export const jsxStyleAttr: StyleEmitter = (css) => ` style=${jsxStyle(css)}`;

function useFluid(doc: Document, node: Node, asRoot: boolean): boolean {
  return !!frameFluid(node) && (asRoot || isRootFrame(doc, node));
}

function applyFluid(css: CSS, node: Node) {
  const f = frameFluid(node);
  if (!f) return;
  css.width = "100%";
  css.minWidth = `${f.min}px`;
  css.maxWidth = `${f.max}px`;
  delete css.flexShrink;
}

function fluidData(node: Node): string {
  const f = frameFluid(node);
  if (!f || node.type !== "frame" || typeof node.width !== "number") return "";
  return ` data-paprika-width="${node.width}" data-paprika-min-width="${f.min}" data-paprika-max-width="${f.max}"`;
}

function aggregateFluid(nodes: Node[]): { min: number; max: number } | null {
  const fluids = nodes.map(frameFluid).filter((f): f is { min: number; max: number } => !!f);
  if (!fluids.length) return null;
  return { min: Math.min(...fluids.map((f) => f.min)), max: Math.max(...fluids.map((f) => f.max)) };
}

export function bodySizeCSS(bounds: Bounds, fluid: { min: number; max: number } | null): string {
  if (!fluid) return `width:${bounds.width}px;height:${bounds.height}px`;
  return `width:100%;min-width:${fluid.min}px;max-width:${fluid.max}px;margin-left:auto;margin-right:auto;height:${bounds.height}px`;
}

function renderNode(doc: Document, node: Node, asRoot: boolean, vars: boolean, emit: StyleEmitter, offset?: { x: number; y: number }): string {
  const css: CSS = nodeStyle(doc, node, { asRoot, vars });
  if (offset && !asRoot && node.type !== "page") {
    css.left = `${node.x - offset.x}px`;
    css.top = `${node.y - offset.y}px`;
  }
  const fluid = useFluid(doc, node, asRoot);
  if (fluid) applyFluid(css, node);
  const attrs = `data-paprika-id="${escapeHtml(node.id)}" data-paprika-type="${node.type}"${
    node.name ? ` data-name="${escapeHtml(node.name)}"` : ""
  }${fluid ? fluidData(node) : ""}${modeAttr(node)}${emit(css, node)}`;
  switch (node.type) {
    case "frame":
    case "group":
    case "page": {
      const kids = node.children
        .map((c) => doc.nodes[c])
        .filter((c): c is Node => !!c)
        .map((c) => renderNode(doc, c, false, vars, emit))
        .join("");
      const href = node.type === "frame" && node.href ? ` href="${escapeHtml(node.href)}"` : "";
      const tag = href ? "a" : "div";
      return `<${tag} ${attrs}${href}>${kids}</${tag}>`;
    }
    case "text": {
      const tag = node.href ? "a" : "div";
      const href = node.href ? ` href="${escapeHtml(node.href)}"` : "";
      return `<${tag} ${attrs}${href}>${escapeHtml(node.text)}</${tag}>`;
    }
    case "image": {
      const alt = node.decorative ? "" : node.alt;
      const hidden = node.decorative ? ` alt="" aria-hidden="true" data-paprika-decorative="true"` : ` alt="${escapeHtml(alt)}"`;
      return `<img ${attrs} src="${escapeHtml(resolveAsset(doc, node.src))}"${hidden}>`;
    }
    case "path": {
      const a = pathAttrs(doc, node, { vars });
      return `<svg ${attrs} xmlns="http://www.w3.org/2000/svg"${svgAttrs(a.svg)}>${a.svgInner}<path${svgAttrs(a.path)}/></svg>`;
    }
    case "connector": {
      const label = connectorLabelAttrs(doc, node, { vars });
      const text = label ? `<text${svgAttrs(label)}>${escapeHtml(node.label!)}</text>` : "";
      return `<svg ${attrs} xmlns="http://www.w3.org/2000/svg"><path${svgAttrs(connectorAttrs(doc, node, { vars }))}/>${text}</svg>`;
    }
    case "shape": {
      const a = shapeAttrs(doc, node, { vars });
      const fold = a.fold ? `<path${svgAttrs(a.fold)}/>` : "";
      return `<div ${attrs}><svg xmlns="http://www.w3.org/2000/svg"${svgAttrs(a.svg)}${emit(SHAPE_SVG_CSS, "shapeSvg")}>${a.svgInner}<path${svgAttrs(a.path)}/>${fold}</svg><div${emit(SHAPE_TEXT_CSS, "shapeText")}>${escapeHtml(node.text)}</div></div>`;
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

function renderCanvas(doc: Document, pageId: string | undefined, vars: boolean, emit: StyleEmitter): { body: string; bounds: Bounds } {
  const bounds = canvasBounds(doc, pageId);
  const body = pageRoots(doc, pageId)
    .map((id) => doc.nodes[id])
    .filter((n): n is Node => !!n)
    .map((n) => renderNode(doc, n, false, vars, emit, { x: bounds.x, y: bounds.y }))
    .join("");
  return { body, bounds };
}

export interface ExportParts {
  body: string;
  bounds: Bounds;
  background: string;
  bodyMode: string;
  vars: boolean;
  fluid: { min: number; max: number } | null;
}

export function exportParts(doc: Document, opts: RenderOptions, emit: StyleEmitter): ExportParts {
  const vars = !!opts.cssVariables;
  let body: string;
  let bounds: Bounds;
  const node = opts.rootId ? doc.nodes[opts.rootId] : undefined;
  if (opts.rootId && !node) throw new Error(`node "${opts.rootId}" does not exist`);
  const page = node ? (node.type === "page" ? node : undefined) : firstPage(doc);
  let fluidNodes: Node[];
  if (node && node.type !== "page") {
    bounds = rootBounds(doc, node.id);
    body = renderNode(doc, node, true, vars, emit);
    fluidNodes = [node];
  } else {
    ({ body, bounds } = renderCanvas(doc, page?.id, vars, emit));
    fluidNodes = pageRoots(doc, page?.id)
      .map((id) => doc.nodes[id])
      .filter((n): n is Node => !!n);
  }
  const fluid = aggregateFluid(fluidNodes);
  const pageGradient = page ? nodeGradient(page) : undefined;
  const background = opts.background ?? (pageGradient ? gradientCSS(doc, pageGradient, page?.mode, vars) : page?.fill ? String(resolveValue(doc, page.fill, page.mode)) : "#ffffff");
  // Um nó solto herda o modo dos ancestrais: no export ele vai no <body>, que é o novo topo.
  const inherited = node && node.type !== "page" && !modeAttr(node) ? modeOf(doc, node) : page?.mode;
  const bodyMode = vars && inherited ? ` data-paprika-mode="${escapeHtml(inherited)}"` : "";
  return { body, bounds, background, bodyMode, vars, fluid };
}

/** Gera um documento HTML autocontido. Usado pelo export de código e pelo screenshot. */
export function renderHTML(doc: Document, opts: RenderOptions = {}): { html: string; bounds: Bounds } {
  const p = exportParts(doc, opts, htmlStyleAttr);
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>
<style>html,body{margin:0;padding:0}body{position:relative;${bodySizeCSS(p.bounds, p.fluid)};background:${escapeHtml(p.background)};font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}${p.vars ? tokenStylesheet(doc) : ""}</style>
</head><body${p.bodyMode}>${p.body}</body></html>`;
  return { html, bounds: p.bounds };
}

function jsxStyle(css: CSS): string {
  return `{{ ${Object.entries(css)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? v : JSON.stringify(v)}`)
    .join(", ")} }}`;
}

export function jsxAttrs(o: Record<string, string | number | undefined>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}=${typeof v === "number" ? `{${v}}` : JSON.stringify(v)}`)
    .join("");
}

export function jsxText(s: string): string {
  return s.replace(/[{}<>]/g, (c) => `{${JSON.stringify(c)}}`).replace(/\n/g, "{'\\n'}");
}

function fluidJsx(node: Node): string {
  const f = frameFluid(node);
  if (!f || node.type !== "frame" || typeof node.width !== "number") return "";
  return ` data-paprika-width={${node.width}} data-paprika-min-width={${f.min}} data-paprika-max-width={${f.max}}`;
}

export function jsxNode(doc: Document, node: Node, asRoot: boolean, indent: string, vars: boolean, emit: StyleEmitter): string {
  const css = nodeStyle(doc, node, { asRoot, vars });
  const fluid = useFluid(doc, node, asRoot);
  if (fluid) applyFluid(css, node);
  const style = emit(css, node);
  const mode = (node.type === "frame" || node.type === "page") && node.mode ? node.mode : asRoot && vars ? modeOf(doc, node) : undefined;
  const name = `${node.name ? ` data-name=${JSON.stringify(node.name)}` : ""}${fluid ? fluidJsx(node) : ""}${mode ? ` data-paprika-mode=${JSON.stringify(mode)}` : ""}`;
  switch (node.type) {
    case "frame":
    case "group":
    case "page": {
      const kids = node.children
        .map((c) => doc.nodes[c])
        .filter((c): c is Node => !!c)
        .map((c) => jsxNode(doc, c, false, indent + "  ", vars, emit))
        .join("\n");
      const href = node.type === "frame" && node.href ? ` href=${JSON.stringify(node.href)}` : "";
      const tag = href ? "a" : "div";
      return kids
        ? `${indent}<${tag}${name}${href}${style}>\n${kids}\n${indent}</${tag}>`
        : `${indent}<${tag}${name}${href}${style} />`;
    }
    case "text": {
      const tag = node.href ? "a" : "div";
      const href = node.href ? ` href=${JSON.stringify(node.href)}` : "";
      return `${indent}<${tag}${name}${href}${style}>${jsxText(node.text)}</${tag}>`;
    }
    case "image": {
      const alt = node.decorative ? "" : node.alt;
      const hidden = node.decorative ? ` alt="" aria-hidden data-paprika-decorative="true"` : ` alt=${JSON.stringify(alt)}`;
      return `${indent}<img${name}${style} src=${JSON.stringify(resolveAsset(doc, node.src))}${hidden} />`;
    }
    case "path": {
      const a = pathAttrs(doc, node, { vars });
      const jsx = (o: Record<string, string | number | undefined>) =>
        Object.entries(o)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => ` ${k}=${typeof v === "number" ? `{${v}}` : JSON.stringify(v)}`)
          .join("");
      return `${indent}<svg${name}${style}${jsx(a.svg)}>\n${indent}  ${a.svgInner}<path${jsx(a.path)} />\n${indent}</svg>`;
    }
    case "connector": {
      const label = connectorLabelAttrs(doc, node, { vars });
      const text = label ? `\n${indent}  <text${jsxAttrs(label)}>{${JSON.stringify(node.label)}}</text>` : "";
      return `${indent}<svg${name}${style}>\n${indent}  <path${jsxAttrs(connectorAttrs(doc, node, { vars }))} />${text}\n${indent}</svg>`;
    }
    case "shape": {
      const a = shapeAttrs(doc, node, { vars });
      const fold = a.fold ? `\n${indent}    <path${jsxAttrs(a.fold)} />` : "";
      return `${indent}<div${name}${style}>\n${indent}  <svg${jsxAttrs(a.svg)}${emit(SHAPE_SVG_CSS, "shapeSvg")}>\n${indent}    ${a.svgInner}<path${jsxAttrs(a.path)} />${fold}\n${indent}  </svg>\n${indent}  <div${emit(SHAPE_TEXT_CSS, "shapeText")}>${jsxText(node.text)}</div>\n${indent}</div>`;
    }
    default:
      return `${indent}<div${name}${style} />`;
  }
}

export function pascalName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))
    .replace(/^[^A-Za-z]+/, "");
}

export function componentName(s: string): string {
  const base = pascalName(s);
  return base ? base[0]!.toUpperCase() + base.slice(1) : "Design";
}

/**
 * Exporta um nó como componente React (TSX) com estilos inline. Com `cssVariables`, as cores e
 * tamanhos de token saem como `var(--nome)` e o módulo exporta `tokensCss` (a folha com os
 * valores de cada modo) para incluir uma vez na aplicação.
 */
export function exportReact(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): string {
  const node = doc.nodes[rootId];
  if (!node) throw new Error(`node "${rootId}" does not exist`);
  if (node.type === "page") throw new Error(`"${rootId}" is a page; export one of its frames (export_code with the frame id)`);
  const name = componentName(node.name || node.id);
  const vars = !!opts.cssVariables;
  const css = vars ? `export const tokensCss = ${JSON.stringify(tokenStylesheet(doc))};\n\n` : "";
  return `${css}export function ${name}() {\n  return (\n${jsxNode(doc, node, true, "    ", vars, jsxStyleAttr)}\n  );\n}\n`;
}
