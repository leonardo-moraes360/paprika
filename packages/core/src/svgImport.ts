import { elements, findElement, parseMarkup, parseStyle, textContent, type MarkupElement } from "./markup.js";
import { parseColor } from "./lint.js";
import { measureText } from "./layout.js";
import { round4 } from "./num.js";
import { parsePath, pathBounds, serializePath, translatePath, type Point, type Segment } from "./path.js";
import type { NodeInput } from "./ops.js";

export interface ImportResult {
  nodes: NodeInput[];
  warnings: string[];
}

export type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

const NUM = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g;
const numbers = (s: string): number[] => (s.match(NUM) ?? []).map(Number);

const isLetter = (c: string | undefined) => !!c && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));

function transformCalls(s: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < s.length) {
    if (!isLetter(s[i])) {
      i++;
      continue;
    }
    const start = i;
    while (isLetter(s[i])) i++;
    const name = s.slice(start, i);
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (s[i] !== "(") continue;
    const close = s.indexOf(")", i + 1);
    if (close < 0) break;
    out.push([name, s.slice(i + 1, close)]);
    i = close + 1;
  }
  return out;
}

export function isSVGText(s: string): boolean {
  let i = 0;
  const skipSpace = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  const startsWith = (prefix: string) => s.slice(i, i + prefix.length).toLowerCase() === prefix;
  const skipPast = (end: string, from: number) => {
    const at = s.indexOf(end, from);
    if (at < 0) return false;
    i = at + end.length;
    skipSpace();
    return true;
  };
  if (startsWith("<?xml") && !skipPast(">", i)) return false;
  for (;;) {
    if (startsWith("<!--")) {
      if (!skipPast("-->", i + 4)) return false;
    } else if (startsWith("<!doctype")) {
      if (!skipPast(">", i)) return false;
    } else break;
  }
  return startsWith("<svg") && /[\s>]/.test(s[i + 4] ?? "");
}

export function parseTransform(s: string | undefined, warn: (w: string) => void): Matrix {
  let m = IDENTITY;
  if (!s) return m;
  for (const [name, args] of transformCalls(s)) {
    const v = numbers(args);
    let t: Matrix | undefined;
    const rad = ((v[0] ?? 0) * Math.PI) / 180;
    switch (name) {
      case "matrix":
        if (v.length === 6) t = v as Matrix;
        break;
      case "translate":
        t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case "scale":
        t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const r: Matrix = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
        const cx = v[1] ?? 0;
        const cy = v[2] ?? 0;
        t = multiply(multiply([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan(rad), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan(rad), 0, 1, 0, 0];
        break;
    }
    if (t) m = multiply(m, t);
    else warn(`transform "${name}" is invalid; skipped`);
  }
  return m;
}

export function arcToCubics(from: Point, s: Extract<Segment, { cmd: "A" }>): Segment[] {
  let { rx, ry } = s;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [{ cmd: "L", to: s.to }];
  if (from.x === s.to.x && from.y === s.to.y) return [];
  const phi = (s.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - s.to.x) / 2;
  const dy = (from.y - s.to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (s.largeArc === s.sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + s.to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + s.to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!s.sweep && dt > 0) dt -= 2 * Math.PI;
  if (s.sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): Point => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  });
  const deriv = (t: number): Point => ({
    x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  });
  const out: Segment[] = [];
  for (let j = 0; j < n; j++) {
    const a = t1 + step * j;
    const b = a + step;
    const p0 = at(a);
    const p3 = j === n - 1 ? s.to : at(b);
    const d0 = deriv(a);
    const d1 = deriv(b);
    out.push({
      cmd: "C",
      c1: { x: p0.x + alpha * d0.x, y: p0.y + alpha * d0.y },
      c2: { x: p3.x - alpha * d1.x, y: p3.y - alpha * d1.y },
      to: p3,
    });
  }
  return out;
}

export function transformPath(segs: Segment[], m: Matrix): Segment[] {
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) return translatePath(segs, m[4], m[5]);
  const out: Segment[] = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  const t = (p: Point) => apply(m, p);
  for (const s of segs) {
    switch (s.cmd) {
      case "M":
        out.push({ cmd: "M", to: t(s.to) });
        cur = start = s.to;
        break;
      case "L":
        out.push({ cmd: "L", to: t(s.to) });
        cur = s.to;
        break;
      case "C":
        out.push({ cmd: "C", c1: t(s.c1), c2: t(s.c2), to: t(s.to) });
        cur = s.to;
        break;
      case "Q":
        out.push({ cmd: "Q", c: t(s.c), to: t(s.to) });
        cur = s.to;
        break;
      case "A":
        for (const c of arcToCubics(cur, s)) {
          if (c.cmd === "C") out.push({ cmd: "C", c1: t(c.c1), c2: t(c.c2), to: t(c.to) });
          else if (c.cmd === "L") out.push({ cmd: "L", to: t(c.to) });
        }
        cur = s.to;
        break;
      case "Z":
        out.push(s);
        cur = start;
        break;
    }
  }
  return out;
}

interface Paint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  fillRule: string;
  cap: string;
  join: string;
  fillOpacity: number;
  strokeOpacity: number;
}

const INHERIT_DEFAULT: Paint = {
  fill: "#000000",
  stroke: null,
  strokeWidth: 1,
  fillRule: "nonzero",
  cap: "butt",
  join: "miter",
  fillOpacity: 1,
  strokeOpacity: 1,
};

const SKIP = new Set(["defs", "title", "desc", "metadata", "style", "script", "clippath", "lineargradient", "radialgradient", "symbol", "marker", "pattern", "mask", "filter"]);
const CONTAINERS = new Set(["g", "a", "svg", "switch"]);
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);

const num = (s: string | undefined, fallback = 0): number => {
  if (s === undefined) return fallback;
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : fallback;
};

function withAlpha(color: string, alpha: number, warn: (w: string) => void): string {
  if (alpha >= 1) return color;
  const c = parseColor(color);
  if (!c) {
    warn(`opacity of "${color}" skipped (unrecognized color)`);
    return color;
  }
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${round4(c.a * alpha)})`;
}

function cleanColor(v: string, warn: (w: string) => void): string | null {
  const s = v.trim();
  if (s === "none" || s === "transparent") return null;
  if (s === "currentColor" || s === "currentcolor") return "#000000";
  if (/url\(/i.test(s)) {
    warn("gradients and patterns (url(#…)) are not imported; using gray");
    return "#808080";
  }
  if (/[;{}<>]/.test(s) || s.length > 200) {
    warn(`invalid color "${s.slice(0, 40)}" skipped`);
    return "#000000";
  }
  return s;
}

function paintOf(el: MarkupElement, parent: Paint, warn: (w: string) => void): Paint {
  const css = parseStyle(el.attrs.get("style"));
  const get = (k: string) => css.get(k) ?? el.attrs.get(k);
  const p: Paint = { ...parent };
  const fill = get("fill");
  if (fill !== undefined && fill !== "inherit") p.fill = cleanColor(fill, warn);
  const stroke = get("stroke");
  if (stroke !== undefined && stroke !== "inherit") p.stroke = cleanColor(stroke, warn);
  const sw = get("stroke-width");
  if (sw !== undefined) p.strokeWidth = Math.max(0, num(sw, 1));
  const fr = get("fill-rule");
  if (fr === "evenodd" || fr === "nonzero") p.fillRule = fr;
  const cap = get("stroke-linecap");
  if (cap === "butt" || cap === "round" || cap === "square") p.cap = cap;
  const join = get("stroke-linejoin");
  if (join === "miter" || join === "round" || join === "bevel") p.join = join;
  const fo = get("fill-opacity");
  if (fo !== undefined) p.fillOpacity = Math.min(1, Math.max(0, num(fo, 1)));
  const so = get("stroke-opacity");
  if (so !== undefined) p.strokeOpacity = Math.min(1, Math.max(0, num(so, 1)));
  return p;
}

function hidden(el: MarkupElement): boolean {
  const css = parseStyle(el.attrs.get("style"));
  return (css.get("display") ?? el.attrs.get("display")) === "none" || (css.get("visibility") ?? el.attrs.get("visibility")) === "hidden";
}

function opacityOf(el: MarkupElement): number {
  const css = parseStyle(el.attrs.get("style"));
  return Math.min(1, Math.max(0, num(css.get("opacity") ?? el.attrs.get("opacity"), 1)));
}

function nameOf(el: MarkupElement): string {
  const title = elements(el).find((c) => c.tag === "title");
  const n = (title ? textContent(title) : (el.attrs.get("id") ?? "")).trim();
  return n.slice(0, 200);
}

function shapeSegments(el: MarkupElement): Segment[] {
  const a = (k: string) => el.attrs.get(k);
  switch (el.tag) {
    case "path":
      return parsePath(a("d") ?? "");
    case "rect": {
      const x = num(a("x"));
      const y = num(a("y"));
      const w = num(a("width"));
      const h = num(a("height"));
      if (w <= 0 || h <= 0) return [];
      let rx = a("rx") !== undefined ? num(a("rx")) : a("ry") !== undefined ? num(a("ry")) : 0;
      let ry = a("ry") !== undefined ? num(a("ry")) : rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (!rx || !ry)
        return [
          { cmd: "M", to: { x, y } },
          { cmd: "L", to: { x: x + w, y } },
          { cmd: "L", to: { x: x + w, y: y + h } },
          { cmd: "L", to: { x, y: y + h } },
          { cmd: "Z" },
        ];
      const arc = (to: Point): Segment => ({ cmd: "A", rx, ry, rotation: 0, largeArc: false, sweep: true, to });
      return [
        { cmd: "M", to: { x: x + rx, y } },
        { cmd: "L", to: { x: x + w - rx, y } },
        arc({ x: x + w, y: y + ry }),
        { cmd: "L", to: { x: x + w, y: y + h - ry } },
        arc({ x: x + w - rx, y: y + h }),
        { cmd: "L", to: { x: x + rx, y: y + h } },
        arc({ x, y: y + h - ry }),
        { cmd: "L", to: { x, y: y + ry } },
        arc({ x: x + rx, y }),
        { cmd: "Z" },
      ];
    }
    case "circle":
    case "ellipse": {
      const cx = num(a("cx"));
      const cy = num(a("cy"));
      const rx = el.tag === "circle" ? num(a("r")) : num(a("rx"));
      const ry = el.tag === "circle" ? num(a("r")) : num(a("ry"));
      if (rx <= 0 || ry <= 0) return [];
      const arc = (to: Point): Segment => ({ cmd: "A", rx, ry, rotation: 0, largeArc: false, sweep: true, to });
      return [{ cmd: "M", to: { x: cx + rx, y: cy } }, arc({ x: cx - rx, y: cy }), arc({ x: cx + rx, y: cy }), { cmd: "Z" }];
    }
    case "line":
      return [
        { cmd: "M", to: { x: num(a("x1")), y: num(a("y1")) } },
        { cmd: "L", to: { x: num(a("x2")), y: num(a("y2")) } },
      ];
    default: {
      const v = numbers(a("points") ?? "");
      const segs: Segment[] = [];
      for (let k = 0; k + 1 < v.length; k += 2) segs.push({ cmd: k ? "L" : "M", to: { x: v[k]!, y: v[k + 1]! } });
      if (el.tag === "polygon" && segs.length) segs.push({ cmd: "Z" });
      return segs;
    }
  }
}

function strokeOf(p: Paint, scale: number, warn: (w: string) => void): { color: string; width: number } | undefined {
  if (!p.stroke || p.strokeWidth <= 0) return undefined;
  return { color: withAlpha(p.stroke, p.strokeOpacity, warn), width: round4(p.strokeWidth * scale) };
}

function shapeNode(el: MarkupElement, m: Matrix, paint: Paint, warn: (w: string) => void): NodeInput | undefined {
  const name = nameOf(el);
  const opacity = opacityOf(el);
  const fill = paint.fill ? withAlpha(paint.fill, paint.fillOpacity, warn) : undefined;
  const common: Record<string, unknown> = {};
  if (name) common.name = name;
  if (opacity !== 1) common.opacity = round4(opacity);
  const axis = m[1] === 0 && m[2] === 0 && m[0] > 0 && m[3] > 0;
  const a = (k: string) => el.attrs.get(k);
  if (axis && (el.tag === "rect" || el.tag === "circle" || el.tag === "ellipse")) {
    const rx = el.tag === "circle" ? num(a("r")) : num(a("rx"));
    const ry = el.tag === "circle" ? num(a("r")) : a("ry") !== undefined ? num(a("ry")) : rx;
    const uniformRadius = el.tag !== "rect" || ((a("rx") === undefined || a("ry") === undefined || rx === ry) && m[0] === m[3]);
    if (uniformRadius) {
      const isRect = el.tag === "rect";
      const x0 = isRect ? num(a("x")) : num(a("cx")) - rx;
      const y0 = isRect ? num(a("y")) : num(a("cy")) - ry;
      const w = isRect ? num(a("width")) : 2 * rx;
      const h = isRect ? num(a("height")) : 2 * ry;
      if (w <= 0 || h <= 0) return undefined;
      const p = apply(m, { x: x0, y: y0 });
      const node: NodeInput = {
        type: isRect ? "rect" : "ellipse",
        ...common,
        x: round4(p.x),
        y: round4(p.y),
        width: round4(w * m[0]),
        height: round4(h * m[3]),
      };
      if (isRect && rx > 0) node.radius = round4(Math.min(rx, w / 2, h / 2) * m[0]);
      if (fill) node.fill = fill;
      const stroke = strokeOf(paint, Math.sqrt(m[0] * m[3]), warn);
      if (stroke) node.stroke = stroke;
      return node;
    }
  }
  let segs: Segment[];
  try {
    segs = shapeSegments(el);
  } catch (e) {
    warn(`<${el.tag}> with invalid geometry skipped: ${(e as Error).message}`);
    return undefined;
  }
  if (segs.length < 2) return undefined;
  segs = transformPath(segs, m);
  const b = pathBounds(segs);
  const d = serializePath(translatePath(segs, -b.x, -b.y));
  const node: NodeInput = { type: "path", ...common, x: round4(b.x), y: round4(b.y), d };
  if (fill && el.tag !== "line") node.fill = fill;
  const stroke = strokeOf(paint, Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])), warn);
  if (stroke) {
    node.stroke = stroke;
    if (paint.cap !== "round") node.strokeCap = paint.cap;
    if (paint.join !== "round") node.strokeJoin = paint.join;
  }
  if (paint.fillRule !== "nonzero") node.fillRule = paint.fillRule;
  return node;
}

interface SvgFont {
  size: number;
  family?: string;
  weight?: number;
  anchor: "start" | "middle" | "end";
  spacing?: number;
}

interface SvgState {
  ids: Map<string, MarkupElement>;
  stack: string[];
  warn: (w: string) => void;
}

const FONT0: SvgFont = { size: 16, anchor: "start" };
const TEXT_ASCENT = 0.8;

function indexIds(el: MarkupElement, ids: Map<string, MarkupElement>) {
  const id = el.attrs.get("id");
  if (id && !ids.has(id)) ids.set(id, el);
  for (const c of elements(el)) indexIds(c, ids);
}

function fontOf(el: MarkupElement, parent: SvgFont): SvgFont {
  const css = parseStyle(el.attrs.get("style"));
  const get = (k: string) => css.get(k) ?? el.attrs.get(k);
  const next: SvgFont = { ...parent };
  const fs = get("font-size");
  if (fs !== undefined) {
    const n = num(fs, parent.size);
    if (n >= 1) next.size = Math.min(1000, n);
  }
  const fam = get("font-family");
  if (fam) {
    const f = fam.replace(/[;{}<>()]/g, "").trim().slice(0, 200);
    if (f) next.family = f;
  }
  const fw = get("font-weight");
  if (fw) {
    const n = fw === "bold" || fw === "bolder" ? 700 : fw === "normal" || fw === "lighter" ? 400 : Number.parseInt(fw, 10);
    if (Number.isInteger(n) && n >= 100 && n <= 900) next.weight = n;
  }
  const ta = get("text-anchor");
  if (ta === "start" || ta === "middle" || ta === "end") next.anchor = ta;
  const ls = get("letter-spacing");
  if (ls !== undefined) next.spacing = num(ls, 0);
  return next;
}

function firstNum(el: MarkupElement, k: string): number {
  return numbers(el.attrs.get(k) ?? "")[0] ?? 0;
}

function collapseSVGText(raw: string, preserve: boolean): string {
  if (preserve) return raw;
  return raw.replace(/[ \t\r\n\f]+/g, " ").trim();
}

function textPieces(textEl: MarkupElement): { text: string; el: MarkupElement; x: number; y: number }[] {
  const baseX = firstNum(textEl, "x");
  const baseY = firstNum(textEl, "y");
  const preserve = textEl.attrs.get("xml:space") === "preserve";
  const positioned = elements(textEl).some(
    (c) => c.tag === "tspan" && (c.attrs.has("x") || c.attrs.has("y") || c.attrs.has("dx") || c.attrs.has("dy")),
  );
  if (!positioned) {
    const text = collapseSVGText(textContent(textEl), preserve);
    return text ? [{ text, el: textEl, x: baseX, y: baseY }] : [];
  }
  const out: { text: string; el: MarkupElement; x: number; y: number }[] = [];
  let x = baseX;
  let y = baseY;
  const push = (raw: string, el: MarkupElement, px: number, py: number) => {
    const text = collapseSVGText(raw, preserve || el.attrs.get("xml:space") === "preserve");
    if (text) out.push({ text, el, x: px, y: py });
  };
  for (const c of textEl.children) {
    if (typeof c === "string") {
      push(c, textEl, x, y);
      continue;
    }
    if (c.tag !== "tspan") continue;
    x = c.attrs.has("x") ? firstNum(c, "x") : x + (c.attrs.has("dx") ? num(c.attrs.get("dx")) : 0);
    y = c.attrs.has("y") ? firstNum(c, "y") : y + (c.attrs.has("dy") ? num(c.attrs.get("dy")) : 0);
    push(textContent(c), c, x, y);
  }
  return out;
}

function textNode(piece: { text: string; el: MarkupElement; x: number; y: number }, m: Matrix, paint: Paint, local: SvgFont, name: string, opacity: number, warn: (w: string) => void): NodeInput {
  const weight = local.weight ?? 400;
  const box = measureText(piece.text, local.size, { fontWeight: weight, letterSpacing: local.spacing });
  let lx = piece.x;
  if (local.anchor === "middle") lx -= box.width / 2;
  else if (local.anchor === "end") lx -= box.width;
  const ly = piece.y - local.size * TEXT_ASCENT;
  const p = apply(m, { x: lx, y: ly });
  const scale = Math.hypot(m[0], m[1]) || 1;
  const node: NodeInput = { type: "text" };
  if (name) node.name = name;
  if (opacity !== 1) node.opacity = round4(opacity);
  node.x = round4(p.x);
  node.y = round4(p.y);
  node.width = "hug";
  node.height = "hug";
  node.text = piece.text;
  node.color = paint.fill ? withAlpha(paint.fill, paint.fillOpacity, warn) : "transparent";
  if (local.family) node.fontFamily = local.family;
  const fontSize = round4(Math.min(1000, Math.max(1, local.size * scale)));
  if (fontSize !== 16) node.fontSize = fontSize;
  if (local.weight !== undefined && local.weight !== 400) node.fontWeight = local.weight;
  if (local.anchor === "middle") node.textAlign = "center";
  else if (local.anchor === "end") node.textAlign = "right";
  if (local.spacing) node.letterSpacing = round4(local.spacing * scale);
  if (!(m[1] === 0 && m[2] === 0)) warn("<text> with rotation or skew stays upright; only the origin is transformed");
  return node;
}

function textNodes(el: MarkupElement, m: Matrix, paint: Paint, font: SvgFont, warn: (w: string) => void): NodeInput[] {
  const pieces = textPieces(el);
  if (!pieces.length) return [];
  const name = nameOf(el);
  const opacity = opacityOf(el);
  const base = fontOf(el, font);
  const cp = paintOf(el, paint, warn);
  const nodes = pieces.map((piece) =>
    textNode(
      piece,
      m,
      piece.el === el ? cp : paintOf(piece.el, cp, warn),
      piece.el === el ? base : fontOf(piece.el, base),
      pieces.length === 1 ? name : "",
      pieces.length === 1 ? opacity : 1,
      warn,
    ),
  );
  if (pieces.length === 1) return nodes;
  const g: NodeInput = { type: "group", children: nodes };
  if (name) g.name = name;
  if (opacity !== 1) g.opacity = round4(opacity);
  return [g];
}

function useTarget(el: MarkupElement, state: SvgState): MarkupElement | undefined {
  const raw = (el.attrs.get("href") ?? el.attrs.get("xlink:href") ?? "").trim();
  if (!raw) {
    state.warn("<use> without href skipped");
    return undefined;
  }
  if (!raw.startsWith("#")) {
    state.warn(`external <use> (${raw.slice(0, 80)}) is not imported`);
    return undefined;
  }
  let id = raw.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
  }
  const target = state.ids.get(id);
  if (!target) {
    state.warn(`<use> target "#${id}" was not found`);
    return undefined;
  }
  if (state.stack.includes(id)) {
    state.warn(`<use> cycle on "#${id}" skipped`);
    return undefined;
  }
  state.stack.push(id);
  return target;
}

function expandUse(el: MarkupElement, m: Matrix, paint: Paint, font: SvgFont, state: SvgState): NodeInput[] {
  const target = useTarget(el, state);
  if (!target) return [];
  try {
    const used = paintOf(el, paint, state.warn);
    const usedFont = fontOf(el, font);
    const cm = multiply(m, multiply(parseTransform(el.attrs.get("transform"), state.warn), [1, 0, 0, 1, num(el.attrs.get("x")), num(el.attrs.get("y"))]));
    let kids: NodeInput[];
    if (target.tag === "symbol" || target.tag === "svg") {
      let placed = cm;
      const vb = numbers(target.attrs.get("viewbox") ?? "");
      const wAttr = el.attrs.get("width");
      const hAttr = el.attrs.get("height");
      if (vb.length === 4 && vb[2]! > 0 && vb[3]! > 0) {
        let sx = 1;
        let sy = 1;
        if (wAttr?.includes("%") || hAttr?.includes("%")) state.warn("<use> percentage width or height is not scaled");
        else if (wAttr && hAttr) {
          const ww = num(wAttr);
          const hh = num(hAttr);
          if (ww > 0 && hh > 0) {
            sx = ww / vb[2]!;
            sy = hh / vb[3]!;
          }
        }
        placed = multiply(cm, [sx, 0, 0, sy, -vb[0]! * sx, -vb[1]! * sy]);
      }
      if (target.tag === "svg") placed = multiply(placed, [1, 0, 0, 1, num(target.attrs.get("x")), num(target.attrs.get("y"))]);
      placed = multiply(placed, parseTransform(target.attrs.get("transform"), state.warn));
      kids = convert(target, placed, paintOf(target, used, state.warn), fontOf(target, usedFont), state);
    } else {
      const wrapper: MarkupElement = { tag: "g", attrs: new Map(), children: [target] };
      kids = convert(wrapper, cm, used, usedFont, state);
    }
    if (!kids.length) return [];
    const opacity = opacityOf(el);
    const name = nameOf(el);
    if (kids.length === 1 && opacity === 1 && !name) return kids;
    if (kids.length === 1 && opacity === 1 && name && !kids[0]!.name) {
      kids[0]!.name = name;
      return kids;
    }
    const g: NodeInput = { type: "group", children: kids };
    if (name) g.name = name;
    if (opacity !== 1) g.opacity = round4(opacity);
    return [g];
  } finally {
    state.stack.pop();
  }
}

function rootMatrix(svg: MarkupElement): Matrix {
  const vb = numbers(svg.attrs.get("viewbox") ?? "");
  if (vb.length !== 4 || vb[2]! <= 0 || vb[3]! <= 0) return IDENTITY;
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  const sw = svg.attrs.get("width");
  const sh = svg.attrs.get("height");
  const w = sw && !sw.includes("%") ? num(sw, vw) : vw;
  const h = sh && !sh.includes("%") ? num(sh, vh) : vh;
  const s = Math.min(w / vw, h / vh);
  return [s, 0, 0, s, (w - vw * s) / 2 - vx * s, (h - vh * s) / 2 - vy * s];
}

function convert(el: MarkupElement, m: Matrix, paint: Paint, font: SvgFont, state: SvgState): NodeInput[] {
  const warn = state.warn;
  const out: NodeInput[] = [];
  for (const c of elements(el)) {
    if (SKIP.has(c.tag)) {
      if (c.tag === "style") warn("CSS in <style> is not applied; use attributes or style=\"\" on the elements");
      continue;
    }
    if (hidden(c)) continue;
    if (c.attrs.get("clip-path") || c.attrs.get("mask")) warn(`clip-path/mask on <${c.tag}> skipped`);
    const cm = multiply(m, parseTransform(c.attrs.get("transform"), warn));
    const cp = paintOf(c, paint, warn);
    const cf = fontOf(c, font);
    if (c.tag === "use") {
      out.push(...expandUse(c, m, paint, font, state));
      continue;
    }
    if (CONTAINERS.has(c.tag)) {
      const kids = convert(c, c.tag === "svg" ? multiply(cm, [1, 0, 0, 1, num(c.attrs.get("x")), num(c.attrs.get("y"))]) : cm, cp, cf, state);
      if (!kids.length) continue;
      const opacity = opacityOf(c);
      const name = nameOf(c);
      if (kids.length === 1 && opacity === 1 && !name) {
        out.push(kids[0]!);
        continue;
      }
      const g: NodeInput = { type: "group", children: kids };
      if (name) g.name = name;
      if (opacity !== 1) g.opacity = round4(opacity);
      out.push(g);
      continue;
    }
    if (SHAPES.has(c.tag)) {
      const n = shapeNode(c, cm, cp, warn);
      if (n) out.push(n);
      continue;
    }
    if (c.tag === "text") {
      out.push(...textNodes(c, cm, paint, font, warn));
      continue;
    }
    warn(`<${c.tag}> is not imported`);
  }
  return out;
}

function offset(nodes: NodeInput[], dx: number, dy: number): void {
  for (const n of nodes) {
    if (n.type === "group") offset(n.children ?? [], dx, dy);
    else {
      n.x = round4(((n.x as number | undefined) ?? 0) + dx);
      n.y = round4(((n.y as number | undefined) ?? 0) + dy);
    }
  }
}

export function importSVG(src: string | MarkupElement, opts: { x?: number; y?: number; name?: string } = {}): ImportResult {
  const warnings: string[] = [];
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  const root = typeof src === "string" ? parseMarkup(src) : src;
  const svg = root.tag === "svg" ? root : findElement(root, "svg");
  if (!svg) throw new Error("no <svg> element found");
  const m = multiply(rootMatrix(svg), parseTransform(svg.attrs.get("transform"), warn));
  const paint = paintOf(svg, INHERIT_DEFAULT, warn);
  const ids = new Map<string, MarkupElement>();
  indexIds(svg, ids);
  const state: SvgState = { ids, stack: [], warn };
  let nodes = convert(svg, m, paint, fontOf(svg, FONT0), state);
  offset(nodes, opts.x ?? 0, opts.y ?? 0);
  if (!nodes.length) return { nodes: [], warnings: warnings.length ? warnings : ["the SVG has no shapes to import"] };
  const name = (opts.name ?? nameOf(svg)) || "SVG";
  const opacity = opacityOf(svg);
  if (nodes.length > 1 || opacity !== 1) {
    const g: NodeInput = { type: "group", name, children: nodes };
    if (opacity !== 1) g.opacity = round4(opacity);
    nodes = [g];
  } else if (!nodes[0]!.name) nodes[0]!.name = name;
  return { nodes, warnings };
}
