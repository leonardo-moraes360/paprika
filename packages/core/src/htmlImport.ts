import { elements, findElement, parseMarkup, parseStyle, type MarkupElement } from "./markup.js";
import { round4 } from "./num.js";
import type { NodeInput } from "./ops.js";
import { importSVG, type ImportResult } from "./svgImport.js";

/**
 * Importa HTML com estilos inline como nós (o inverso de `nodeStyle`). O HTML exportado pelo
 * próprio Paprika (`renderHTML`, que marca cada elemento com `data-paprika-type`) volta com os
 * mesmos tipos e propriedades. HTML de outras fontes é aproximado: `display: flex` vira layout
 * row/column, blocos em fluxo viram layout column, elementos só com texto viram `text`, `<img>`
 * vira `image` e `<svg>` passa por `importSVG`. Folhas de estilo (`<style>`, classes) não são
 * aplicadas: só `style=""`.
 */

type Mode = "row" | "column" | null;

interface TextStyle {
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: string;
  pre?: boolean;
}

interface Ctx {
  mode: Mode;
  text: TextStyle;
  warn(w: string): void;
}

const PAPRIKA_TYPES = new Set(["frame", "rect", "ellipse", "text", "image", "path", "group"]);
const SKIP = new Set(["head", "script", "style", "template", "noscript", "meta", "link", "title", "iframe", "object", "embed", "video", "audio", "canvas", "input", "select", "textarea"]);
const INLINE = new Set(["span", "b", "strong", "i", "em", "a", "u", "small", "code", "label", "br", "sup", "sub", "mark", "abbr", "s", "font"]);
const HEADING: Record<string, number> = { h1: 32, h2: 24, h3: 18.72, h4: 16, h5: 13.28, h6: 10.72 };

const PX = /^(-?(?:\d+\.?\d*|\.\d+))(px)?$/;

/** "12px" ou "0" → 12/0; outros formatos → undefined. */
function px(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = PX.exec(v.trim());
  if (!m) return undefined;
  if (!m[2] && Number(m[1]) !== 0) return undefined;
  return Number(m[1]);
}

function pxList(v: string | undefined): number[] | undefined {
  if (!v) return undefined;
  const parts = v.trim().split(/\s+/).map(px);
  if (parts.some((p) => p === undefined) || parts.length > 4) return undefined;
  const p = parts as number[];
  return p.length === 1 ? p : p.length === 2 ? [p[0]!, p[1]!, p[0]!, p[1]!] : p.length === 3 ? [p[0]!, p[1]!, p[2]!, p[1]!] : p;
}

const ALIGN: Record<string, string> = { "flex-start": "start", start: "start", center: "center", "flex-end": "end", end: "end", stretch: "stretch", normal: "stretch" };
const JUSTIFY: Record<string, string> = { "flex-start": "start", start: "start", center: "center", "flex-end": "end", end: "end", "space-between": "between", normal: "start" };

function color(v: string | undefined, ctx: Ctx): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/url\(/i.test(s)) {
    ctx.warn("imagens de fundo (url()) não são importadas");
    return undefined;
  }
  if (/[;{}<>]/.test(s) || s.length > 200) return undefined;
  return s;
}

function isTextual(el: MarkupElement): boolean {
  for (const c of el.children) {
    if (typeof c === "string") continue;
    if (!INLINE.has(c.tag) || !isTextual(c)) return false;
  }
  return true;
}

/** Texto como o navegador mostraria (espaços colapsados, `<br>` vira quebra), ou cru se `pre`. */
function visibleText(el: MarkupElement, pre: boolean): string {
  let out = "";
  const walk = (e: MarkupElement) => {
    for (const c of e.children) {
      if (typeof c === "string") out += pre ? c : c.replace(/[ \t\r\n\f]+/g, " ");
      else if (c.tag === "br") out += "\n";
      else walk(c);
    }
  };
  walk(el);
  if (pre) return out;
  return out
    .split("\n")
    .map((l) => l.replace(/^ +| +$/g, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

function textStyleOf(css: Record<string, string>, tag: string, parent: TextStyle, ctx: Ctx): TextStyle {
  const t: TextStyle = { ...parent };
  const c = color(css.color, ctx);
  if (c) t.color = c;
  if (css["font-family"]) {
    const f = css["font-family"].replace(/[;{}<>()]/g, "").slice(0, 200);
    if (f) t.fontFamily = f;
  }
  const fs = px(css["font-size"]);
  if (fs !== undefined && fs >= 1) t.fontSize = Math.min(1000, fs);
  else if (css["font-size"]) ctx.warn(`font-size "${css["font-size"]}" não é px; ignorado`);
  else if (HEADING[tag]) t.fontSize = HEADING[tag];
  const fw = css["font-weight"];
  if (fw) {
    const n = fw === "bold" || fw === "bolder" ? 700 : fw === "normal" || fw === "lighter" ? 400 : Number(fw);
    if (Number.isInteger(n) && n >= 100 && n <= 900) t.fontWeight = n;
  } else if (HEADING[tag] || tag === "b" || tag === "strong") t.fontWeight = 700;
  const lh = css["line-height"];
  if (lh) {
    const p = px(lh);
    if (lh.trim().endsWith("px") && p !== undefined) t.lineHeight = round4(p / (t.fontSize ?? 16));
    else if (lh === "normal") t.lineHeight = 1.2;
    else if (Number.isFinite(Number(lh))) t.lineHeight = Number(lh);
  }
  const ls = px(css["letter-spacing"]);
  if (ls !== undefined) t.letterSpacing = ls;
  const ta = css["text-align"];
  if (ta === "left" || ta === "start") t.textAlign = "left";
  else if (ta === "center") t.textAlign = "center";
  else if (ta === "right" || ta === "end") t.textAlign = "right";
  const ws = css["white-space"];
  if (ws) t.pre = ws === "pre" || ws === "pre-wrap" || ws === "pre-line" || ws === "break-spaces";
  return t;
}

function applyText(node: NodeInput, t: TextStyle) {
  if (t.color) node.color = t.color;
  if (t.fontFamily) node.fontFamily = t.fontFamily;
  if (t.fontSize !== undefined) node.fontSize = t.fontSize;
  if (t.fontWeight !== undefined) node.fontWeight = t.fontWeight;
  if (t.lineHeight !== undefined) node.lineHeight = Math.min(10, Math.max(0, t.lineHeight));
  if (t.letterSpacing) node.letterSpacing = t.letterSpacing;
  if (t.textAlign) node.textAlign = t.textAlign;
}

/** Posição, tamanho e pintura comuns (o inverso de nodeStyle). */
function boxProps(node: NodeInput, css: Record<string, string>, ctx: Ctx, foreign: boolean) {
  const absolute = css.position === "absolute" || css.position === "fixed" || !ctx.mode;
  if (css.position === "fixed" || css.position === "sticky") ctx.warn(`position: ${css.position} tratado como absolute`);
  if (absolute) {
    const x = px(css.left);
    const y = px(css.top);
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;
  }
  const size = (axis: "width" | "height") => {
    const v = css[axis];
    const n = px(v);
    if (n !== undefined) return Math.max(0, n);
    if (v === "max-content" || v === "fit-content" || v === "min-content") return "hug";
    if (v === "100%") return "fill";
    if (v && v !== "auto") ctx.warn(`${axis} "${v}" não é suportado; usando hug`);
    const main = (ctx.mode === "row" && axis === "width") || (ctx.mode === "column" && axis === "height");
    if (ctx.mode && main && /^1(\s+1\s+0(px|%)?)?$/.test(css.flex ?? "")) return "fill";
    if (ctx.mode && !main && css["align-self"] === "stretch") return "fill";
    if (v) return "hug";
    // Sem tamanho: em HTML de fora, um bloco numa coluna ocupa a largura toda.
    if (foreign && ctx.mode === "column" && axis === "width") return "fill";
    return "hug";
  };
  if (node.type !== "group") {
    node.width = size("width");
    node.height = size("height");
  }
  const rot = /rotate\((-?[\d.]+)deg\)/.exec(css.transform ?? "");
  if (rot && node.type !== "group") node.rotation = Number(rot[1]);
  const op = css.opacity !== undefined ? Number(css.opacity) : 1;
  if (Number.isFinite(op) && op !== 1) node.opacity = Math.min(1, Math.max(0, op));
  if (css.display === "none") node.visible = false;
  if (node.type === "group") return;
  const fill = color(css["background-color"] ?? css.background, ctx);
  if (fill && (!foreign || (fill !== "transparent" && fill !== "none"))) node.fill = fill;
  const border = /^(\d+(?:\.\d+)?)px\s+(?:solid|dashed|dotted|double)\s+(.+)$/.exec((css.border ?? "").trim());
  if (border) {
    const c = color(border[2], ctx);
    if (c) node.stroke = { color: c, width: Number(border[1]) };
  }
  const radius = px(css["border-radius"]);
  if (radius !== undefined && radius > 0 && node.type !== "ellipse") node.radius = radius;
  const shadow = /^(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(.+)$/.exec((css["box-shadow"] ?? "").trim());
  if (shadow) {
    const c = color(shadow[5], ctx);
    if (c) node.shadow = { x: Number(shadow[1]), y: Number(shadow[2]), blur: Number(shadow[3]), spread: Number(shadow[4] ?? 0), color: c };
  }
}

function layoutOf(css: Record<string, string>, foreignFlow: boolean): Record<string, unknown> | undefined {
  const flex = css.display === "flex" || css.display === "inline-flex";
  if (!flex && !foreignFlow) return undefined;
  const dir = css["flex-direction"];
  const layout: Record<string, unknown> = { mode: flex ? (dir === "column" || dir === "column-reverse" ? "column" : "row") : "column" };
  const gap = px(css.gap);
  if (gap) layout.gap = gap;
  const pad = pxList(css.padding);
  if (pad) layout.padding = pad.length === 1 || pad.every((v) => v === pad[0]) ? pad[0] : pad;
  if (flex) {
    layout.align = ALIGN[css["align-items"] ?? "normal"] ?? "stretch";
    layout.justify = JUSTIFY[css["justify-content"] ?? "normal"] ?? "start";
    if (css["flex-wrap"] === "wrap") layout.wrap = true;
  } else layout.align = "stretch";
  return layout;
}

function pathNode(el: MarkupElement, css: Record<string, string>, ctx: Ctx): NodeInput | undefined {
  const p = findElement(el, "path");
  if (!p?.attrs.d) return undefined;
  const node: NodeInput = { type: "path", d: p.attrs.d };
  boxProps(node, css, ctx, false);
  delete node.fill;
  delete node.stroke;
  delete node.shadow;
  const vb = (el.attrs.viewbox ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) node.viewBox = vb;
  const fill = p.attrs.fill;
  if (fill && fill !== "none") node.fill = fill;
  if (p.attrs["fill-rule"] === "evenodd") node.fillRule = "evenodd";
  if (p.attrs.stroke && p.attrs.stroke !== "none") node.stroke = { color: p.attrs.stroke, width: Number(p.attrs["stroke-width"] ?? 1) };
  const cap = p.attrs["stroke-linecap"];
  if (cap && cap !== "round") node.strokeCap = cap;
  const join = p.attrs["stroke-linejoin"];
  if (join && join !== "round") node.strokeJoin = join;
  const ds = /drop-shadow\((-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(.+)\)$/.exec((css.filter ?? "").trim());
  if (ds) node.shadow = { x: Number(ds[1]), y: Number(ds[2]), blur: Number(ds[3]), spread: 0, color: ds[4] };
  return node;
}

function convertChildren(el: MarkupElement, ctx: Ctx): NodeInput[] {
  const out: NodeInput[] = [];
  const mixed = el.children.some((c) => typeof c === "string" && c.trim());
  for (const c of el.children) {
    if (typeof c === "string") {
      const text = ctx.text.pre ? c : c.replace(/[ \t\r\n\f]+/g, " ").trim();
      if (!mixed || !text) continue;
      const node: NodeInput = { type: "text", text, width: ctx.mode === "column" ? "fill" : "hug", height: "hug" };
      applyText(node, ctx.text);
      out.push(node);
      continue;
    }
    const n = convertElement(c, ctx);
    if (n) out.push(...n);
  }
  return out;
}

function convertElement(el: MarkupElement, ctx: Ctx): NodeInput[] | undefined {
  if (SKIP.has(el.tag)) return undefined;
  if (el.attrs.class) ctx.warn("classes CSS não são aplicadas; só estilos inline (style=\"\")");
  const css = parseStyle(el.attrs.style);
  const declared = el.attrs["data-paprika-type"];
  const ptype = declared && PAPRIKA_TYPES.has(declared) ? declared : undefined;
  const name = (el.attrs["data-name"] ?? "").slice(0, 200);
  const named = (n: NodeInput) => {
    if (name) n.name = name;
    return n;
  };
  const text = textStyleOf(css, el.tag, ctx.text, ctx);

  if (ptype === "path") {
    const n = pathNode(el, css, ctx);
    return n ? [named(n)] : undefined;
  }
  if (!ptype && el.tag === "svg") {
    const r = importSVG(el);
    for (const w of r.warnings) ctx.warn(w);
    return r.nodes;
  }
  if (ptype === "image" || (!ptype && el.tag === "img")) {
    const src = el.attrs.src ?? "";
    if (!/^(https?:|data:image\/)/.test(src)) {
      ctx.warn(`<img> sem src http(s) ou data:image/ ignorado`);
      return undefined;
    }
    const n: NodeInput = { type: "image", src };
    boxProps(n, css, ctx, !ptype);
    if (!ptype) {
      const w = px(el.attrs.width);
      const h = px(el.attrs.height);
      if (w !== undefined && n.width === "hug") n.width = w;
      if (h !== undefined && n.height === "hug") n.height = h;
    }
    if (el.attrs.alt) n.alt = el.attrs.alt;
    const fit = css["object-fit"];
    if (fit === "cover" || fit === "contain" || fit === "fill") n.fit = fit;
    return [named(n)];
  }
  if (ptype === "rect" || ptype === "ellipse") {
    const n: NodeInput = { type: ptype };
    boxProps(n, css, ctx, false);
    return [named(n)];
  }
  // Um contêiner flex dispõe cada filho como item, mesmo que só tenha texto.
  const flex = css.display === "flex" || css.display === "inline-flex";
  if (ptype === "text" || (!ptype && !flex && isTextual(el) && visibleText(el, !!text.pre))) {
    const pre = ptype === "text" || !!text.pre;
    const n: NodeInput = { type: "text", text: visibleText(el, pre) };
    boxProps(n, css, ctx, !ptype);
    applyText(n, text);
    if (!ptype && (n.fill !== undefined || n.stroke !== undefined || css.padding)) {
      // Um botão ou etiqueta: o fundo vira um frame em volta do texto.
      const box: NodeInput = { type: "frame", children: [] };
      boxProps(box, css, ctx, true);
      box.clip = css.overflow === "hidden";
      box.layout = { ...(layoutOf(css, false) ?? { mode: "row" }), align: "center", justify: text.textAlign === "center" ? "center" : "start" };
      const pad = pxList(css.padding);
      if (pad) (box.layout as Record<string, unknown>).padding = pad.every((v) => v === pad[0]) ? pad[0] : pad;
      n.width = "hug";
      n.height = "hug";
      for (const k of ["fill", "stroke", "radius", "shadow", "visible"]) delete n[k];
      delete n.x;
      delete n.y;
      delete n.rotation;
      delete n.opacity;
      box.children = [n];
      return [named(box)];
    }
    return [named(n)];
  }
  const isGroup = ptype === "group";
  const n: NodeInput = { type: isGroup ? "group" : "frame" };
  boxProps(n, css, ctx, !ptype);
  if (!isGroup) n.clip = css.overflow === "hidden";
  const hasBlocks = elements(el).some((c) => !SKIP.has(c.tag) && parseStyle(c.attrs.style).position !== "absolute");
  const layout = isGroup ? undefined : layoutOf(css, !ptype && hasBlocks);
  if (layout) n.layout = layout;
  const mode = (layout?.mode as Mode | undefined) ?? null;
  n.children = convertChildren(el, { mode, text, warn: ctx.warn });
  if (isGroup && !n.children.length) return undefined;
  return [named(n)];
}

/** Converte HTML em nós. `x`/`y` deslocam os nós de topo (posicionados em absoluto). */
export function importHTML(src: string, opts: { x?: number; y?: number } = {}): ImportResult {
  const warnings: string[] = [];
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  const root = parseMarkup(src);
  const body = findElement(root, "body") ?? root;
  const nodes = convertChildren(body, { mode: null, text: {}, warn });
  for (const n of nodes) {
    if (opts.x) n.x = round4(((n.x as number | undefined) ?? 0) + opts.x);
    if (opts.y) n.y = round4(((n.y as number | undefined) ?? 0) + opts.y);
  }
  if (!nodes.length) warnings.push("o HTML não tem elementos para importar");
  return { nodes, warnings };
}
