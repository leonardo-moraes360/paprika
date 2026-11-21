/**
 * Dados de caminho SVG (`d`) para o nó `path`: parser estrito, normalização para comandos
 * absolutos (M, L, C, Q, A, Z), caixa delimitadora exata (incluindo extremos de curvas bezier
 * e arcos) e serialização. Não depende do DOM, então roda no servidor, no canvas e nos testes.
 */

export type Point = { x: number; y: number };

export type Segment =
  | { cmd: "M"; to: Point }
  | { cmd: "L"; to: Point }
  | { cmd: "C"; c1: Point; c2: Point; to: Point }
  | { cmd: "Q"; c: Point; to: Point }
  | { cmd: "A"; rx: number; ry: number; rotation: number; largeArc: boolean; sweep: boolean; to: Point }
  | { cmd: "Z" };

export class PathError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/** Limite de segmentos por caminho: protege o servidor e o canvas de entradas gigantes. */
export const MAX_SEGMENTS = 10_000;

/**
 * Converte `d` em segmentos absolutos. Erros apontam a posição do caractere, para o agente
 * corrigir sem adivinhar. Aceita a gramática SVG 1.1 completa (inclusive flags de arco coladas).
 */
export function parsePath(d: string): Segment[] {
  const segs: Segment[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i]!)) i++;
  };
  const num = (): number => {
    skip();
    const m = NUMBER.exec(d.slice(i));
    if (!m) throw new PathError(`número esperado na posição ${i}${i < d.length ? ` (encontrado "${d[i]}")` : " (fim do texto)"}`, i);
    i += m[0].length;
    const v = Number(m[0]);
    if (!Number.isFinite(v) || Math.abs(v) > 1e7) throw new PathError(`número fora do intervalo na posição ${i}`, i);
    return v;
  };
  const flag = (): boolean => {
    skip();
    const c = d[i];
    if (c !== "0" && c !== "1") throw new PathError(`flag de arco (0 ou 1) esperada na posição ${i}`, i);
    i++;
    return c === "1";
  };

  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastCubic: Point | null = null; // segundo controle do último C/S (para refletir em S)
  let lastQuad: Point | null = null; // controle do último Q/T (para refletir em T)
  let cmd = "";

  skip();
  if (i < d.length && !/[Mm]/.test(d[i]!)) throw new PathError(`o caminho deve começar com M (posição ${i})`, i);
  while (true) {
    skip();
    if (i >= d.length) break;
    const c = d[i]!;
    if (/[A-Za-z]/.test(c)) {
      if (ARITY[c.toUpperCase()] === undefined) throw new PathError(`comando desconhecido "${c}" na posição ${i}`, i);
      cmd = c;
      i++;
    } else if (!cmd) {
      throw new PathError(`comando esperado na posição ${i}`, i);
    } else if (cmd === "Z" || cmd === "z") {
      throw new PathError(`números após Z na posição ${i}`, i);
    }
    const abs = cmd === cmd.toUpperCase();
    const up = cmd.toUpperCase();
    const ox = abs ? 0 : cur.x;
    const oy = abs ? 0 : cur.y;
    const pt = (): Point => {
      const x = num();
      const y = num();
      return { x: x + ox, y: y + oy };
    };
    let seg: Segment;
    switch (up) {
      case "M": {
        const to = pt();
        seg = { cmd: "M", to };
        start = to;
        cmd = abs ? "L" : "l"; // pares extras após M são lineto implícitos
        break;
      }
      case "L":
        seg = { cmd: "L", to: pt() };
        break;
      case "H":
        seg = { cmd: "L", to: { x: num() + ox, y: cur.y } };
        break;
      case "V":
        seg = { cmd: "L", to: { x: cur.x, y: num() + oy } };
        break;
      case "C":
        seg = { cmd: "C", c1: pt(), c2: pt(), to: pt() };
        break;
      case "S": {
        const c1: Point = lastCubic ? { x: 2 * cur.x - lastCubic.x, y: 2 * cur.y - lastCubic.y } : { ...cur };
        seg = { cmd: "C", c1, c2: pt(), to: pt() };
        break;
      }
      case "Q":
        seg = { cmd: "Q", c: pt(), to: pt() };
        break;
      case "T": {
        const c: Point = lastQuad ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y } : { ...cur };
        seg = { cmd: "Q", c, to: pt() };
        break;
      }
      case "A": {
        const rx = Math.abs(num());
        const ry = Math.abs(num());
        const rotation = num();
        const largeArc = flag();
        const sweep = flag();
        seg = { cmd: "A", rx, ry, rotation, largeArc, sweep, to: pt() };
        break;
      }
      default:
        seg = { cmd: "Z" };
        break;
    }
    lastCubic = seg.cmd === "C" ? seg.c2 : null;
    lastQuad = seg.cmd === "Q" ? seg.c : null;
    if (seg.cmd === "Z") cur = start;
    else cur = seg.to;
    segs.push(seg);
    if (segs.length > MAX_SEGMENTS) throw new PathError(`caminho com mais de ${MAX_SEGMENTS} segmentos`, i);
  }
  if (segs.length === 0) throw new PathError("caminho vazio", 0);
  return segs;
}

/** Valida `d` e devolve a mensagem de erro (ou `null` se estiver ok). */
export function pathError(d: string): string | null {
  try {
    parsePath(d);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const r = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? "0" : String(v);
};
const p = (pt: Point) => `${r(pt.x)} ${r(pt.y)}`;

/** Serializa segmentos absolutos em `d` (2 casas decimais). */
export function serializePath(segs: Segment[]): string {
  return segs
    .map((s) => {
      switch (s.cmd) {
        case "M":
        case "L":
          return `${s.cmd}${p(s.to)}`;
        case "C":
          return `C${p(s.c1)} ${p(s.c2)} ${p(s.to)}`;
        case "Q":
          return `Q${p(s.c)} ${p(s.to)}`;
        case "A":
          return `A${r(s.rx)} ${r(s.ry)} ${r(s.rotation)} ${s.largeArc ? 1 : 0} ${s.sweep ? 1 : 0} ${p(s.to)}`;
        default:
          return "Z";
      }
    })
    .join(" ");
}

/** Desloca todos os pontos (útil para normalizar um caminho desenhado para a origem do nó). */
export function translatePath(segs: Segment[], dx: number, dy: number): Segment[] {
  const t = (pt: Point): Point => ({ x: pt.x + dx, y: pt.y + dy });
  return segs.map((s) => {
    switch (s.cmd) {
      case "M":
      case "L":
        return { ...s, to: t(s.to) };
      case "C":
        return { ...s, c1: t(s.c1), c2: t(s.c2), to: t(s.to) };
      case "Q":
        return { ...s, c: t(s.c), to: t(s.to) };
      case "A":
        return { ...s, to: t(s.to) };
      default:
        return s;
    }
  });
}

/** Raízes em [0,1] de a·t² + b·t + c = 0. */
function unitRoots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b].filter((t) => t > 0 && t < 1);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [(-b + s) / (2 * a), (-b - s) / (2 * a)].filter((t) => t > 0 && t < 1);
}

/** Pontos de um arco SVG convertidos para a forma central (SVG 1.1, apêndice F.6), amostrados nos extremos. */
function arcPoints(from: Point, s: Extract<Segment, { cmd: "A" }>): Point[] {
  let { rx, ry } = s;
  if (rx === 0 || ry === 0 || (from.x === s.to.x && from.y === s.to.y)) return [s.to];
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
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!s.sweep && dt > 0) dt -= 2 * Math.PI;
  if (s.sweep && dt < 0) dt += 2 * Math.PI;
  const at = (t: number): Point => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  });
  // Amostragem densa: simples e precisa o bastante (< 0,1px) para bounds.
  const n = Math.max(8, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * 16));
  return Array.from({ length: n + 1 }, (_, j) => at(t1 + (dt * j) / n));
}

export interface PathBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Caixa exata da geometria (não dos pontos de controle). */
export function pathBounds(segs: Segment[]): PathBounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const add = (pt: Point) => {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  };
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  for (const s of segs) {
    switch (s.cmd) {
      case "M":
        start = s.to;
        add(s.to);
        break;
      case "L":
        add(s.to);
        break;
      case "C": {
        add(s.to);
        for (const axis of ["x", "y"] as const) {
          const [p0, p1, p2, p3] = [cur[axis], s.c1[axis], s.c2[axis], s.to[axis]];
          const a = -p0 + 3 * p1 - 3 * p2 + p3;
          const b = 2 * (p0 - 2 * p1 + p2);
          const c = p1 - p0;
          for (const t of unitRoots(3 * a, 3 * b, 3 * c)) {
            const mt = 1 - t;
            add({
              x: mt ** 3 * cur.x + 3 * mt * mt * t * s.c1.x + 3 * mt * t * t * s.c2.x + t ** 3 * s.to.x,
              y: mt ** 3 * cur.y + 3 * mt * mt * t * s.c1.y + 3 * mt * t * t * s.c2.y + t ** 3 * s.to.y,
            });
          }
        }
        break;
      }
      case "Q": {
        add(s.to);
        for (const axis of ["x", "y"] as const) {
          const den = cur[axis] - 2 * s.c[axis] + s.to[axis];
          if (Math.abs(den) < 1e-12) continue;
          const t = (cur[axis] - s.c[axis]) / den;
          if (t <= 0 || t >= 1) continue;
          const mt = 1 - t;
          add({ x: mt * mt * cur.x + 2 * mt * t * s.c.x + t * t * s.to.x, y: mt * mt * cur.y + 2 * mt * t * s.c.y + t * t * s.to.y });
        }
        break;
      }
      case "A":
        arcPoints(cur, s).forEach(add);
        break;
      default:
        break;
    }
    cur = s.cmd === "Z" ? start : s.to;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Âncora editável de um caminho desenhado com a caneta: ponto + alças bezier opcionais. */
export interface Anchor {
  x: number;
  y: number;
  /** Alça que chega no ponto (controle do segmento anterior). */
  in?: Point;
  /** Alça que sai do ponto (controle do próximo segmento). */
  out?: Point;
}

/** Monta segmentos a partir de âncoras: reta quando não há alças, bezier cúbica quando há. */
export function anchorsToPath(anchors: Anchor[], closed: boolean): Segment[] {
  if (anchors.length === 0) return [];
  const segs: Segment[] = [{ cmd: "M", to: { x: anchors[0]!.x, y: anchors[0]!.y } }];
  const link = (a: Anchor, b: Anchor) => {
    if (a.out || b.in) segs.push({ cmd: "C", c1: a.out ?? { x: a.x, y: a.y }, c2: b.in ?? { x: b.x, y: b.y }, to: { x: b.x, y: b.y } });
    else segs.push({ cmd: "L", to: { x: b.x, y: b.y } });
  };
  for (let k = 1; k < anchors.length; k++) link(anchors[k - 1]!, anchors[k]!);
  if (closed && anchors.length > 2) {
    link(anchors[anchors.length - 1]!, anchors[0]!);
    segs.push({ cmd: "Z" });
  }
  return segs;
}
