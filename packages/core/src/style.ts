import {
  ignoresLayout,
  listShadows,
  type ConnectorNode,
  type Document,
  type Gradient,
  type Layout,
  type Node,
  type PathNode,
  type ShadowSpec,
  type ShapeNode,
  type TextNode,
  type TextRun,
  type Size,
  type Stroke,
  type StrokePosition,
  type StrokeStyle,
  type TokenTypeName,
} from "./schema.js";
import { variantHidden } from "./component.js";
import { NOTE_FOLD_FILL, shapeOutline, shapePadding } from "./diagram.js";

export type CSS = Record<string, string | number>;

export function modeOf(doc: Document, node: Node | undefined): string | undefined {
  for (let n = node, depth = 0; n && depth < 1000; n = n.parentId ? doc.nodes[n.parentId] : undefined, depth++) {
    if ((n.type === "frame" || n.type === "page") && n.mode) return n.mode;
  }
  return undefined;
}

export function tokenValue(doc: Document, name: string, mode?: string): string | number | undefined {
  const m = mode && doc.modes && Object.hasOwn(doc.modes, mode) ? doc.modes[mode]! : undefined;
  if (m && Object.hasOwn(m, name)) return m[name];
  return Object.hasOwn(doc.tokens, name) ? doc.tokens[name] : undefined;
}

export function resolveValue<T extends string | number | undefined>(doc: Document, v: T, mode?: string): T | string | number {
  let cur: string | number | undefined = v;
  for (let depth = 0; depth < 8 && typeof cur === "string" && cur.startsWith("$"); depth++) {
    const next = tokenValue(doc, cur.slice(1), mode);
    if (next === undefined) return cur;
    cur = next;
  }
  return cur as T | string | number;
}

export function resolveLength(doc: Document, v: number | string | undefined, mode?: string): number | undefined {
  if (typeof v !== "number" && typeof v !== "string") return undefined;
  const r = typeof v === "number" ? v : resolveValue(doc, v, mode);
  return typeof r === "number" && Number.isFinite(r) ? r : undefined;
}

export function tokenTypeOf(doc: Document, name: string, depth = 0): TokenTypeName | undefined {
  if (depth > 8) return;
  const direct = doc.tokenMeta?.[name]?.type;
  if (direct) return direct;
  const base = Object.hasOwn(doc.tokens, name) ? doc.tokens[name] : undefined;
  if (typeof base === "string" && base.startsWith("$")) return tokenTypeOf(doc, base.slice(1), depth + 1);
  return;
}

export function resolvedFontFamily(doc: Document, v: string, mode?: string): string {
  const r = resolveValue(doc, v, mode);
  return typeof r === "string" ? r : v;
}

export function resolvedFontWeight(doc: Document, v: number | string, mode?: string): number {
  if (typeof v === "number") return v;
  const r = resolveValue(doc, v, mode);
  return typeof r === "number" ? r : 400;
}

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong"]);
const SERIF_NAME = /(^|[\s-])(serif|georgia|times|garamond|palatino|merriweather|playfair|lora|cambria|baskerville|didot|bodoni|caslon|charter)/i;
const MONO_NAME = /mono|code|courier|consolas|menlo|monaco/i;

function splitFamilies(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function withGenericFamily(list: string): string {
  const parts = splitFamilies(list);
  if (parts.some((p) => GENERIC_FAMILIES.has(p.toLowerCase()))) return list;
  const names = parts.filter((p) => !p.startsWith("var(")).join(" ");
  const generic = MONO_NAME.test(names) ? "monospace" : SERIF_NAME.test(names) && !/sans/i.test(names) ? "serif" : "sans-serif";
  return list.trim() ? `${list}, ${generic}` : generic;
}

function fontFamilyCSS(doc: Document, v: string, mode: string | undefined, vars: boolean | undefined): string {
  if (vars && v.startsWith("$") && isKnownToken(doc, v.slice(1))) {
    const type = tokenTypeOf(doc, v.slice(1));
    const raw = tokenValue(doc, v.slice(1), mode);
    if (type === "fontFamily" || (type === undefined && typeof raw === "string")) {
      const resolved = resolvedFontFamily(doc, v, mode);
      return `var(${cssVarName(v.slice(1))})${withGenericFamily(resolved).slice(resolved.length)}`;
    }
  }
  return withGenericFamily(resolvedFontFamily(doc, v, mode));
}

function fontWeightCSS(doc: Document, v: number | string, mode: string | undefined, vars: boolean | undefined): string | number {
  if (vars && typeof v === "string" && v.startsWith("$") && isKnownToken(doc, v.slice(1)) && tokenTypeOf(doc, v.slice(1)) === "fontWeight") {
    return `var(${cssVarName(v.slice(1))})`;
  }
  return resolvedFontWeight(doc, v, mode);
}

function lengthCSS(doc: Document, v: number | string, mode: string | undefined, vars: boolean | undefined, unit: "px" | "num"): string | number {
  if (vars && typeof v === "string" && v.startsWith("$") && isKnownToken(doc, v.slice(1))) {
    const ref = `var(${cssVarName(v.slice(1))})`;
    if (unit === "num" && tokenTypeOf(doc, v.slice(1)) === "lineHeight") return ref;
    return unit === "num" ? `calc(${ref} / 1px)` : ref;
  }
  const n = resolveLength(doc, v, mode);
  if (n === undefined) return typeof v === "string" ? v : unit === "px" ? "0px" : 0;
  return unit === "px" ? px(n) : n;
}

export function cssVarName(token: string): string {
  return `--${token.replace(/[\\.]/g, "\\$&")}`;
}

const isKnownToken = (doc: Document, name: string) =>
  Object.hasOwn(doc.tokens, name) || Object.values(doc.modes ?? {}).some((m) => Object.hasOwn(m, name));

function paintValue(doc: Document, v: string | number, mode: string | undefined, vars: boolean | undefined): string | number {
  if (vars && typeof v === "string" && v.startsWith("$") && isKnownToken(doc, v.slice(1))) return `var(${cssVarName(v.slice(1))})`;
  return resolveValue(doc, v, mode);
}

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function nodeGradient(node: Node): Gradient | undefined {
  if (node.type === "group" || node.type === "connector") return undefined;
  return node.gradient;
}

function gradientStopsCSS(doc: Document, g: Gradient, mode: string | undefined, vars: boolean | undefined): string {
  return [...g.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${paintValue(doc, s.color, mode, vars)} ${round(s.offset * 100)}%`)
    .join(", ");
}

export function gradientCSS(doc: Document, g: Gradient, mode: string | undefined, vars?: boolean): string {
  const stops = gradientStopsCSS(doc, g, mode, vars);
  const angle = round(g.angle);
  const cx = round(g.cx * 100);
  const cy = round(g.cy * 100);
  if (g.type === "radial") return `radial-gradient(ellipse ${round(g.radius * 100)}% ${round(g.radius * 100)}% at ${cx}% ${cy}%, ${stops})`;
  if (g.type === "conic") return `conic-gradient(from ${angle}deg at ${cx}% ${cy}%, ${stops})`;
  return `linear-gradient(${angle}deg, ${stops})`;
}

export function gradientLine(angle: number, w: number, h: number): { x1: number; y1: number; x2: number; y2: number } {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const tx = dx === 0 ? Infinity : w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return {
    x1: (w / 2 - dx * t) / w,
    y1: (h / 2 - dy * t) / h,
    x2: (w / 2 + dx * t) / w,
    y2: (h / 2 + dy * t) / h,
  };
}

function gradientStopXML(doc: Document, g: Gradient, mode: string | undefined, vars: boolean | undefined): string {
  return [...g.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `<stop offset="${round(s.offset * 100)}%" stop-color="${xmlEscape(String(paintValue(doc, s.color, mode, vars)))}"/>`)
    .join("");
}

export function svgGradientInner(doc: Document, node: Node, w: number, h: number, vars?: boolean): { fill: string; inner: string } | undefined {
  const g = nodeGradient(node);
  if (!g) return undefined;
  const mode = modeOf(doc, node);
  const id = xmlEscape(`paprika-g-${node.id}`);
  const stops = gradientStopXML(doc, g, mode, vars);
  if (g.type === "linear" || g.type === "radial") {
    const bw = w > 0 ? w : 1;
    const bh = h > 0 ? h : 1;
    const line = gradientLine(g.angle, bw, bh);
    const el =
      g.type === "linear"
        ? `<linearGradient id="${id}" gradientUnits="objectBoundingBox" x1="${round(line.x1)}" y1="${round(line.y1)}" x2="${round(line.x2)}" y2="${round(line.y2)}">${stops}</linearGradient>`
        : `<radialGradient id="${id}" gradientUnits="objectBoundingBox" cx="${round(g.cx)}" cy="${round(g.cy)}" r="${round(g.radius)}">${stops}</radialGradient>`;
    return { fill: `url(#${id})`, inner: `<defs>${el}</defs>` };
  }
  const css = xmlEscape(gradientCSS(doc, g, mode, vars));
  const maskId = xmlEscape(`paprika-gm-${node.id}`);
  let mask = "";
  let maskAttr = "";
  if (node.type === "path") {
    mask = `<mask id="${maskId}"><path d="${xmlEscape(node.d)}" fill="white" fill-rule="${node.fillRule}"/></mask>`;
    maskAttr = ` mask="url(#${maskId})"`;
  } else if (node.type === "shape") {
    const radius = resolveLength(doc, node.radius, mode) ?? 0;
    const sw = node.stroke ? (resolveLength(doc, node.stroke.width, mode) ?? 0) : 0;
    const o = shapeOutline({ ...node, radius, stroke: node.stroke ? { ...node.stroke, width: sw } : undefined });
    mask = `<mask id="${maskId}"><path d="${xmlEscape(o.d)}" fill="white"/></mask>`;
    maskAttr = ` mask="url(#${maskId})"`;
  } else if (node.type === "ellipse") {
    mask = `<mask id="${maskId}"><ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill="white"/></mask>`;
    maskAttr = ` mask="url(#${maskId})"`;
  }
  const under = `<foreignObject x="0" y="0" width="100%" height="100%"${maskAttr}><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;background:${css}"></div></foreignObject>`;
  return { fill: "none", inner: `${mask ? `<defs>${mask}</defs>` : ""}${under}` };
}

function cssValue(v: string): string {
  return v.replace(/[<>{};\\]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

function tokenDecls(doc: Document, tokens: Record<string, string | number>): string {
  return Object.entries(tokens)
    .map(([k, v]) => {
      const type = doc.tokenMeta?.[k]?.type;
      const value =
        typeof v === "number"
          ? type === "fontWeight" || type === "lineHeight"
            ? String(round(v))
            : `${round(v)}px`
          : v.startsWith("$") && isKnownToken(doc, v.slice(1))
            ? `var(${cssVarName(v.slice(1))})`
            : cssValue(v);
      return `${cssVarName(k)}:${value}`;
    })
    .join(";");
}

export function tokenStylesheet(doc: Document): string {
  let out = `:root{${tokenDecls(doc, doc.tokens)}}`;
  for (const [mode, tokens] of Object.entries(doc.modes ?? {})) out += `[data-paprika-mode="${mode}"]{${tokenDecls(doc, tokens)}}`;
  return out;
}

const px = (n: number) => `${round(n)}px`;
const round = (n: number) => Math.round(n * 100) / 100;

export function strokeStyleOf(stroke: Pick<Stroke, "style"> | undefined): StrokeStyle {
  return stroke?.style ?? "solid";
}

export function strokePositionOf(node: Pick<Node, "type"> & { stroke?: Pick<Stroke, "position"> | null }): StrokePosition {
  if (node.stroke?.position) return node.stroke.position;
  return node.type === "path" ? "center" : "inside";
}

export function strokeDasharray(width: number, style: StrokeStyle): string | undefined {
  if (style === "dashed") return `${round(width * 3)} ${round(width * 2.5)}`;
  if (style === "dotted") return `${round(width)} ${round(width * 1.5)}`;
  return undefined;
}

function dashOf(doc: Document, raw: number | string, vars: boolean | undefined, width: number, style: StrokeStyle): string | undefined {
  if (vars && typeof raw === "string" && raw.startsWith("$") && isKnownToken(doc, raw.slice(1))) {
    const ref = `var(${cssVarName(raw.slice(1))})`;
    if (style === "dashed") return `calc(${ref} * 3) calc(${ref} * 2.5)`;
    if (style === "dotted") return `calc(${ref} * 1) calc(${ref} * 1.5)`;
    return undefined;
  }
  return strokeDasharray(width, style);
}

function paddingCSS(doc: Document, p: Layout["padding"], mode: string | undefined, vars: boolean | undefined): string {
  const one = (v: number | string) => String(lengthCSS(doc, v, mode, vars, "px"));
  return Array.isArray(p) ? p.map(one).join(" ") : one(p);
}

export type CornerRadii = [number, number, number, number];

export function resolveCorners(doc: Document, radius: number | string | readonly (number | string)[], mode?: string): CornerRadii {
  const list = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
  return [0, 1, 2, 3].map((i) => resolveLength(doc, list[i], mode) ?? 0) as CornerRadii;
}

export function usedCornerRadii(w: number, h: number, radii: CornerRadii): CornerRadii {
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, r)) as CornerRadii;
  const fit = (sum: number, limit: number) => (sum > limit && limit > 0 ? limit / sum : 1);
  const factor = Math.min(fit(tl + tr, w), fit(bl + br, w), fit(tl + bl, h), fit(tr + br, h));
  return [tl * factor, tr * factor, br * factor, bl * factor];
}

export function uniformCorner(radii: CornerRadii): number | undefined {
  return radii[0] === radii[1] && radii[1] === radii[2] && radii[2] === radii[3] ? radii[0] : undefined;
}

function radiusCSS(doc: Document, radius: number | string | readonly (number | string)[], mode: string | undefined, vars: boolean | undefined): string | undefined {
  if (Array.isArray(radius)) {
    const parts = radius.map((v) => String(lengthCSS(doc, v, mode, vars, "px")));
    if (parts.every((p) => p === "0px")) return;
    return parts.join(" ");
  }
  if (typeof radius !== "number" && typeof radius !== "string") return;
  if (radius === 0) return;
  return String(lengthCSS(doc, radius, mode, vars, "px"));
}

function sizeProps(axis: "width" | "height", size: Size, parentMode: Layout["mode"] | null): CSS {
  if (typeof size === "number") return { [axis]: px(size), flexShrink: 0 };
  if (size === "hug") return { [axis]: "max-content" };
  if (parentMode === "row" || parentMode === "column") {
    const main = (parentMode === "row" && axis === "width") || (parentMode === "column" && axis === "height");
    return main ? { flex: "1 1 0", [axis === "width" ? "minWidth" : "minHeight"]: 0 } : { alignSelf: "stretch" };
  }
  return { [axis]: "100%" };
}

const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const;
const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;

export function nodeStyle(doc: Document, node: Node, opts: { asRoot?: boolean; vars?: boolean } = {}): CSS {
  if (node.type === "page") return {};
  const mode = modeOf(doc, node);
  const vis = node.visible && !variantHidden(doc, node);
  const paint = (v: string | number) => paintValue(doc, v, mode, opts.vars);
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  const parentMode = parent?.type === "frame" && parent.layout && parent.layout.mode !== "none" ? parent.layout.mode : null;
  const absoluteChild = !!parentMode && !opts.asRoot && ignoresLayout(node);
  const css: CSS = { boxSizing: "border-box" };

  const autoRoot = !!opts.asRoot && node.type !== "connector" && (typeof node.width !== "number" || typeof node.height !== "number");
  if ((parentMode && !opts.asRoot && node.type !== "connector" && !absoluteChild) || autoRoot) {
    css.position = "relative";
  } else {
    css.position = "absolute";
    css.left = px(opts.asRoot ? 0 : node.x);
    css.top = px(opts.asRoot ? 0 : node.y);
  }
  const sizeMode = opts.asRoot || absoluteChild ? null : parentMode;
  Object.assign(css, sizeProps("width", node.width, sizeMode));
  Object.assign(css, sizeProps("height", node.height, sizeMode));
  if (sizeMode && "layoutGrow" in node && node.layoutGrow) {
    const mainSize = sizeMode === "row" ? node.width : node.height;
    if (mainSize !== "fill") css.flexGrow = node.layoutGrow;
  }

  if (node.type === "group") {
    if (node.opacity !== 1) css.opacity = node.opacity;
    if (!vis) css.display = "none";
    return css;
  }
  if (node.type === "connector") {
    if (node.opacity !== 1) css.opacity = node.opacity;
    css.overflow = "visible";
    css.display = vis ? "block" : "none";
    return css;
  }
  if (node.rotation) css.transform = `rotate(${round(node.rotation)}deg)`;
  if (node.opacity !== 1) css.opacity = node.opacity;
  if ((node.type === "frame" || node.type === "text") && node.href) css.cursor = "pointer";
  if (!vis) css.display = "none";
  if (node.type === "path") {
    css.overflow = "visible";
    css.display = vis ? "block" : "none";
    applyShapeEffects(css, doc, node, mode, opts.vars, paint);
    return css;
  }
  if (node.type === "shape") {
    css.display = vis ? "flex" : "none";
    css.alignItems = node.shape === "note" ? "flex-start" : "center";
    css.justifyContent = "center";
    css.padding = shapePadding(node).map(px).join(" ");
    applyShapeEffects(css, doc, node, mode, opts.vars, paint);
    Object.assign(css, textCss(doc, node, mode, opts.vars, paint));
    return css;
  }
  const gradient = nodeGradient(node);
  if (gradient) css.background = gradientCSS(doc, gradient, mode, opts.vars);
  else if (node.fill) css.background = String(paint(node.fill));
  if (node.stroke) {
    const style = strokeStyleOf(node.stroke);
    const pos = strokePositionOf(node);
    const w = String(lengthCSS(doc, node.stroke.width, mode, opts.vars, "px"));
    const c = paint(node.stroke.color);
    if (pos === "inside") css.border = `${w} ${style} ${c}`;
    else {
      css.outline = `${w} ${style} ${c}`;
      if (pos === "center") {
        const n = resolveLength(doc, node.stroke.width, mode) ?? 0;
        css.outlineOffset = w.startsWith("var(") ? `calc(${w} / -2)` : `-${round(n / 2)}px`;
      } else css.outlineOffset = "0px";
    }
  }
  if (node.type === "ellipse") css.borderRadius = "50%";
  else {
    const cssR = radiusCSS(doc, node.radius, mode, opts.vars);
    if (cssR) css.borderRadius = cssR;
  }
  if (listShadows(node.shadow).length) css.boxShadow = shadowBoxes(doc, node.shadow, mode, opts.vars, paint);
  applyOutline(css, doc, node, mode, opts.vars, paint);
  applyLayerFilter(css, doc, node, mode, opts.vars);
  applyBackdrop(css, doc, node, mode, opts.vars);

  switch (node.type) {
    case "frame": {
      if (node.clip) css.overflow = "hidden";
      const l = node.layout;
      if (l && l.mode !== "none") {
        css.display = vis ? "flex" : "none";
        css.flexDirection = l.mode;
        css.gap = lengthCSS(doc, l.gap, mode, opts.vars, "px");
        css.padding = paddingCSS(doc, l.padding, mode, opts.vars);
        css.alignItems = ALIGN[l.align];
        css.justifyContent = JUSTIFY[l.justify];
        if (l.wrap) css.flexWrap = "wrap";
      }
      break;
    }
    case "text": {
      Object.assign(css, textCss(doc, node, mode, opts.vars, paint));
      css.margin = 0;
      break;
    }
    case "image":
      css.objectFit = node.fit;
      css.display = vis ? "block" : "none";
      break;
    default:
      break;
  }
  return css;
}

function shadowOffsets(doc: Document, s: { x: number | string; y: number | string; blur: number | string }, mode: string | undefined, vars: boolean | undefined): string {
  return `${lengthCSS(doc, s.x, mode, vars, "px")} ${lengthCSS(doc, s.y, mode, vars, "px")} ${lengthCSS(doc, s.blur, mode, vars, "px")}`;
}

type PaintFn = (v: string | number) => string | number;

function shadowFilter(
  doc: Document,
  s: { x: number | string; y: number | string; blur: number | string; color: string },
  mode: string | undefined,
  vars: boolean | undefined,
  paint: PaintFn,
): string {
  return `drop-shadow(${shadowOffsets(doc, s, mode, vars)} ${paint(s.color)})`;
}

function shadowBoxOne(doc: Document, s: ShadowSpec, mode: string | undefined, vars: boolean | undefined, paint: PaintFn): string {
  const inset = s.inner ? "inset " : "";
  return `${inset}${shadowOffsets(doc, s, mode, vars)} ${lengthCSS(doc, s.spread, mode, vars, "px")} ${paint(s.color)}`;
}

function shadowBoxes(
  doc: Document,
  shadow: ShadowSpec | readonly ShadowSpec[] | undefined,
  mode: string | undefined,
  vars: boolean | undefined,
  paint: PaintFn,
): string {
  return listShadows(shadow).map((s) => shadowBoxOne(doc, s, mode, vars, paint)).join(", ");
}

function effectNum(n: number): string {
  return String(round(n));
}

type EffectFilter = NonNullable<Extract<Node, { type: "rect" }>["filter"]>;

function filterCSS(doc: Document, filter: EffectFilter | undefined, mode: string | undefined, vars: boolean | undefined): string {
  if (!filter) return "";
  const parts: string[] = [];
  if (filter.blur !== undefined) parts.push(`blur(${lengthCSS(doc, filter.blur, mode, vars, "px")})`);
  if (filter.saturate !== undefined) parts.push(`saturate(${effectNum(filter.saturate)})`);
  if (filter.grayscale !== undefined) parts.push(`grayscale(${effectNum(filter.grayscale)})`);
  if (filter.brightness !== undefined) parts.push(`brightness(${effectNum(filter.brightness)})`);
  if (filter.sepia !== undefined) parts.push(`sepia(${effectNum(filter.sepia)})`);
  if (filter.invert !== undefined) parts.push(`invert(${effectNum(filter.invert)})`);
  if (filter.hueRotate !== undefined) parts.push(`hue-rotate(${effectNum(filter.hueRotate)}deg)`);
  return parts.join(" ");
}

function applyLayerFilter(css: CSS, doc: Document, node: Extract<Node, { filter?: EffectFilter }>, mode: string | undefined, vars: boolean | undefined) {
  const fx = filterCSS(doc, node.filter, mode, vars);
  if (!fx) return;
  css.filter = css.filter ? `${css.filter} ${fx}` : fx;
}

function applyBackdrop(css: CSS, doc: Document, node: Extract<Node, { backdropFilter?: EffectFilter }>, mode: string | undefined, vars: boolean | undefined) {
  const fx = filterCSS(doc, node.backdropFilter, mode, vars);
  if (fx) css.backdropFilter = fx;
}

function applyOutline(css: CSS, doc: Document, node: Extract<Node, { outline?: { color: string; width: number | string; style?: "solid" | "dashed" | "dotted"; offset?: number | string } }>, mode: string | undefined, vars: boolean | undefined, paint: PaintFn) {
  const o = node.outline;
  if (!o) return;
  const w = String(lengthCSS(doc, o.width, mode, vars, "px"));
  const decl = `${w} ${o.style ?? "solid"} ${paint(o.color)}`;
  if (!css.outline) {
    css.outline = decl;
    if (o.offset !== undefined) css.outlineOffset = String(lengthCSS(doc, o.offset, mode, vars, "px"));
    return;
  }
  const ring = `0px 0px 0px ${w} ${paint(o.color)}`;
  css.boxShadow = css.boxShadow ? `${css.boxShadow}, ${ring}` : ring;
}

function applyShapeEffects(css: CSS, doc: Document, node: Extract<Node, { type: "path" | "shape" }>, mode: string | undefined, vars: boolean | undefined, paint: PaintFn) {
  const shadows = listShadows(node.shadow);
  const drop = shadows.filter((s) => !s.inner).map((s) => shadowFilter(doc, s, mode, vars, paint)).join(" ");
  if (drop) css.filter = drop;
  const inners = shadows.filter((s) => s.inner);
  if (inners.length) css.boxShadow = inners.map((s) => shadowBoxOne(doc, s, mode, vars, paint)).join(", ");
  applyLayerFilter(css, doc, node, mode, vars);
  applyOutline(css, doc, node, mode, vars, paint);
  applyBackdrop(css, doc, node, mode, vars);
}

function textCss(
  doc: Document,
  node: Pick<ShapeNode, "color" | "fontFamily" | "fontSize" | "fontWeight" | "lineHeight" | "textAlign"> & { letterSpacing?: number | string },
  mode: string | undefined,
  vars: boolean | undefined,
  paint: (v: string | number) => string | number,
): CSS {
  const css: CSS = {};
  css.color = String(paint(node.color));
  css.fontFamily = fontFamilyCSS(doc, node.fontFamily, mode, vars);
  css.fontSize = lengthCSS(doc, node.fontSize, mode, vars, "px");
  css.fontWeight = fontWeightCSS(doc, node.fontWeight, mode, vars);
  css.lineHeight = lengthCSS(doc, node.lineHeight, mode, vars, "num");
  if (node.letterSpacing) css.letterSpacing = lengthCSS(doc, node.letterSpacing, mode, vars, "px");
  css.textAlign = node.textAlign;
  css.whiteSpace = "pre-wrap";
  css.overflowWrap = "anywhere";
  return css;
}

export function textRunCSS(doc: Document, node: TextNode, run: TextRun, vars?: boolean): CSS {
  const css: CSS = {};
  const mode = modeOf(doc, node);
  if (run.fontWeight !== undefined) css.fontWeight = fontWeightCSS(doc, run.fontWeight, mode, vars);
  if (run.color !== undefined) css.color = String(paintValue(doc, run.color, mode, vars));
  if (run.fontSize !== undefined) css.fontSize = lengthCSS(doc, run.fontSize, mode, vars, "px");
  if (run.italic) css.fontStyle = "italic";
  if (run.href) css.textDecoration = "underline";
  return css;
}

function strokeWidthAttr(doc: Document, v: number | string, vars: boolean | undefined, resolved: number): number | string {
  if (vars && typeof v === "string" && v.startsWith("$") && isKnownToken(doc, v.slice(1))) return `var(${cssVarName(v.slice(1))})`;
  return resolved;
}

export const SHAPE_SVG_CSS: CSS = { position: "absolute", left: 0, top: 0, overflow: "visible" };
export const SHAPE_TEXT_CSS: CSS = { position: "relative", width: "100%" };

export function shapeAttrs(doc: Document, node: ShapeNode, opts: { vars?: boolean } = {}): {
  svg: { width: number; height: number };
  path: { d: string; fill: string; stroke?: string; strokeWidth?: number | string; strokeLinejoin: string; strokeDasharray?: string };
  fold?: { d: string; fill: string };
  svgInner: string;
} {
  const mode = modeOf(doc, node);
  const radius = resolveLength(doc, node.radius, mode) ?? 0;
  const sw = node.stroke ? (resolveLength(doc, node.stroke.width, mode) ?? 0) : 0;
  const o = shapeOutline({ ...node, radius, stroke: node.stroke ? { ...node.stroke, width: sw } : undefined });
  const painted = svgGradientInner(doc, node, node.width, node.height, opts.vars);
  const path: ReturnType<typeof shapeAttrs>["path"] = {
    d: o.d,
    fill: painted ? painted.fill : node.fill ? String(paintValue(doc, node.fill, mode, opts.vars)) : "none",
    strokeLinejoin: "round",
  };
  if (node.stroke && sw > 0) {
    path.stroke = String(paintValue(doc, node.stroke.color, mode, opts.vars));
    path.strokeWidth = strokeWidthAttr(doc, node.stroke.width, opts.vars, sw);
    const dash = dashOf(doc, node.stroke.width, opts.vars, sw, strokeStyleOf(node.stroke));
    if (dash) path.strokeDasharray = dash;
  }
  const out: ReturnType<typeof shapeAttrs> = { svg: { width: node.width, height: node.height }, path, svgInner: painted?.inner ?? "" };
  if (o.fold) out.fold = { d: o.fold, fill: NOTE_FOLD_FILL };
  return out;
}

export function connectorAttrs(doc: Document, node: ConnectorNode, opts: { vars?: boolean } = {}): {
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number | string;
  strokeLinecap: string;
  strokeLinejoin: string;
  strokeDasharray?: string;
} {
  const mode = modeOf(doc, node);
  const sw = resolveLength(doc, node.stroke.width, mode) ?? 0;
  const a: ReturnType<typeof connectorAttrs> = {
    d: node.d,
    fill: "none",
    stroke: String(paintValue(doc, node.stroke.color, mode, opts.vars)),
    strokeWidth: strokeWidthAttr(doc, node.stroke.width, opts.vars, sw),
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  if (node.dashed) a.strokeDasharray = dashOf(doc, node.stroke.width, opts.vars, sw, "dashed");
  return a;
}

function sampleCubic(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, out: { x: number; y: number }[]) {
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

export function connectorMidpoint(d: string): { x: number; y: number } | null {
  const line = d.split(" M")[0] ?? "";
  const pts: { x: number; y: number }[] = [];
  let cur = { x: 0, y: 0 };
  const re = /([MLCA])\s*([^MLCA]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const cmd = m[1]!.toUpperCase();
    const nums = (m[2]!.match(/-?[\d.]+/g) ?? []).map(Number);
    if (cmd === "M" || cmd === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cur = { x: nums[i]!, y: nums[i + 1]! };
        pts.push(cur);
      }
    } else if (cmd === "C" && nums.length >= 6) {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const c1 = { x: nums[i]!, y: nums[i + 1]! };
        const c2 = { x: nums[i + 2]!, y: nums[i + 3]! };
        const end = { x: nums[i + 4]!, y: nums[i + 5]! };
        sampleCubic(cur, c1, c2, end, pts);
        cur = end;
      }
    } else if (cmd === "A" && nums.length >= 7) {
      for (let i = 0; i + 6 < nums.length; i += 7) {
        const end = { x: nums[i + 5]!, y: nums[i + 6]! };
        pts.push({ x: (cur.x + end.x) / 2, y: (cur.y + end.y) / 2 }, end);
        cur = end;
      }
    }
  }
  if (!pts.length) return null;
  const seg = (k: number) => Math.sqrt((pts[k + 1]!.x - pts[k]!.x) ** 2 + (pts[k + 1]!.y - pts[k]!.y) ** 2);
  let total = 0;
  for (let k = 0; k < pts.length - 1; k++) total += seg(k);
  let left = total / 2;
  for (let k = 0; k < pts.length - 1; k++) {
    const l = seg(k);
    if (left <= l && l > 0) {
      const t = left / l;
      return { x: round(pts[k]!.x + (pts[k + 1]!.x - pts[k]!.x) * t), y: round(pts[k]!.y + (pts[k + 1]!.y - pts[k]!.y) * t) };
    }
    left -= l;
  }
  return pts[0]!;
}

function connectorHalo(doc: Document, node: ConnectorNode, vars?: boolean): string {
  let cur = node.parentId ? doc.nodes[node.parentId] : undefined;
  while (cur) {
    if ((cur.type === "frame" || cur.type === "page" || cur.type === "rect" || cur.type === "ellipse") && cur.gradient) {
      cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
      continue;
    }
    const fill = cur.type === "frame" || cur.type === "page" || cur.type === "rect" || cur.type === "ellipse" ? cur.fill : undefined;
    if (fill && fill !== "transparent" && !/gradient|url\(/i.test(fill)) return String(paintValue(doc, fill, modeOf(doc, cur), vars));
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return "#ffffff";
}

export function connectorLabelAttrs(
  doc: Document,
  node: ConnectorNode,
  opts: { vars?: boolean } = {},
): { x: number; y: number; fill: string; stroke: string; strokeWidth: number; strokeLinejoin: "round"; paintOrder: string; fontFamily: string; fontSize: number; fontWeight: number; textAnchor: "middle"; dominantBaseline: "central" } | null {
  if (!node.label) return null;
  const at = connectorMidpoint(node.d);
  if (!at) return null;
  return {
    x: at.x,
    y: at.y,
    fill: String(paintValue(doc, node.stroke.color, modeOf(doc, node), opts.vars)),
    stroke: connectorHalo(doc, node, opts.vars),
    strokeWidth: 6,
    strokeLinejoin: "round",
    paintOrder: "stroke",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 12,
    fontWeight: 600,
    textAnchor: "middle",
    dominantBaseline: "central",
  };
}

export function pathAttrs(doc: Document, node: PathNode, opts: { vars?: boolean } = {}): {
  svg: { viewBox?: string; preserveAspectRatio?: string };
  path: {
    d: string;
    fill: string;
    fillRule: string;
    stroke?: string;
    strokeWidth?: number | string;
    strokeLinecap: string;
    strokeLinejoin: string;
    strokeDasharray?: string;
    paintOrder?: string;
  };
  svgInner: string;
} {
  const mode = modeOf(doc, node);
  const svg: { viewBox?: string; preserveAspectRatio?: string } = {};
  if (node.viewBox) {
    svg.viewBox = node.viewBox.map(round).join(" ");
    svg.preserveAspectRatio = "xMidYMid meet";
  }
  const painted = svgGradientInner(doc, node, typeof node.width === "number" ? node.width : 1, typeof node.height === "number" ? node.height : 1, opts.vars);
  const path: ReturnType<typeof pathAttrs>["path"] = {
    d: node.d,
    fill: painted ? painted.fill : node.fill ? String(paintValue(doc, node.fill, mode, opts.vars)) : "none",
    fillRule: node.fillRule,
    strokeLinecap: node.strokeCap,
    strokeLinejoin: node.strokeJoin,
  };
  const sw = node.stroke ? (resolveLength(doc, node.stroke.width, mode) ?? 0) : 0;
  if (node.stroke && sw > 0) {
    const pos = strokePositionOf(node);
    const shown = strokeWidthAttr(doc, node.stroke.width, opts.vars, sw);
    path.stroke = String(paintValue(doc, node.stroke.color, mode, opts.vars));
    if (pos === "outside" && node.fill) {
      path.strokeWidth = typeof shown === "string" ? `calc(${shown} * 2)` : shown * 2;
      path.paintOrder = "stroke fill";
    } else path.strokeWidth = shown;
    const dash = dashOf(doc, node.stroke.width, opts.vars, sw, strokeStyleOf(node.stroke));
    if (dash) path.strokeDasharray = dash;
  }
  return { svg, path, svgInner: painted?.inner ?? "" };
}

const UNITLESS = new Set(["opacity", "fontWeight", "lineHeight", "flexShrink", "flexGrow", "zIndex"]);

export function cssToString(css: CSS): string {
  return Object.entries(css)
    .map(([k, v]) => {
      const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const val = typeof v === "number" && !UNITLESS.has(k) && v !== 0 ? `${v}px` : String(v);
      return `${prop}:${val}`;
    })
    .join(";");
}

type LengthBound = { min?: number; max?: number };

function colorTokenProblem(doc: Document, id: string, field: string, value: unknown): string | undefined {
  return typeMismatch(doc, id, field, value, "color");
}

function fontFamilyProblem(doc: Document, id: string, value: unknown, mode?: string): string | undefined {
  const mismatch = typeMismatch(doc, id, "fontFamily", value, "fontFamily");
  if (mismatch) return mismatch;
  if (typeof value !== "string" || !value.startsWith("$")) return;
  const resolved = resolveValue(doc, value, mode);
  if (typeof resolved === "string" && resolved.startsWith("$")) return;
  if (typeof resolved !== "string" || resolved.length === 0 || resolved.length > 200 || /[;{}<>()]/.test(resolved))
    return `node "${id}" fontFamily: token "${value}" resolved to ${JSON.stringify(resolved)}, expected a font family`;
}

function fontWeightProblem(doc: Document, id: string, value: unknown, mode?: string): string | undefined {
  const mismatch = typeMismatch(doc, id, "fontWeight", value, "fontWeight");
  if (mismatch) return mismatch;
  if (typeof value !== "string" || !value.startsWith("$")) return;
  const resolved = resolveValue(doc, value, mode);
  if (typeof resolved === "string" && resolved.startsWith("$")) return;
  const shown = JSON.stringify(resolved);
  if (typeof resolved !== "number" || !Number.isInteger(resolved) || resolved < 100 || resolved > 900)
    return `node "${id}" fontWeight: token "${value}" is ${shown}, expected an integer >= 100 and <= 900`;
}

function typeMismatch(doc: Document, id: string, field: string, value: unknown, expected: TokenTypeName): string | undefined {
  if (typeof value !== "string" || !value.startsWith("$")) return;
  const declared = tokenTypeOf(doc, value.slice(1));
  if (!declared || declared === expected) return;
  return `node "${id}" ${field}: token "${value}" has type ${declared}, expected ${expected}`;
}

function lengthProblem(doc: Document, id: string, field: string, value: unknown, bound: LengthBound, mode: string | undefined, expected: TokenTypeName): string | undefined {
  const mismatch = typeMismatch(doc, id, field, value, expected);
  if (mismatch) return mismatch;
  if (typeof value !== "string" || !value.startsWith("$")) return;
  const resolved = resolveValue(doc, value, mode);
  if (typeof resolved === "string" && resolved.startsWith("$")) return;
  if (typeof resolved !== "number" || !Number.isFinite(resolved))
    return `node "${id}" ${field}: token "${value}" resolved to ${JSON.stringify(resolved)}, expected a length`;
  const shown = JSON.stringify(resolved);
  if (bound.min !== undefined && bound.max !== undefined && (resolved < bound.min || resolved > bound.max))
    return `node "${id}" ${field}: token "${value}" is ${shown}, expected a number >= ${JSON.stringify(bound.min)} and <= ${JSON.stringify(bound.max)}`;
  if (bound.min !== undefined && resolved < bound.min)
    return `node "${id}" ${field}: token "${value}" is ${shown}, expected a number >= ${JSON.stringify(bound.min)}`;
  if (bound.max !== undefined && resolved > bound.max)
    return `node "${id}" ${field}: token "${value}" is ${shown}, expected a number <= ${JSON.stringify(bound.max)}`;
}

export function lengthTokenError(doc: Document): string | undefined {
  const seen = new Set<string>();
  const visit = (id: string): string | undefined => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = doc.nodes[id];
    if (!n) return;
    if (n.type === "group") {
      for (const c of n.children) {
        const m = visit(c);
        if (m) return m;
      }
      return;
    }
    if (n.type === "page") {
      const fill = colorTokenProblem(doc, n.id, "fill", n.fill);
      if (fill) return fill;
      for (const c of n.children) {
        const m = visit(c);
        if (m) return m;
      }
      return;
    }
    const mode = modeOf(doc, n);
    const check = (field: string, value: unknown, bound: LengthBound, expected: TokenTypeName) =>
      lengthProblem(doc, n.id, field, value, bound, mode, expected);
    let msg: string | undefined;
    if (n.type === "connector") {
      msg = check("stroke.width", n.stroke.width, { min: 0, max: 1000 }, "length");
      msg = msg ?? colorTokenProblem(doc, n.id, "stroke.color", n.stroke.color);
    } else {
      if (Array.isArray(n.radius)) {
        for (let i = 0; i < n.radius.length && !msg; i++) msg = check(`radius.${i}`, n.radius[i], { min: 0 }, "length");
      } else msg = check("radius", n.radius, { min: 0 }, "length");
      if (n.stroke) {
        msg = msg ?? check("stroke.width", n.stroke.width, { min: 0, max: 1000 }, "length");
        msg = msg ?? colorTokenProblem(doc, n.id, "stroke.color", n.stroke.color);
      }
      listShadows(n.shadow).forEach((s, i) => {
        const p = Array.isArray(n.shadow) ? `shadow.${i}` : "shadow";
        msg = msg ?? check(`${p}.x`, s.x, {}, "length");
        msg = msg ?? check(`${p}.y`, s.y, {}, "length");
        msg = msg ?? check(`${p}.blur`, s.blur, { min: 0 }, "length");
        msg = msg ?? check(`${p}.spread`, s.spread, {}, "length");
        msg = msg ?? colorTokenProblem(doc, n.id, `${p}.color`, s.color);
      });
      if (n.outline) {
        msg = msg ?? check("outline.width", n.outline.width, { min: 0, max: 1000 }, "length");
        if (n.outline.offset !== undefined) msg = msg ?? check("outline.offset", n.outline.offset, { min: -1000, max: 1000 }, "length");
        msg = msg ?? colorTokenProblem(doc, n.id, "outline.color", n.outline.color);
      }
      if (n.filter?.blur !== undefined) msg = msg ?? check("filter.blur", n.filter.blur, { min: 0, max: 1000 }, "length");
      if (n.backdropFilter?.blur !== undefined) msg = msg ?? check("backdropFilter.blur", n.backdropFilter.blur, { min: 0, max: 1000 }, "length");
      msg = msg ?? colorTokenProblem(doc, n.id, "fill", n.fill);
      if (n.type === "frame" && n.layout) {
        msg = msg ?? check("layout.gap", n.layout.gap, { min: 0 }, "length");
        const p = n.layout.padding;
        if (Array.isArray(p)) {
          for (let i = 0; i < p.length && !msg; i++) msg = check(`layout.padding.${i}`, p[i], { min: 0 }, "length");
        } else msg = msg ?? check("layout.padding", p, { min: 0 }, "length");
      }
      if (n.type === "text" || n.type === "shape") {
        msg = msg ?? check("fontSize", n.fontSize, { min: 1, max: 1000 }, "fontSize");
        msg = msg ?? check("lineHeight", n.lineHeight, { min: 0, max: 10 }, "lineHeight");
        msg = msg ?? colorTokenProblem(doc, n.id, "color", n.color);
        msg = msg ?? fontFamilyProblem(doc, n.id, n.fontFamily, mode);
        msg = msg ?? fontWeightProblem(doc, n.id, n.fontWeight, mode);
      }
      if (n.type === "text") msg = msg ?? check("letterSpacing", n.letterSpacing, {}, "letterSpacing");
    }
    if (msg) return msg;
    if (n.type === "frame") {
      for (const c of n.children) {
        const m = visit(c);
        if (m) return m;
      }
    }
  };
  for (const id of doc.rootIds) {
    const m = visit(id);
    if (m) return m;
  }
}
