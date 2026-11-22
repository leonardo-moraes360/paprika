import { round4 } from "./num.js";
import type { ConnectorEnd, ConnectorNode, Document, Node, ShapeKind, ShapeNode } from "./schema.js";

/**
 * Diagramas: contorno das formas (`shape`) e roteamento dos conectores (`connector`).
 *
 * A geometria de um conector (x, y, width, height, d) é derivada de `from`/`to` ao fim de cada
 * transação (`routeConnectors`, chamado por `applyOps`), então mover uma forma redesenha as setas
 * presas a ela sem op extra, e o desfazer não precisa registrar a geometria. Só usa + − × ÷ e raiz
 * quadrada (sem trigonometria), e arredonda com `round4`: o resultado é idêntico no port Go.
 */

export interface Pt {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Side = "top" | "right" | "bottom" | "left";

/** Erro de conector, sem índice de op (quem chama adiciona). */
export class ConnectorError extends Error {}

const num = (v: number) => String(round4(v));
const pt = (p: Pt) => `${num(p.x)} ${num(p.y)}`;

/** Cor da dobra da nota adesiva (escurece o fill, qualquer que seja). */
export const NOTE_FOLD_FILL = "rgba(0,0,0,0.12)";

/** Padrões de uma forma nova sem fill/stroke, por tipo (aplicados no create). */
export function shapeDefaults(kind: ShapeKind): Record<string, unknown> {
  if (kind === "note")
    return { fill: "#ffe8a3", shadow: { x: 0, y: 2, blur: 6, spread: 0, color: "rgba(30,35,54,0.18)" }, textAlign: "left", width: 160, height: 160 };
  return { fill: "#ffffff", stroke: { color: "#1e2336", width: 2 }, ...(kind === "rect" ? { radius: 8 } : {}) };
}

/** Lado da dobra da nota (px), limitado ao tamanho. */
function foldSize(w: number, h: number): number {
  return Math.min(24, w / 4, h / 4);
}

/** Contorno de uma forma em coordenadas locais, recuado meia espessura do traço (o traço fica dentro da caixa). */
export function shapeOutline(n: Pick<ShapeNode, "shape" | "width" | "height" | "radius" | "stroke">): { d: string; fold?: string } {
  const w = n.width;
  const h = n.height;
  const sw = n.stroke && n.stroke.width > 0 ? n.stroke.width : 0;
  const i = Math.min(sw / 2, w / 2, h / 2);
  switch (n.shape) {
    case "ellipse": {
      const rx = Math.max(0, w / 2 - i);
      const ry = Math.max(0, h / 2 - i);
      return { d: `M${pt({ x: i, y: h / 2 })} A${num(rx)} ${num(ry)} 0 1 0 ${pt({ x: w - i, y: h / 2 })} A${num(rx)} ${num(ry)} 0 1 0 ${pt({ x: i, y: h / 2 })} Z` };
    }
    case "diamond":
      return { d: `M${pt({ x: w / 2, y: i })} L${pt({ x: w - i, y: h / 2 })} L${pt({ x: w / 2, y: h - i })} L${pt({ x: i, y: h / 2 })} Z` };
    case "triangle":
      return { d: `M${pt({ x: w / 2, y: i })} L${pt({ x: w - i, y: h - i })} L${pt({ x: i, y: h - i })} Z` };
    case "note": {
      const f = foldSize(w, h);
      return {
        d: `M${pt({ x: i, y: i })} L${pt({ x: w - i - f, y: i })} L${pt({ x: w - i, y: i + f })} L${pt({ x: w - i, y: h - i })} L${pt({ x: i, y: h - i })} Z`,
        fold: `M${pt({ x: w - i - f, y: i })} L${pt({ x: w - i - f, y: i + f })} L${pt({ x: w - i, y: i + f })} Z`,
      };
    }
    default: {
      const r = Math.max(0, Math.min(n.radius, w / 2, h / 2) - i);
      const [x0, y0, x1, y1] = [i, i, w - i, h - i];
      if (!r) return { d: `M${pt({ x: x0, y: y0 })} L${pt({ x: x1, y: y0 })} L${pt({ x: x1, y: y1 })} L${pt({ x: x0, y: y1 })} Z` };
      const a = (p: Pt) => `A${num(r)} ${num(r)} 0 0 1 ${pt(p)}`;
      return {
        d: [
          `M${pt({ x: x0 + r, y: y0 })}`,
          `L${pt({ x: x1 - r, y: y0 })}`,
          a({ x: x1, y: y0 + r }),
          `L${pt({ x: x1, y: y1 - r })}`,
          a({ x: x1 - r, y: y1 }),
          `L${pt({ x: x0 + r, y: y1 })}`,
          a({ x: x0, y: y1 - r }),
          `L${pt({ x: x0, y: y0 + r })}`,
          a({ x: x0 + r, y: y0 }),
          "Z",
        ].join(" "),
      };
    }
  }
}

/** Recuo do texto dentro da forma: [vertical, horizontal] em px (losango e elipse guardam o miolo). */
export function shapePadding(n: Pick<ShapeNode, "shape" | "width" | "height">): [number, number] {
  if (n.shape === "diamond") return [Math.max(8, n.height / 4), Math.max(8, n.width / 4)];
  if (n.shape === "triangle") return [Math.max(8, n.height / 3), Math.max(8, n.width / 4)];
  if (n.shape === "ellipse") return [Math.max(8, n.height * 0.15), Math.max(8, n.width * 0.15)];
  return [12, 12];
}

// ---------------------------------------------------------------------------------------------
// Conectores

/** Origem, no canvas, do espaço de coordenadas de um contêiner (a soma de x/y dos ancestrais). */
export function originOf(doc: Document, parentId: string | null): Pt {
  let x = 0;
  let y = 0;
  for (let id = parentId, depth = 0; id && depth < 1000; depth++) {
    const n: Node | undefined = doc.nodes[id];
    if (!n || n.type === "page") break;
    x += n.x;
    y += n.y;
    id = n.parentId;
  }
  return { x, y };
}

/** Caixa de um nó no canvas (sem rotação; tamanhos hug/fill contam como 0). */
function canvasBox(doc: Document, n: Exclude<Node, { type: "page" }>): Box {
  const o = originOf(doc, n.parentId);
  return {
    x: o.x + n.x,
    y: o.y + n.y,
    w: typeof n.width === "number" ? n.width : 0,
    h: typeof n.height === "number" ? n.height : 0,
  };
}

interface End {
  /** Caixa do nó (ponta presa) ou null (ponta solta em `p`). */
  box: Box | null;
  outline: "rect" | "ellipse" | "diamond" | "triangle";
  side: Side | null;
  p: Pt;
}

function resolveEnd(doc: Document, c: ConnectorNode, key: "from" | "to", origin: Pt): End {
  const e: ConnectorEnd = c[key];
  if (e.nodeId !== undefined) {
    const n = doc.nodes[e.nodeId];
    if (!n) throw new ConnectorError(`connector "${c.id}": ${key}.nodeId "${e.nodeId}" does not exist`);
    if (n.id === c.id) throw new ConnectorError(`connector "${c.id}": ${key}.nodeId cannot be the connector itself`);
    if (n.type === "page" || n.type === "connector")
      throw new ConnectorError(`connector "${c.id}": ${key}.nodeId "${e.nodeId}" is a ${n.type}; attach to a shape or another node on the canvas`);
    const box = canvasBox(doc, n);
    const outline =
      n.type === "ellipse"
        ? "ellipse"
        : n.type === "shape" && (n.shape === "ellipse" || n.shape === "diamond" || n.shape === "triangle")
          ? n.shape
          : "rect";
    const side = e.side && e.side !== "auto" ? e.side : null;
    return { box, outline, side, p: { x: box.x + box.w / 2, y: box.y + box.h / 2 } };
  }
  if (e.x === undefined || e.y === undefined)
    throw new ConnectorError(`connector "${c.id}": ${key} needs a nodeId (attached end) or both x and y (free end)`);
  return { box: null, outline: "rect", side: null, p: { x: origin.x + e.x, y: origin.y + e.y } };
}

function sidePoint(b: Box, s: Side): Pt {
  switch (s) {
    case "top":
      return { x: b.x + b.w / 2, y: b.y };
    case "right":
      return { x: b.x + b.w, y: b.y + b.h / 2 };
    case "bottom":
      return { x: b.x + b.w / 2, y: b.y + b.h };
    default:
      return { x: b.x, y: b.y + b.h / 2 };
  }
}

/** Ponto do contorno na direção de `toward`, saindo do centro da caixa. */
function clipToOutline(e: End, toward: Pt): Pt {
  const b = e.box!;
  const c = e.p;
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const hw = b.w / 2;
  const hh = b.h / 2;
  if ((dx === 0 && dy === 0) || hw === 0 || hh === 0) return c;
  let t: number;
  if (e.outline === "ellipse") t = 1 / Math.sqrt((dx / hw) * (dx / hw) + (dy / hh) * (dy / hh));
  else if (e.outline === "diamond") t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else if (e.outline === "triangle") t = clipRayToTriangle(hw, hh, dx, dy);
  else {
    const tx = dx === 0 ? Infinity : hw / Math.abs(dx);
    const ty = dy === 0 ? Infinity : hh / Math.abs(dy);
    t = Math.min(tx, ty);
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Interseção do raio do centro na direção (dx,dy) com o triângulo isósceles da caixa (topo / BL / BR). */
function clipRayToTriangle(hw: number, hh: number, dx: number, dy: number): number {
  const verts: Pt[] = [
    { x: 0, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const a = verts[k]!;
    const b = verts[(k + 1) % 3]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-12) continue;
    const t = (a.x * ey - a.y * ex) / det;
    const s = (a.x * dy - a.y * dx) / det;
    if (t > 1e-12 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best === Infinity ? 1 : best;
}

const DIR: Record<Side, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const horizontal = (s: Side) => s === "left" || s === "right";
/** Distância que a rota em cotovelo anda para fora da forma antes de virar. */
const ELBOW_STUB = 16;

/** Lado de saída automático: pelo eixo de maior distância entre os centros. */
function autoSide(from: Pt, to: Pt): Side {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function straightPoints(a: End, b: End): Pt[] {
  const refA = a.box && a.side ? sidePoint(a.box, a.side) : a.p;
  const refB = b.box && b.side ? sidePoint(b.box, b.side) : b.p;
  const start = !a.box ? a.p : a.side ? refA : clipToOutline(a, refB);
  const end = !b.box ? b.p : b.side ? refB : clipToOutline(b, refA);
  return [start, end];
}

function elbowPoints(a: End, b: End): Pt[] {
  const sa = a.side ?? autoSide(a.p, b.p);
  const sb = b.side ?? autoSide(b.p, a.p);
  const start = a.box ? sidePoint(a.box, sa) : a.p;
  const end = b.box ? sidePoint(b.box, sb) : b.p;
  const stubA = a.box ? ELBOW_STUB : 0;
  const stubB = b.box ? ELBOW_STUB : 0;
  const s1 = { x: start.x + DIR[sa].x * stubA, y: start.y + DIR[sa].y * stubA };
  const e1 = { x: end.x + DIR[sb].x * stubB, y: end.y + DIR[sb].y * stubB };
  let mid: Pt[];
  if (horizontal(sa) && horizontal(sb)) {
    const mx = (s1.x + e1.x) / 2;
    mid = [{ x: mx, y: s1.y }, { x: mx, y: e1.y }];
  } else if (!horizontal(sa) && !horizontal(sb)) {
    const my = (s1.y + e1.y) / 2;
    mid = [{ x: s1.x, y: my }, { x: e1.x, y: my }];
  } else if (horizontal(sa)) mid = [{ x: e1.x, y: s1.y }];
  else mid = [{ x: s1.x, y: e1.y }];
  return simplify([start, s1, ...mid, e1, end]);
}

/** Remove pontos repetidos e pontos do meio de trechos retos. */
function simplify(pts: Pt[]): Pt[] {
  const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
  const uniq: Pt[] = [];
  for (const p of pts) if (!uniq.length || !same(uniq[uniq.length - 1]!, p)) uniq.push(p);
  const out: Pt[] = [];
  for (let k = 0; k < uniq.length; k++) {
    const p = uniq[k]!;
    const prev = out[out.length - 1];
    const next = uniq[k + 1];
    if (prev && next) {
      const cross = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x);
      const dot = (p.x - prev.x) * (next.x - p.x) + (p.y - prev.y) * (next.y - p.y);
      if (Math.abs(cross) < 1e-6 && dot >= 0) continue;
    }
    out.push(p);
  }
  return out;
}

/** Pontas de seta abertas: [asa, ponta, asa], ou null quando o trecho final tem comprimento 0. */
function arrowHead(tip: Pt, from: Pt, sw: number): [Pt, Pt, Pt] | null {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return null;
  const ux = dx / len;
  const uy = dy / len;
  const size = 8 + 2 * sw;
  const half = size / 2;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  return [{ x: bx - uy * half, y: by + ux * half }, tip, { x: bx + uy * half, y: by - ux * half }];
}

/** Deslocamento perpendicular padrão da alça quando `control` não está gravado. */
const CURVE_OFFSET = 40;

/** Alça implícita: meio do segmento, 40px perpendiculares (só + − × ÷ e raiz). */
export function defaultCurveControl(start: Pt, end: Pt): Pt {
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return { x: mx, y: my - CURVE_OFFSET };
  return { x: mx - (dy / len) * CURVE_OFFSET, y: my + (dx / len) * CURVE_OFFSET };
}

/** Converte a alça quadrática P1 numa cúbica (c1, c2) equivalente. */
function quadraticToCubic(start: Pt, handle: Pt, end: Pt): { c1: Pt; c2: Pt } {
  return {
    c1: { x: start.x + (2 / 3) * (handle.x - start.x), y: start.y + (2 / 3) * (handle.y - start.y) },
    c2: { x: end.x + (2 / 3) * (handle.x - end.x), y: end.y + (2 / 3) * (handle.y - end.y) },
  };
}

/** Cotovelo com cantos em arco SVG; `samples` cobre a caixa (inclui aproximações dos arcos). */
function roundedElbowPath(pts: Pt[], radius: number): { dParts: string[]; samples: Pt[] } {
  if (pts.length < 2) return { dParts: [], samples: [] };
  if (pts.length < 3 || radius <= 0) {
    return { dParts: pts.map((p, k) => `${k ? "L" : "M"}${pt(p)}`), samples: pts };
  }
  const samples: Pt[] = [pts[0]!];
  const dParts: string[] = [`M${pt(pts[0]!)}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    const d0x = cur.x - prev.x;
    const d0y = cur.y - prev.y;
    const d1x = next.x - cur.x;
    const d1y = next.y - cur.y;
    const len0 = Math.sqrt(d0x * d0x + d0y * d0y);
    const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
    if (len0 < 1e-6 || len1 < 1e-6) continue;
    const r = Math.min(radius, len0 / 2, len1 / 2);
    if (r < 1e-6) {
      dParts.push(`L${pt(cur)}`);
      samples.push(cur);
      continue;
    }
    const ux0 = d0x / len0;
    const uy0 = d0y / len0;
    const ux1 = d1x / len1;
    const uy1 = d1y / len1;
    const pEnter = { x: cur.x - ux0 * r, y: cur.y - uy0 * r };
    const pLeave = { x: cur.x + ux1 * r, y: cur.y + uy1 * r };
    dParts.push(`L${pt(pEnter)}`);
    samples.push(pEnter);
    const cross = ux0 * uy1 - uy0 * ux1;
    const sweep = cross > 0 ? 1 : 0;
    dParts.push(`A${num(r)} ${num(r)} 0 0 ${sweep} ${pt(pLeave)}`);
    // Aproximação do meio do arco (bissetriz unitária) para a caixa.
    const bx = ux1 - ux0;
    const by = uy1 - uy0;
    const bl = Math.sqrt(bx * bx + by * by);
    if (bl > 1e-6) {
      const k = r * (Math.SQRT2 - 1);
      samples.push({ x: cur.x + (bx / bl) * k, y: cur.y + (by / bl) * k });
    }
    samples.push(pLeave);
  }
  const last = pts[pts.length - 1]!;
  dParts.push(`L${pt(last)}`);
  samples.push(last);
  return { dParts, samples };
}

/**
 * Posição da alça da curva no canvas (absoluta). Null se a rota não for `curve` ou as pontas
 * não resolvem. Usa `control` gravado ou o deslocamento padrão.
 */
export function connectorCurveHandle(doc: Document, c: ConnectorNode): Pt | null {
  if (c.route !== "curve") return null;
  const origin = originOf(doc, c.parentId);
  let a: End;
  let b: End;
  try {
    a = resolveEnd(doc, c, "from", origin);
    b = resolveEnd(doc, c, "to", origin);
  } catch {
    return null;
  }
  const [start, end] = straightPoints(a, b);
  if (c.control) return { x: origin.x + c.control.x, y: origin.y + c.control.y };
  return defaultCurveControl(start!, end!);
}

/** Calcula x, y, width, height e d de um conector. Muta o nó. */
export function routeConnector(doc: Document, c: ConnectorNode): void {
  const origin = originOf(doc, c.parentId);
  const a = resolveEnd(doc, c, "from", origin);
  const b = resolveEnd(doc, c, "to", origin);
  const sw = c.stroke.width;
  const heads: [Pt, Pt, Pt][] = [];
  let dBody: string;
  let bounds: Pt[];

  if (c.route === "curve") {
    const [start, end] = straightPoints(a, b);
    const handle = c.control
      ? { x: origin.x + c.control.x, y: origin.y + c.control.y }
      : defaultCurveControl(start!, end!);
    const { c1, c2 } = quadraticToCubic(start!, handle, end!);
    if (c.endArrow === "arrow") {
      const h = arrowHead(end!, c2, sw);
      if (h) heads.push(h);
    }
    if (c.startArrow === "arrow") {
      const h = arrowHead(start!, c1, sw);
      if (h) heads.push(h);
    }
    bounds = [start!, c1, c2, end!, handle, ...heads.flat()];
    const pad = Math.max(1, sw);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of bounds) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const ox = round4(minX - pad);
    const oy = round4(minY - pad);
    const local = (p: Pt): Pt => ({ x: p.x - ox, y: p.y - oy });
    dBody = `M${pt(local(start!))} C${pt(local(c1))} ${pt(local(c2))} ${pt(local(end!))}`;
    let d = dBody;
    for (const [w1, tip, w2] of heads) d += ` M${pt(local(w1))} L${pt(local(tip))} L${pt(local(w2))}`;
    c.x = round4(ox - origin.x);
    c.y = round4(oy - origin.y);
    c.width = round4(maxX - minX + 2 * pad);
    c.height = round4(maxY - minY + 2 * pad);
    c.d = d;
    return;
  }

  const line = c.route === "elbow" || c.route === "rounded" ? elbowPoints(a, b) : straightPoints(a, b);
  if (c.endArrow === "arrow" && line.length >= 2) {
    const h = arrowHead(line[line.length - 1]!, line[line.length - 2]!, sw);
    if (h) heads.push(h);
  }
  if (c.startArrow === "arrow" && line.length >= 2) {
    const h = arrowHead(line[0]!, line[1]!, sw);
    if (h) heads.push(h);
  }

  if (c.route === "rounded") {
    const { dParts, samples } = roundedElbowPath(line, c.radius);
    bounds = [...samples, ...heads.flat()];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of bounds) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const pad = Math.max(1, sw);
    const ox = round4(minX - pad);
    const oy = round4(minY - pad);
    const local = (p: Pt): Pt => ({ x: p.x - ox, y: p.y - oy });
    // Reconstrói o path em coords locais a partir dos pontos de canvas.
    const localLine = line.map(local);
    const localRounded = roundedElbowPath(localLine, c.radius);
    dBody = localRounded.dParts.join(" ");
    let d = dBody;
    for (const [w1, tip, w2] of heads) d += ` M${pt(local(w1))} L${pt(local(tip))} L${pt(local(w2))}`;
    c.x = round4(ox - origin.x);
    c.y = round4(oy - origin.y);
    c.width = round4(maxX - minX + 2 * pad);
    c.height = round4(maxY - minY + 2 * pad);
    c.d = d;
    return;
  }

  bounds = [...line, ...heads.flat()];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of bounds) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  // Margem de uma espessura: o traço e as pontas não encostam na borda da caixa.
  const pad = Math.max(1, sw);
  const ox = round4(minX - pad);
  const oy = round4(minY - pad);
  const local = (p: Pt): Pt => ({ x: p.x - ox, y: p.y - oy });
  let d = line.map((p, k) => `${k ? "L" : "M"}${pt(local(p))}`).join(" ");
  for (const [w1, tip, w2] of heads) d += ` M${pt(local(w1))} L${pt(local(tip))} L${pt(local(w2))}`;
  c.x = round4(ox - origin.x);
  c.y = round4(oy - origin.y);
  c.width = round4(maxX - minX + 2 * pad);
  c.height = round4(maxY - minY + 2 * pad);
  c.d = d;
}

/** Recalcula todos os conectores do documento. Muta `doc`; lança ConnectorError numa ponta inválida. */
export function routeConnectors(doc: Document): void {
  for (const n of Object.values(doc.nodes)) if (n.type === "connector") routeConnector(doc, n);
}

/** Conectores presos a algum dos ids (para apagar junto com a forma). */
export function connectorsAttachedTo(doc: Document, ids: ReadonlySet<string>): string[] {
  return Object.values(doc.nodes)
    .filter(
      (n): n is ConnectorNode =>
        n.type === "connector" &&
        !ids.has(n.id) &&
        ((n.from.nodeId !== undefined && ids.has(n.from.nodeId)) || (n.to.nodeId !== undefined && ids.has(n.to.nodeId))),
    )
    .map((n) => n.id);
}

// ---------------------------------------------------------------------------------------------
// draw_diagram: formas + conectores numa transação, com layout em camadas opcional

/** Uma forma do diagrama: `id` (usado pelas arestas) e qualquer campo de `shape`. */
export type DiagramNode = { id: string; x?: number; y?: number; width?: number; height?: number; shape?: string } & Record<string, unknown>;

/** Uma aresta: `from`/`to` são ids de formas do diagrama ou de nós que já existem. */
export interface DiagramEdge {
  from: string;
  to: string;
  id?: string;
  fromSide?: string;
  toSide?: string;
  route?: string;
  radius?: number;
  control?: { x: number; y: number };
  startArrow?: string;
  endArrow?: string;
  dashed?: boolean;
  stroke?: unknown;
  name?: string;
  label?: string;
}

export interface DiagramInput {
  /** Contêiner das formas (frame ou página). Ausente/null: a primeira página, ou o canvas sem páginas. */
  parentId?: string | null;
  /** Direção do layout automático: camadas de cima para baixo (`down`) ou da esquerda para a direita (`right`). */
  direction?: "down" | "right";
  /** Espaço entre formas no layout automático (px). */
  gap?: number;
  /** Canto do layout automático no espaço do pai. Ausente: à direita do que já existe no pai. */
  x?: number;
  y?: number;
  nodes: DiagramNode[];
  edges?: DiagramEdge[];
}

export interface DiagramPlan {
  ops: { op: "create"; parentId: string | null; node: Record<string, unknown> & { type: "shape" | "connector" } }[];
  nodes: string[];
  edges: string[];
}

const DEFAULT_SIZE: Record<string, [number, number]> = { note: [160, 160] };
const sizeOf = (n: DiagramNode): [number, number] => {
  const [dw, dh] = DEFAULT_SIZE[typeof n.shape === "string" ? n.shape : "rect"] ?? [160, 80];
  return [typeof n.width === "number" ? n.width : dw, typeof n.height === "number" ? n.height : dh];
};

/**
 * Planeja um diagrama: cria as formas (as que não têm x e y vão para um layout em camadas, na
 * ordem das arestas) e um conector por aresta. As arestas usam rota em cotovelo por padrão.
 */
export function diagramOps(doc: Document, input: DiagramInput): DiagramPlan {
  if (!input.nodes.length && !(input.edges ?? []).length) throw new Error("pass at least one node or edge");
  const first = doc.rootIds.length && doc.nodes[doc.rootIds[0]!]?.type === "page" ? doc.rootIds[0]! : null;
  const parentId = input.parentId ?? first;
  if (parentId !== null) {
    const p = doc.nodes[parentId];
    if (!p) throw new Error(`parent "${parentId}" does not exist`);
    if (p.type !== "frame" && p.type !== "page" && p.type !== "group")
      throw new Error(`parent "${parentId}" is ${p.type}; only frame, group and page have children`);
  }
  const ids = new Set<string>();
  for (const n of input.nodes) {
    if (typeof n.id !== "string" || !n.id) throw new Error("every diagram node needs an id (edges refer to it)");
    if (ids.has(n.id)) throw new Error(`diagram node id "${n.id}" is repeated`);
    if (doc.nodes[n.id]) throw new Error(`id "${n.id}" already exists; pick another id or refer to the existing node only in edges`);
    ids.add(n.id);
  }
  const edges = input.edges ?? [];
  for (const [k, e] of edges.entries())
    for (const end of [e.from, e.to])
      if (!ids.has(end) && !doc.nodes[end]) throw new Error(`edges[${k}]: "${end}" is neither a diagram node nor an existing node`);

  // Camadas: caminho mais longo a partir das fontes, só entre formas novas. Arestas que fecham um
  // ciclo (achadas por busca em profundidade, na ordem da entrada) não contam.
  const auto = input.nodes.filter((n) => typeof n.x !== "number" || typeof n.y !== "number");
  const rank = new Map(auto.map((n) => [n.id, 0]));
  const out = new Map<string, number[]>(auto.map((n) => [n.id, []]));
  edges.forEach((e, k) => {
    if (rank.has(e.from) && rank.has(e.to) && e.from !== e.to) out.get(e.from)!.push(k);
  });
  const state = new Map<string, number>();
  const forward: DiagramEdge[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const k of out.get(id)!) {
      const to = edges[k]!.to;
      const st = state.get(to) ?? 0;
      if (st === 1) continue; // fecha um ciclo
      forward.push(edges[k]!);
      if (st === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const n of auto) if (!state.has(n.id)) visit(n.id);
  for (let pass = 0, changed = true; changed && pass <= auto.length; pass++) {
    changed = false;
    for (const e of forward) {
      const next = rank.get(e.from)! + 1;
      if (rank.get(e.to)! < next) {
        rank.set(e.to, next);
        changed = true;
      }
    }
  }
  const layers: DiagramNode[][] = [];
  for (const n of auto) (layers[rank.get(n.id)!] ??= []).push(n);
  const rows = layers.filter((l) => l && l.length);
  let cellW = 0;
  let cellH = 0;
  for (const n of auto) {
    const [w, h] = sizeOf(n);
    cellW = Math.max(cellW, w);
    cellH = Math.max(cellH, h);
  }
  const gap = input.gap ?? 64;
  const down = (input.direction ?? "down") === "down";
  let ox = input.x;
  let oy = input.y;
  if (ox === undefined || oy === undefined) {
    // À direita do conteúdo do pai, alinhado ao topo; sem conteúdo, no canto.
    const siblings = parentId === null ? doc.rootIds : ((doc.nodes[parentId] as { children?: string[] }).children ?? []);
    let right = -Infinity;
    let top = Infinity;
    for (const id of siblings) {
      const s = doc.nodes[id];
      if (!s || s.type === "page") continue;
      right = Math.max(right, s.x + (typeof s.width === "number" ? s.width : 0));
      top = Math.min(top, s.y);
    }
    const empty = right === -Infinity;
    const inset = parentId !== null && doc.nodes[parentId]?.type === "frame" ? 24 : 0;
    ox ??= empty ? inset : Math.round(right + 80);
    oy ??= empty ? inset : Math.round(top);
  }
  const widest = Math.max(0, ...rows.map((l) => l.length));
  const pos = new Map<string, Pt>();
  rows.forEach((layer, r) => {
    layer.forEach((n, k) => {
      const [w, h] = sizeOf(n);
      const along = ((widest - layer.length) / 2 + k) * ((down ? cellW : cellH) + gap);
      const across = r * ((down ? cellH : cellW) + gap);
      const x = down ? along + (cellW - w) / 2 : across + (cellW - w) / 2;
      const y = down ? across + (cellH - h) / 2 : along + (cellH - h) / 2;
      pos.set(n.id, { x: Math.round(ox! + x), y: Math.round(oy! + y) });
    });
  });

  const plan: DiagramPlan = { ops: [], nodes: [], edges: [] };
  for (const n of input.nodes) {
    const p = pos.get(n.id);
    const node: Record<string, unknown> & { type: "shape" } = { ...n, type: "shape" };
    if (p) {
      node.x = p.x;
      node.y = p.y;
    }
    plan.ops.push({ op: "create", parentId, node });
    plan.nodes.push(n.id);
  }
  const used = new Set(ids);
  for (const e of edges) {
    const base = e.id ?? `${e.from}-to-${e.to}`;
    let id = base;
    if (e.id === undefined) for (let k = 2; used.has(id) || doc.nodes[id]; k++) id = `${base}-${k}`;
    used.add(id);
    const end = (nodeId: string, side: string | undefined) => (side === undefined ? { nodeId } : { nodeId, side });
    const node: Record<string, unknown> & { type: "connector" } = {
      type: "connector",
      id,
      from: end(e.from, e.fromSide),
      to: end(e.to, e.toSide),
      route: e.route ?? "elbow",
    };
    for (const k of ["name", "startArrow", "endArrow", "dashed", "stroke", "label", "radius", "control"] as const)
      if (e[k] !== undefined) node[k] = e[k];
    plan.ops.push({ op: "create", parentId, node });
    plan.edges.push(id);
  }
  return plan;
}
