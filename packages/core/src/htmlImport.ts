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
    ctx.warn("background images (url()) are not imported");
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

function textStyleOf(css: ReadonlyMap<string, string>, tag: string, parent: TextStyle, ctx: Ctx): TextStyle {
  const t: TextStyle = { ...parent };
  const c = color(css.get("color"), ctx);
  if (c) t.color = c;
  const family = css.get("font-family");
  if (family) {
    const f = family.replace(/[;{}<>()]/g, "").slice(0, 200);
    if (f) t.fontFamily = f;
  }
  const fs = px(css.get("font-size"));
  if (fs !== undefined && fs >= 1) t.fontSize = Math.min(1000, fs);
  else if (css.get("font-size")) ctx.warn(`font-size "${css.get("font-size")}" is not px; skipped`);
  else if (HEADING[tag]) t.fontSize = HEADING[tag];
  const fw = css.get("font-weight");
  if (fw) {
    const n = fw === "bold" || fw === "bolder" ? 700 : fw === "normal" || fw === "lighter" ? 400 : Number(fw);
    if (Number.isInteger(n) && n >= 100 && n <= 900) t.fontWeight = n;
  } else if (HEADING[tag] || tag === "b" || tag === "strong") t.fontWeight = 700;
  const lh = css.get("line-height");
  if (lh) {
    const p = px(lh);
    if (lh.trim().endsWith("px") && p !== undefined) t.lineHeight = round4(p / (t.fontSize ?? 16));
    else if (lh === "normal") t.lineHeight = 1.2;
    else if (Number.isFinite(Number(lh))) t.lineHeight = Number(lh);
  }
  const ls = px(css.get("letter-spacing"));
  if (ls !== undefined) t.letterSpacing = ls;
  const ta = css.get("text-align");
  if (ta === "left" || ta === "start") t.textAlign = "left";
  else if (ta === "center") t.textAlign = "center";
  else if (ta === "right" || ta === "end") t.textAlign = "right";
  const ws = css.get("white-space");
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
function boxProps(node: NodeInput, css: ReadonlyMap<string, string>, ctx: Ctx, foreign: boolean) {
  const absolute = css.get("position") === "absolute" || css.get("position") === "fixed" || !ctx.mode;
  if (css.get("position") === "fixed" || css.get("position") === "sticky") ctx.warn(`position: ${css.get("position")} tratado como absolute`);
  if (absolute) {
    const x = px(css.get("left"));
    const y = px(css.get("top"));
    if (x !== undefined) node.x = x;
    if (y !== undefined) node.y = y;
  }
  const size = (axis: "width" | "height") => {
    const v = css.get(axis);
    const n = px(v);
    if (n !== undefined) return Math.max(0, n);
    if (v === "max-content" || v === "fit-content" || v === "min-content") return "hug";
    if (v === "100%") return "fill";
    if (v && v !== "auto") ctx.warn(`${axis} "${v}" is not supported; using hug`);
    const main = (ctx.mode === "row" && axis === "width") || (ctx.mode === "column" && axis === "height");
    if (ctx.mode && main && /^1(\s+1\s+0(px|%)?)?$/.test(css.get("flex") ?? "")) return "fill";
    if (ctx.mode && !main && css.get("align-self") === "stretch") return "fill";
    if (v) return "hug";
    // Sem tamanho: em HTML de fora, um bloco numa coluna ocupa a largura toda.
    if (foreign && ctx.mode === "column" && axis === "width") return "fill";
    return "hug";
  };
  if (node.type !== "group") {
    node.width = size("width");
    node.height = size("height");
  }
  const rot = /rotate\((-?[\d.]+)deg\)/.exec(css.get("transform") ?? "");
  if (rot && node.type !== "group") node.rotation = Number(rot[1]);
  const op = css.get("opacity") !== undefined ? Number(css.get("opacity")) : 1;
  if (Number.isFinite(op) && op !== 1) node.opacity = Math.min(1, Math.max(0, op));
  if (css.get("display") === "none") node.visible = false;
  if (node.type === "group") return;
  const fill = color(css.get("background-color") ?? css.get("background"), ctx);
  if (fill && (!foreign || (fill !== "transparent" && fill !== "none"))) node.fill = fill;
  const border = /^(\d+(?:\.\d+)?)px\s+(solid|dashed|dotted|double)\s+(.+)$/.exec((css.get("border") ?? "").trim());
  if (border) {
    const c = color(border[3], ctx);
    if (c) {
      const style = border[2] === "dashed" || border[2] === "dotted" ? border[2] : "solid";
      node.stroke = { color: c, width: Number(border[1]), style, position: "inside" };
    }
  }
  const radius = px(css.get("border-radius"));
  if (radius !== undefined && radius > 0 && node.type !== "ellipse") node.radius = radius;
  const shadow = /^(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(.+)$/.exec((css.get("box-shadow") ?? "").trim());
  if (shadow) {
    const c = color(shadow[5], ctx);
    if (c) node.shadow = { x: Number(shadow[1]), y: Number(shadow[2]), blur: Number(shadow[3]), spread: Number(shadow[4] ?? 0), color: c };
  }
}

function layoutOf(css: ReadonlyMap<string, string>, foreignFlow: boolean): Record<string, unknown> | undefined {
  const flex = css.get("display") === "flex" || css.get("display") === "inline-flex";
  if (!flex && !foreignFlow) return undefined;
  const dir = css.get("flex-direction");
  const layout: Record<string, unknown> = { mode: flex ? (dir === "column" || dir === "column-reverse" ? "column" : "row") : "column" };
  const gap = px(css.get("gap"));
  if (gap) layout.gap = gap;
  const pad = pxList(css.get("padding"));
  if (pad) layout.padding = pad.length === 1 || pad.every((v) => v === pad[0]) ? pad[0] : pad;
  if (flex) {
    layout.align = ALIGN[css.get("align-items") ?? "normal"] ?? "stretch";
    layout.justify = JUSTIFY[css.get("justify-content") ?? "normal"] ?? "start";
    if (css.get("flex-wrap") === "wrap") layout.wrap = true;
  } else layout.align = "stretch";
  return layout;
}

function pathNode(el: MarkupElement, css: ReadonlyMap<string, string>, ctx: Ctx): NodeInput | undefined {
  const p = findElement(el, "path");
  if (!p?.attrs.get("d")) return undefined;
  const node: NodeInput = { type: "path", d: p.attrs.get("d") };
  boxProps(node, css, ctx, false);
  delete node.fill;
  delete node.stroke;
  delete node.shadow;
  const vb = (el.attrs.get("viewbox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) node.viewBox = vb;
  const fill = p.attrs.get("fill");
  if (fill && fill !== "none") node.fill = fill;
  if (p.attrs.get("fill-rule") === "evenodd") node.fillRule = "evenodd";
  if (p.attrs.get("stroke") && p.attrs.get("stroke") !== "none") node.stroke = { color: p.attrs.get("stroke"), width: Number(p.attrs.get("stroke-width") ?? 1) };
  const cap = p.attrs.get("stroke-linecap");
  if (cap && cap !== "round") node.strokeCap = cap;
  const join = p.attrs.get("stroke-linejoin");
  if (join && join !== "round") node.strokeJoin = join;
  const ds = /drop-shadow\((-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(.+)\)$/.exec((css.get("filter") ?? "").trim());
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
  if (el.attrs.get("class")) ctx.warn("CSS classes are not applied; only inline styles (style=\"\")");
  const css = parseStyle(el.attrs.get("style"));
  const declared = el.attrs.get("data-paprika-type");
  const ptype = declared && PAPRIKA_TYPES.has(declared) ? declared : undefined;
  const name = (el.attrs.get("data-name") ?? "").slice(0, 200);
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
    const src = el.attrs.get("src") ?? "";
    if (!/^(https?:|data:image\/)/.test(src)) {
      ctx.warn(`<img> without an http(s) or data:image/ src skipped`);
      return undefined;
    }
    const n: NodeInput = { type: "image", src };
    boxProps(n, css, ctx, !ptype);
    if (!ptype) {
      const w = px(el.attrs.get("width"));
      const h = px(el.attrs.get("height"));
      if (w !== undefined && n.width === "hug") n.width = w;
      if (h !== undefined && n.height === "hug") n.height = h;
    }
    if (el.attrs.get("alt")) n.alt = el.attrs.get("alt");
    const fit = css.get("object-fit");
    if (fit === "cover" || fit === "contain" || fit === "fill") n.fit = fit;
    return [named(n)];
  }
  if (ptype === "rect" || ptype === "ellipse") {
    const n: NodeInput = { type: ptype };
    boxProps(n, css, ctx, false);
    return [named(n)];
  }
  // Um contêiner flex dispõe cada filho como item, mesmo que só tenha texto.
  const flex = css.get("display") === "flex" || css.get("display") === "inline-flex";
  if (ptype === "text" || (!ptype && !flex && isTextual(el) && visibleText(el, !!text.pre))) {
    const pre = ptype === "text" || !!text.pre;
    const n: NodeInput = { type: "text", text: visibleText(el, pre) };
    boxProps(n, css, ctx, !ptype);
    applyText(n, text);
    if (!ptype && (n.fill !== undefined || n.stroke !== undefined || css.get("padding"))) {
      // Um botão ou etiqueta: o fundo vira um frame em volta do texto.
      const box: NodeInput = { type: "frame", children: [] };
      boxProps(box, css, ctx, true);
      box.clip = css.get("overflow") === "hidden";
      box.layout = { ...(layoutOf(css, false) ?? { mode: "row" }), align: "center", justify: text.textAlign === "center" ? "center" : "start" };
      const pad = pxList(css.get("padding"));
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
  if (!isGroup) n.clip = css.get("overflow") === "hidden";
  const hasBlocks = elements(el).some((c) => !SKIP.has(c.tag) && parseStyle(c.attrs.get("style")).get("position") !== "absolute");
  const layout = isGroup ? undefined : layoutOf(css, !ptype && hasBlocks);
  if (layout) n.layout = layout;
  const theme = el.attrs.get("data-paprika-mode");
  if (!isGroup && theme && /^[A-Za-z0-9_-]{1,40}$/.test(theme)) n.mode = theme;
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
  if (!nodes.length) warnings.push("the HTML has no elements to import");
  return { nodes, warnings };
}
