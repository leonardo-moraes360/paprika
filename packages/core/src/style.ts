import type { Document, Layout, Node, PathNode, Size } from "./schema.js";

export type CSS = Record<string, string | number>;

/** Modo de tema em vigor num nó: o dele ou o do frame/página ancestral mais próximo com `mode`. */
export function modeOf(doc: Document, node: Node | undefined): string | undefined {
  for (let n = node, depth = 0; n && depth < 1000; n = n.parentId ? doc.nodes[n.parentId] : undefined, depth++) {
    if ((n.type === "frame" || n.type === "page") && n.mode) return n.mode;
  }
  return undefined;
}

/** Valor de um token no modo (se o modo o define) ou o valor base. */
export function tokenValue(doc: Document, name: string, mode?: string): string | number | undefined {
  const m = mode && doc.modes && Object.hasOwn(doc.modes, mode) ? doc.modes[mode]! : undefined;
  if (m && Object.hasOwn(m, name)) return m[name];
  return Object.hasOwn(doc.tokens, name) ? doc.tokens[name] : undefined;
}

/**
 * Resolve `$token` contra `doc.tokens`, ou contra `doc.modes[mode]` primeiro quando há modo.
 * Tokens podem referenciar outros tokens (até 8 níveis).
 */
export function resolveValue<T extends string | number | undefined>(doc: Document, v: T, mode?: string): T | string | number {
  let cur: string | number | undefined = v;
  for (let depth = 0; depth < 8 && typeof cur === "string" && cur.startsWith("$"); depth++) {
    const next = tokenValue(doc, cur.slice(1), mode);
    if (next === undefined) return cur;
    cur = next;
  }
  return cur as T | string | number;
}

/** Nome da variável CSS de um token (`brand.dark` → `--brand\.dark`; `\` e `.` são escapados). */
export function cssVarName(token: string): string {
  return `--${token.replace(/[\\.]/g, "\\$&")}`;
}

const isKnownToken = (doc: Document, name: string) =>
  Object.hasOwn(doc.tokens, name) || Object.values(doc.modes ?? {}).some((m) => Object.hasOwn(m, name));

/**
 * Valor de pintura de um nó: resolvido no modo do nó, ou `var(--token)` quando `vars` (export com
 * variáveis CSS; a folha de estilos de `tokenStylesheet` define os valores por modo).
 */
function paintValue(doc: Document, v: string | number, mode: string | undefined, vars: boolean | undefined): string | number {
  if (vars && typeof v === "string" && v.startsWith("$") && isKnownToken(doc, v.slice(1))) return `var(${cssVarName(v.slice(1))})`;
  return resolveValue(doc, v, mode);
}

/** Escapa o que fecharia o valor ou a regra (`;`, `{`, `}`, `<`…) num valor de variável CSS. */
function cssValue(v: string): string {
  return v.replace(/[<>{};\\]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

function tokenDecls(doc: Document, tokens: Record<string, string | number>): string {
  return Object.entries(tokens)
    .map(([k, v]) => {
      const value =
        typeof v === "number" ? `${round(v)}px` : v.startsWith("$") && isKnownToken(doc, v.slice(1)) ? `var(${cssVarName(v.slice(1))})` : cssValue(v);
      return `${cssVarName(k)}:${value}`;
    })
    .join(";");
}

/**
 * Folha de estilos dos tokens como variáveis CSS: `:root` com os valores base e uma regra por
 * modo (`[data-paprika-mode="dark"]`). Números viram px (tokens numéricos são tamanhos de fonte).
 */
export function tokenStylesheet(doc: Document): string {
  let out = `:root{${tokenDecls(doc, doc.tokens)}}`;
  for (const [mode, tokens] of Object.entries(doc.modes ?? {})) out += `[data-paprika-mode="${mode}"]{${tokenDecls(doc, tokens)}}`;
  return out;
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
export function nodeStyle(doc: Document, node: Node, opts: { asRoot?: boolean; vars?: boolean } = {}): CSS {
  if (node.type === "page") return {}; // páginas não são desenhadas: os filhos usam coordenadas do canvas
  const mode = modeOf(doc, node);
  const paint = (v: string | number) => paintValue(doc, v, mode, opts.vars);
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
      css.filter = `drop-shadow(${px(s.x)} ${px(s.y)} ${px(s.blur)} ${paint(s.color)})`;
    }
    return css;
  }
  if (node.fill) css.background = String(paint(node.fill));
  if (node.stroke) css.border = `${px(node.stroke.width)} solid ${paint(node.stroke.color)}`;
  if (node.type === "ellipse") css.borderRadius = "50%";
  else if (node.radius) css.borderRadius = px(node.radius);
  if (node.shadow) {
    const s = node.shadow;
    css.boxShadow = `${px(s.x)} ${px(s.y)} ${px(s.blur)} ${px(s.spread)} ${paint(s.color)}`;
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
      css.color = String(paint(node.color));
      css.fontFamily = node.fontFamily;
      const fs = paint(node.fontSize);
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
export function pathAttrs(doc: Document, node: PathNode, opts: { vars?: boolean } = {}): {
  svg: { viewBox?: string; preserveAspectRatio?: string };
  path: { d: string; fill: string; fillRule: string; stroke?: string; strokeWidth?: number; strokeLinecap: string; strokeLinejoin: string };
} {
  const mode = modeOf(doc, node);
  const svg: { viewBox?: string; preserveAspectRatio?: string } = {};
  if (node.viewBox) {
    svg.viewBox = node.viewBox.map(round).join(" ");
    svg.preserveAspectRatio = "xMidYMid meet";
  }
  const path: ReturnType<typeof pathAttrs>["path"] = {
    d: node.d,
    fill: node.fill ? String(paintValue(doc, node.fill, mode, opts.vars)) : "none",
    fillRule: node.fillRule,
    strokeLinecap: node.strokeCap,
    strokeLinejoin: node.strokeJoin,
  };
  if (node.stroke && node.stroke.width > 0) {
    path.stroke = String(paintValue(doc, node.stroke.color, mode, opts.vars));
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
