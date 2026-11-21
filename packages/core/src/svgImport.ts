import { elements, findElement, parseMarkup, parseStyle, textContent, type MarkupElement } from "./markup.js";
import { parseColor } from "./lint.js";
import { round4 } from "./num.js";
import { parsePath, pathBounds, serializePath, translatePath, type Point, type Segment } from "./path.js";
import type { NodeInput } from "./ops.js";

/**
 * Importa SVG como nós editáveis: `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`,
 * `<polyline>` e `<polygon>` viram nós `path` (ou `rect`/`ellipse` quando não há rotação nem
 * inclinação), `<g>` vira `group`. Transforms são aplicados à geometria (arcos viram bezier
 * cúbicas quando a transformação não é só translação). Pintura herdada (fill, stroke…) é
 * resolvida em cada nó. O que não tem equivalente (texto, imagens, gradientes, máscaras, CSS em
 * `<style>`) é ignorado e listado em `warnings`.
 */

export interface ImportResult {
  nodes: NodeInput[];
  warnings: string[];
}

/** Matriz afim SVG [a b c d e f]. */
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

/**
 * As chamadas `nome(args)` de um `transform`, como `/([a-zA-Z]+)\s*\(([^)]*)\)/g` acharia, mas numa
 * só passada (a regex volta a tentar a cada letra e fica quadrática em entradas montadas para isso).
 */
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

/**
 * Texto que começa como SVG (colado de um editor de código, de um arquivo aberto como texto…): `<svg` no
 * começo, depois de um `<?xml …?>`, comentários e `<!doctype …>` opcionais. Uma passada só, sem
 * regex com repetição aninhada (que fica lenta em textos colados montados para isso).
 */
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

/** Lê o atributo `transform` (matrix, translate, scale, rotate, skewX, skewY). */
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

/** Arco SVG (forma de extremos) em bezier cúbicas (SVG 1.1, apêndice F.6). */
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

/** Aplica uma matriz a segmentos absolutos; arcos viram cúbicas se a matriz não for só translação. */
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
  const v = parseFloat(s);
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
  const css = parseStyle(el.attrs.style);
  const get = (k: string) => css[k] ?? el.attrs[k];
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
  const css = parseStyle(el.attrs.style);
  return (css.display ?? el.attrs.display) === "none" || (css.visibility ?? el.attrs.visibility) === "hidden";
}

function opacityOf(el: MarkupElement): number {
  const css = parseStyle(el.attrs.style);
  return Math.min(1, Math.max(0, num(css.opacity ?? el.attrs.opacity, 1)));
}

function nameOf(el: MarkupElement): string {
  const title = elements(el).find((c) => c.tag === "title");
  const n = (title ? textContent(title) : (el.attrs.id ?? "")).trim();
  return n.slice(0, 200);
}

function shapeSegments(el: MarkupElement): Segment[] {
  const a = el.attrs;
  switch (el.tag) {
    case "path":
      return parsePath(a.d ?? "");
    case "rect": {
      const x = num(a.x);
      const y = num(a.y);
      const w = num(a.width);
      const h = num(a.height);
      if (w <= 0 || h <= 0) return [];
      let rx = a.rx !== undefined ? num(a.rx) : a.ry !== undefined ? num(a.ry) : 0;
      let ry = a.ry !== undefined ? num(a.ry) : rx;
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
      const cx = num(a.cx);
      const cy = num(a.cy);
      const rx = el.tag === "circle" ? num(a.r) : num(a.rx);
      const ry = el.tag === "circle" ? num(a.r) : num(a.ry);
      if (rx <= 0 || ry <= 0) return [];
      const arc = (to: Point): Segment => ({ cmd: "A", rx, ry, rotation: 0, largeArc: false, sweep: true, to });
      return [{ cmd: "M", to: { x: cx + rx, y: cy } }, arc({ x: cx - rx, y: cy }), arc({ x: cx + rx, y: cy }), { cmd: "Z" }];
    }
    case "line":
      return [
        { cmd: "M", to: { x: num(a.x1), y: num(a.y1) } },
        { cmd: "L", to: { x: num(a.x2), y: num(a.y2) } },
      ];
    default: {
      const v = numbers(a.points ?? "");
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
  const a = el.attrs;
  // rect/ellipse sem rotação viram nós nativos (editáveis no inspector).
  if (axis && (el.tag === "rect" || el.tag === "circle" || el.tag === "ellipse")) {
    const rx = el.tag === "circle" ? num(a.r) : num(a.rx);
    const ry = el.tag === "circle" ? num(a.r) : a.ry !== undefined ? num(a.ry) : rx;
    const uniformRadius = el.tag !== "rect" || ((a.rx === undefined || a.ry === undefined || rx === ry) && m[0] === m[3]);
    if (uniformRadius) {
      const isRect = el.tag === "rect";
      const x0 = isRect ? num(a.x) : num(a.cx) - rx;
      const y0 = isRect ? num(a.y) : num(a.cy) - ry;
      const w = isRect ? num(a.width) : 2 * rx;
      const h = isRect ? num(a.height) : 2 * ry;
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
    // Os padrões do Paprika são round/round; os do SVG, butt/miter.
    if (paint.cap !== "round") node.strokeCap = paint.cap;
    if (paint.join !== "round") node.strokeJoin = paint.join;
  }
  if (paint.fillRule !== "nonzero") node.fillRule = paint.fillRule;
  return node;
}

function rootMatrix(svg: MarkupElement): Matrix {
  const vb = numbers(svg.attrs.viewbox ?? "");
  if (vb.length !== 4 || vb[2]! <= 0 || vb[3]! <= 0) return IDENTITY;
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  const w = svg.attrs.width && !svg.attrs.width.includes("%") ? num(svg.attrs.width, vw) : vw;
  const h = svg.attrs.height && !svg.attrs.height.includes("%") ? num(svg.attrs.height, vh) : vh;
  const s = Math.min(w / vw, h / vh);
  return [s, 0, 0, s, (w - vw * s) / 2 - vx * s, (h - vh * s) / 2 - vy * s];
}

function convert(el: MarkupElement, m: Matrix, paint: Paint, warn: (w: string) => void): NodeInput[] {
  const out: NodeInput[] = [];
  for (const c of elements(el)) {
    if (SKIP.has(c.tag)) {
      if (c.tag === "style") warn("CSS in <style> is not applied; use attributes or style=\"\" on the elements");
      continue;
    }
    if (hidden(c)) continue;
    if (c.attrs["clip-path"] || c.attrs.mask) warn(`clip-path/mask on <${c.tag}> skipped`);
    const cm = multiply(m, parseTransform(c.attrs.transform, warn));
    const cp = paintOf(c, paint, warn);
    if (CONTAINERS.has(c.tag)) {
      const kids = convert(c, c.tag === "svg" ? multiply(cm, [1, 0, 0, 1, num(c.attrs.x), num(c.attrs.y)]) : cm, cp, warn);
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
    warn(`<${c.tag}> is not imported`);
  }
  return out;
}

/** Desloca nós de topo (coordenadas do SVG) por dx, dy. */
function offset(nodes: NodeInput[], dx: number, dy: number): void {
  for (const n of nodes) {
    if (n.type === "group") offset(n.children ?? [], dx, dy);
    else {
      n.x = round4(((n.x as number | undefined) ?? 0) + dx);
      n.y = round4(((n.y as number | undefined) ?? 0) + dy);
    }
  }
}

/**
 * Converte um SVG em nós. `x`/`y` deslocam a origem do SVG. Retorna um nó só (o shape, ou um
 * `group` com tudo), pronto para `create`.
 */
export function importSVG(src: string | MarkupElement, opts: { x?: number; y?: number; name?: string } = {}): ImportResult {
  const warnings: string[] = [];
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  const root = typeof src === "string" ? parseMarkup(src) : src;
  const svg = root.tag === "svg" ? root : findElement(root, "svg");
  if (!svg) throw new Error("no <svg> element found");
  const m = multiply(rootMatrix(svg), parseTransform(svg.attrs.transform, warn));
  const paint = paintOf(svg, INHERIT_DEFAULT, warn);
  let nodes = convert(svg, m, paint, warn);
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
