import type { Document, Layout, Node, PathNode, Size } from "./schema.js";

export type CSS = Record<string, string | number>;

/** Resolve `$token` contra `doc.tokens`. Tokens podem referenciar outros tokens (até 8 níveis). */
export function resolveValue<T extends string | number | undefined>(doc: Document, v: T): T | string | number {
  let cur: string | number | undefined = v;
  for (let depth = 0; depth < 8 && typeof cur === "string" && cur.startsWith("$"); depth++) {
    const next: string | number | undefined = doc.tokens[cur.slice(1)];
    if (next === undefined) return cur;
    cur = next;
  }
  return cur as T | string | number;
}

const px = (n: number) => `${round(n)}px`;
const round = (n: number) => Math.round(n * 100) / 100;

function padding(p: Layout["padding"]): string {
  return Array.isArray(p) ? p.map(px).join(" ") : px(p);
}

function sizeProps(axis: "width" | "height", size: Size, parentMode: Layout["mode"] | null): CSS {
  if (typeof size === "number") return { [axis]: px(size), flexShrink: 0 };
  if (size === "hug") return { [axis]: "max-content" };
  // fill
  if (parentMode === "row" || parentMode === "column") {
    const main = (parentMode === "row" && axis === "width") || (parentMode === "column" && axis === "height");
    return main ? { flex: "1 1 0", [axis === "width" ? "minWidth" : "minHeight"]: 0 } : { alignSelf: "stretch" };
  }
  return { [axis]: "100%" };
}

const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const;
const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;

/**
 * Estilo CSS (camelCase) de um nó. É a única fonte de verdade de renderização: o canvas React,
 * o export HTML e o screenshot usam esta função, então o que o agente vê é o que o humano vê.
 */
export function nodeStyle(doc: Document, node: Node, opts: { asRoot?: boolean } = {}): CSS {
  if (node.type === "page") return {}; // páginas não são desenhadas: os filhos usam coordenadas do canvas
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  const parentMode = parent?.type === "frame" && parent.layout && parent.layout.mode !== "none" ? parent.layout.mode : null;
  const css: CSS = { boxSizing: "border-box" };

  if (parentMode && !opts.asRoot) {
    css.position = "relative";
  } else {
    css.position = "absolute";
    css.left = px(opts.asRoot ? 0 : node.x);
    css.top = px(opts.asRoot ? 0 : node.y);
  }
  Object.assign(css, sizeProps("width", node.width, opts.asRoot ? null : parentMode));
  Object.assign(css, sizeProps("height", node.height, opts.asRoot ? null : parentMode));

  if (node.type === "group") {
    // Só agrupa: sem pintura nem recorte (os filhos podem sair da caixa).
    if (node.opacity !== 1) css.opacity = node.opacity;
    if (!node.visible) css.display = "none";
    return css;
  }
  if (node.rotation) css.transform = `rotate(${round(node.rotation)}deg)`;
  if (node.opacity !== 1) css.opacity = node.opacity;
  if (!node.visible) css.display = "none";
  if (node.type === "path") {
    // fill/stroke vão para o <path> (ver pathAttrs); a sombra segue a forma, não a caixa.
    css.overflow = "visible";
    css.display = node.visible ? "block" : "none";
    if (node.shadow) {
      const s = node.shadow;
      css.filter = `drop-shadow(${px(s.x)} ${px(s.y)} ${px(s.blur)} ${resolveValue(doc, s.color)})`;
    }
    return css;
  }
  if (node.fill) css.background = String(resolveValue(doc, node.fill));
  if (node.stroke) css.border = `${px(node.stroke.width)} solid ${resolveValue(doc, node.stroke.color)}`;
  if (node.type === "ellipse") css.borderRadius = "50%";
  else if (node.radius) css.borderRadius = px(node.radius);
  if (node.shadow) {
    const s = node.shadow;
    css.boxShadow = `${px(s.x)} ${px(s.y)} ${px(s.blur)} ${px(s.spread)} ${resolveValue(doc, s.color)}`;
  }

  switch (node.type) {
    case "frame": {
      if (node.clip) css.overflow = "hidden";
      const l = node.layout;
      if (l && l.mode !== "none") {
        css.display = node.visible ? "flex" : "none";
        css.flexDirection = l.mode;
        css.gap = px(l.gap);
        css.padding = padding(l.padding);
        css.alignItems = ALIGN[l.align];
        css.justifyContent = JUSTIFY[l.justify];
        if (l.wrap) css.flexWrap = "wrap";
      }
      break;
    }
    case "text": {
      css.color = String(resolveValue(doc, node.color));
      css.fontFamily = node.fontFamily;
      const fs = resolveValue(doc, node.fontSize);
      css.fontSize = typeof fs === "number" ? px(fs) : String(fs);
      css.fontWeight = node.fontWeight;
      css.lineHeight = node.lineHeight;
      if (node.letterSpacing) css.letterSpacing = px(node.letterSpacing);
      css.textAlign = node.textAlign;
      css.whiteSpace = "pre-wrap";
      css.overflowWrap = "anywhere";
      css.margin = 0;
      break;
    }
    case "image":
      css.objectFit = node.fit;
      css.display = node.visible ? "block" : "none";
      break;
    default:
      break;
  }
  return css;
}

/** Atributos do <svg> e do <path> de um nó path. Fonte única para canvas, HTML/screenshot e React. */
export function pathAttrs(doc: Document, node: PathNode): {
  svg: { viewBox?: string; preserveAspectRatio?: string };
  path: { d: string; fill: string; fillRule: string; stroke?: string; strokeWidth?: number; strokeLinecap: string; strokeLinejoin: string };
} {
  const svg: { viewBox?: string; preserveAspectRatio?: string } = {};
  if (node.viewBox) {
    svg.viewBox = node.viewBox.map(round).join(" ");
    svg.preserveAspectRatio = "xMidYMid meet";
  }
  const path: ReturnType<typeof pathAttrs>["path"] = {
    d: node.d,
    fill: node.fill ? String(resolveValue(doc, node.fill)) : "none",
    fillRule: node.fillRule,
    strokeLinecap: node.strokeCap,
    strokeLinejoin: node.strokeJoin,
  };
  if (node.stroke && node.stroke.width > 0) {
    path.stroke = String(resolveValue(doc, node.stroke.color));
    path.strokeWidth = node.stroke.width;
  }
  return { svg, path };
}

const UNITLESS = new Set(["opacity", "fontWeight", "lineHeight", "flexShrink", "zIndex"]);

/** Serializa um objeto CSS camelCase em uma declaração inline. */
export function cssToString(css: CSS): string {
  return Object.entries(css)
    .map(([k, v]) => {
      const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const val = typeof v === "number" && !UNITLESS.has(k) && v !== 0 ? `${v}px` : String(v);
      return `${prop}:${val}`;
    })
    .join(";");
}
