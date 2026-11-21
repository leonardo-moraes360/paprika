/**
 * Edição ponto a ponto de um caminho: `d` vira subcaminhos de âncoras (ponto + alças bezier),
 * o canvas mexe nas âncoras e o resultado volta a `d`. Retas e cúbicas voltam como eram;
 * quadráticas viram cúbicas exatas e arcos viram cúbicas (aproximação de até ~0,03% do raio).
 */
import { pathBounds, serializePath, translatePath, type Anchor, type Point, type Segment } from "./path.js";
import { arcToCubics } from "./svgImport.js";

export interface Subpath {
  anchors: Anchor[];
  closed: boolean;
}

/** Posição de uma âncora: subcaminho e índice dentro dele. */
export interface AnchorRef {
  sub: number;
  index: number;
}

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const pt = (a: Anchor): Point => ({ x: a.x, y: a.y });

/** Segmentos absolutos (de `parsePath`) em subcaminhos editáveis. */
export function pathToSubpaths(segs: Segment[]): Subpath[] {
  const subs: Subpath[] = [];
  let cur = null as Subpath | null;
  let start: Point = { x: 0, y: 0 };
  let at: Point = { x: 0, y: 0 };
  const begin = (p: Point) => {
    cur = { anchors: [{ x: p.x, y: p.y }], closed: false };
    subs.push(cur);
    start = p;
    at = p;
  };
  // Depois de Z, um comando que não é M começa outro subcaminho no ponto inicial (regra do SVG).
  const open = (): Subpath => {
    if (!cur || cur.closed) begin(start);
    return cur!;
  };
  const curve = (c1: Point, c2: Point, to: Point) => {
    const s = open();
    const prev = s.anchors[s.anchors.length - 1]!;
    if (!same(c1, prev)) prev.out = c1;
    const a: Anchor = { x: to.x, y: to.y };
    if (!same(c2, to)) a.in = c2;
    s.anchors.push(a);
    at = to;
  };
  for (const seg of segs) {
    switch (seg.cmd) {
      case "M":
        begin(seg.to);
        break;
      case "L": {
        open().anchors.push({ x: seg.to.x, y: seg.to.y });
        at = seg.to;
        break;
      }
      case "C":
        curve(seg.c1, seg.c2, seg.to);
        break;
      case "Q": {
        // Elevação de grau: a quadrática é exatamente esta cúbica.
        const from = at;
        curve(
          { x: from.x + (2 / 3) * (seg.c.x - from.x), y: from.y + (2 / 3) * (seg.c.y - from.y) },
          { x: seg.to.x + (2 / 3) * (seg.c.x - seg.to.x), y: seg.to.y + (2 / 3) * (seg.c.y - seg.to.y) },
          seg.to,
        );
        break;
      }
      case "A": {
        const from = at;
        open();
        for (const c of arcToCubics(from, seg)) {
          if (c.cmd === "C") curve(c.c1, c.c2, c.to);
          else if (c.cmd === "L") {
            cur!.anchors.push({ x: c.to.x, y: c.to.y });
            at = c.to;
          }
        }
        break;
      }
      case "Z": {
        if (!cur || cur.closed) break;
        const s: Subpath = cur;
        // Um último ponto igual ao primeiro (fechamento explícito) vira a mesma âncora.
        const first = s.anchors[0]!;
        const last = s.anchors[s.anchors.length - 1]!;
        if (s.anchors.length > 1 && same(pt(first), pt(last))) {
          if (last.in) first.in = last.in;
          s.anchors.pop();
        }
        s.closed = true;
        at = start;
        break;
      }
    }
  }
  return subs;
}

/** Subcaminhos de volta a segmentos: reta sem alças, cúbica com alguma alça. */
export function subpathsToPath(subs: Subpath[]): Segment[] {
  const segs: Segment[] = [];
  const link = (a: Anchor, b: Anchor) => {
    if (a.out || b.in) segs.push({ cmd: "C", c1: a.out ?? pt(a), c2: b.in ?? pt(b), to: pt(b) });
    else segs.push({ cmd: "L", to: pt(b) });
  };
  for (const s of subs) {
    if (!s.anchors.length) continue;
    segs.push({ cmd: "M", to: pt(s.anchors[0]!) });
    for (let k = 1; k < s.anchors.length; k++) link(s.anchors[k - 1]!, s.anchors[k]!);
    if (s.closed && s.anchors.length > 1) {
      const first = s.anchors[0]!;
      const last = s.anchors[s.anchors.length - 1]!;
      if (last.out || first.in) link(last, first);
      segs.push({ cmd: "Z" });
    }
  }
  return segs;
}

const clone = (subs: Subpath[]): Subpath[] =>
  subs.map((s) => ({
    closed: s.closed,
    anchors: s.anchors.map((a) => ({ ...a, ...(a.in && { in: { ...a.in } }), ...(a.out && { out: { ...a.out } }) })),
  }));

/**
 * The subpath of `ref`, only for non-negative integer positions. Reads go through `Array.at`, never
 * `obj[key]`, so a caller's "__proto__" (or any non-index key) cannot reach Object.prototype.
 */
function subOf(subs: Subpath[], ref: AnchorRef): Subpath | undefined {
  return Number.isInteger(ref.sub) && Number.isInteger(ref.index) && ref.sub >= 0 && ref.index >= 0 ? subs.at(ref.sub) : undefined;
}

/** Move uma âncora e as alças dela juntas. */
export function moveAnchor(subs: Subpath[], ref: AnchorRef, to: Point): Subpath[] {
  const out = clone(subs);
  const a = subOf(out, ref)?.anchors.at(ref.index);
  if (!a) return out;
  const dx = to.x - a.x;
  const dy = to.y - a.y;
  a.x = to.x;
  a.y = to.y;
  if (a.in) a.in = { x: a.in.x + dx, y: a.in.y + dy };
  if (a.out) a.out = { x: a.out.x + dx, y: a.out.y + dy };
  return out;
}

/**
 * Move uma alça. Com `mirror`, a alça oposta acompanha em direção contrária, mantendo o próprio
 * comprimento (ponto suave); sem, as duas ficam independentes (canto).
 */
export function moveHandle(subs: Subpath[], ref: AnchorRef, side: "in" | "out", to: Point, mirror = false): Subpath[] {
  const out = clone(subs);
  const a = subOf(out, ref)?.anchors.at(ref.index);
  if (!a || (side !== "in" && side !== "out")) return out;
  // Named fields, not a[side]: no key computed from the caller is ever written.
  const moved = { x: to.x, y: to.y };
  if (side === "in") a.in = moved;
  else a.out = moved;
  const o = side === "in" ? a.out : a.in;
  if (mirror && o) {
    const len = Math.hypot(o.x - a.x, o.y - a.y);
    const dx = a.x - to.x;
    const dy = a.y - to.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-9) {
      const mirrored = { x: a.x + (dx / d) * len, y: a.y + (dy / d) * len };
      if (side === "in") a.out = mirrored;
      else a.in = mirrored;
    }
  }
  return out;
}

/** Remove uma âncora; um subcaminho sem âncoras some. */
export function removeAnchor(subs: Subpath[], ref: AnchorRef): Subpath[] {
  const out = clone(subs);
  const s = subOf(out, ref);
  if (!s?.anchors.at(ref.index)) return out;
  s.anchors.splice(ref.index, 1);
  if (s.anchors.length < 2) s.closed = false;
  return out.filter((x) => x.anchors.length > 0);
}

/**
 * Alterna canto e suave: com alças, tira as duas; sem, cria alças simétricas na direção
 * vizinho anterior → próximo, com um terço da distância até cada vizinho.
 */
export function toggleSmooth(subs: Subpath[], ref: AnchorRef): Subpath[] {
  const out = clone(subs);
  const s = subOf(out, ref);
  const a = s?.anchors.at(ref.index);
  if (!s || !a) return out;
  if (a.in || a.out) {
    delete a.in;
    delete a.out;
    return out;
  }
  const n = s.anchors.length;
  const wrap = (k: number) => (s.closed ? s.anchors[(k + n) % n] : s.anchors[k]);
  const prev = wrap(ref.index - 1) ?? a;
  const next = wrap(ref.index + 1) ?? a;
  let tx = next.x - prev.x;
  let ty = next.y - prev.y;
  const tl = Math.hypot(tx, ty);
  if (tl < 1e-9) return out;
  tx /= tl;
  ty /= tl;
  const lin = Math.hypot(a.x - prev.x, a.y - prev.y) / 3;
  const lout = Math.hypot(next.x - a.x, next.y - a.y) / 3;
  if (lin > 0) a.in = { x: a.x - tx * lin, y: a.y - ty * lin };
  if (lout > 0) a.out = { x: a.x + tx * lout, y: a.y + ty * lout };
  return out;
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Os quatro pontos de controle do trecho que sai da âncora `index` (o último fecha, se fechado). */
function segmentPoints(s: Subpath, index: number): [Point, Point, Point, Point] | null {
  const a = s.anchors[index];
  const b = index + 1 < s.anchors.length ? s.anchors[index + 1] : s.closed && s.anchors.length > 1 ? s.anchors[0] : undefined;
  if (!a || !b) return null;
  // Reta: controles a 1/3 e 2/3, para t andar uniforme ao longo dela.
  if (!a.out && !b.in) return [pt(a), lerp(pt(a), pt(b), 1 / 3), lerp(pt(a), pt(b), 2 / 3), pt(b)];
  return [pt(a), a.out ?? pt(a), b.in ?? pt(b), pt(b)];
}

function bezier([p0, p1, p2, p3]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Ponto do caminho mais perto de `p`: trecho (âncora de saída), parâmetro t e distância. */
export function nearestOnPath(subs: Subpath[], p: Point): { ref: AnchorRef; t: number; point: Point; distance: number } | null {
  let best: { ref: AnchorRef; t: number; point: Point; distance: number } | null = null;
  subs.forEach((s, si) => {
    for (let k = 0; k < s.anchors.length; k++) {
      const seg = segmentPoints(s, k);
      if (!seg) continue;
      // Amostra grossa e depois refina em volta do melhor t.
      let bt = 0;
      let bd = Infinity;
      const steps = 32;
      for (let j = 0; j <= steps; j++) {
        const q = bezier(seg, j / steps);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) [bd, bt] = [d, j / steps];
      }
      let h = 1 / steps;
      for (let it = 0; it < 20; it++) {
        h /= 2;
        for (const t of [bt - h, bt + h]) {
          if (t < 0 || t > 1) continue;
          const q = bezier(seg, t);
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bd) [bd, bt] = [d, t];
        }
      }
      if (!best || bd < best.distance) best = { ref: { sub: si, index: k }, t: bt, point: bezier(seg, bt), distance: bd };
    }
  });
  return best;
}

/**
 * Insere uma âncora no trecho que sai de `ref`, no parâmetro t (de Casteljau): a forma não muda.
 * Devolve os subcaminhos e a posição da âncora nova.
 */
export function insertAnchor(subs: Subpath[], ref: AnchorRef, t: number): { subs: Subpath[]; ref: AnchorRef } {
  const out = clone(subs);
  const s = subOf(out, ref);
  const seg = s && segmentPoints(s, ref.index);
  if (!s || !seg) return { subs: out, ref };
  const a = s.anchors.at(ref.index)!;
  const b = s.anchors.at((ref.index + 1) % s.anchors.length)!;
  const [p0, p1, p2, p3] = seg;
  const at = bezier(seg, t);
  const fresh: Anchor = { x: at.x, y: at.y };
  if (a.out || b.in) {
    const p01 = lerp(p0, p1, t);
    const p12 = lerp(p1, p2, t);
    const p23 = lerp(p2, p3, t);
    const l = lerp(p01, p12, t);
    const r = lerp(p12, p23, t);
    if (same(p01, p0)) delete a.out;
    else a.out = p01;
    if (same(p23, p3)) delete b.in;
    else b.in = p23;
    fresh.in = l;
    fresh.out = r;
  }
  s.anchors.splice(ref.index + 1, 0, fresh);
  return { subs: out, ref: { sub: ref.sub, index: ref.index + 1 } };
}

/** O que gravar num nó `path` editado (`update`): o desenho e a caixa nova. */
export interface PathEditProps {
  d: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * `d` e caixa de um nó `path` depois da edição. Sem `viewBox`, o desenho volta a começar na
 * origem do nó e a caixa acompanha (x/y só mudam quando o nó tem posição absoluta, `moveBox`);
 * com `viewBox`, as coordenadas estão nesse espaço e só `d` muda. `null` se não sobrou ponto.
 */
export function pathEditProps(
  node: { x: number; y: number; viewBox?: readonly [number, number, number, number] | undefined },
  subs: Subpath[],
  moveBox: boolean,
): PathEditProps | null {
  const segs = subpathsToPath(subs);
  if (!segs.length) return null;
  if (node.viewBox) return { d: serializePath(segs) };
  const b = pathBounds(segs);
  const dx = Math.floor(b.x);
  const dy = Math.floor(b.y);
  const out: PathEditProps = {
    d: serializePath(translatePath(segs, -dx, -dy)),
    width: Math.max(1, Math.ceil(b.x + b.width) - dx),
    height: Math.max(1, Math.ceil(b.y + b.height) - dy),
  };
  if (moveBox) {
    out.x = node.x + dx;
    out.y = node.y + dy;
  }
  return out;
}
