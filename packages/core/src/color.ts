import type { RGBA } from "./lint.js";

export interface Oklch {
  l: number;
  c: number;
  h: number;
  a: number;
}

const P3_TO_SRGB = [
  [1.22474525619, -0.224904359131, 0],
  [-0.0420579219923, 1.04208100715, 0],
  [-0.0196422795874, -0.0786549166058, 1.09853719388],
] as const;

const SRGB_TO_P3 = [
  [0.82259273464, 0.177533953915, 0],
  [0.0331996005222, 0.966783523424, 0],
  [0.0170853488705, 0.0723957406011, 0.91030147619],
] as const;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function snap(n: number, digits: number) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function cube(x: number) {
  return x * x * x;
}

function linSrgb(c: number) {
  const abs = Math.abs(c);
  if (abs <= 0.04045) return c / 12.92;
  return Math.sign(c) * ((abs + 0.055) / 1.055) ** 2.4;
}

function gamSrgb(c: number) {
  const abs = Math.abs(c);
  if (abs > 0.0031308) return Math.sign(c) * (1.055 * abs ** (1 / 2.4) - 0.055);
  return 12.92 * c;
}

function matVec(m: readonly (readonly number[])[], v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]![0]! * v[0] + m[0]![1]! * v[1] + m[0]![2]! * v[2],
    m[1]![0]! * v[0] + m[1]![1]! * v[1] + m[1]![2]! * v[2],
    m[2]![0]! * v[0] + m[2]![1]! * v[1] + m[2]![2]! * v[2],
  ];
}

function rgb8(r: number, g: number, b: number, a: number): RGBA {
  const ch = (c: number) => snap(clamp(gamSrgb(c), 0, 1) * 255, 0);
  return { r: ch(r), g: ch(g), b: ch(b), a: snap(clamp(a, 0, 1), 4) };
}

function linOf(c: RGBA): [number, number, number] {
  return [linSrgb(c.r / 255), linSrgb(c.g / 255), linSrgb(c.b / 255)];
}

export function oklchToRgb(l: number, c: number, h: number): { r: number; g: number; b: number } {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const ll = cube(l_);
  const mm = cube(m_);
  const ss = cube(s_);
  const lin: [number, number, number] = [
    4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
    -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
    -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss,
  ];
  const out = rgb8(lin[0], lin[1], lin[2], 1);
  return { r: out.r, g: out.g, b: out.b };
}

export function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  const [R, G, B] = linOf({ r, g, b, a: 1 });
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let h = (Math.atan2(Bb, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: Math.hypot(A, Bb), h };
}

function splitDepth(s: string, sep: string): [string, string] | undefined {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return undefined;
}

function num(s: string): number | undefined {
  if (!/^-?\d*\.?\d+$/.test(s.trim())) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function component(s: string, scale: number): number | undefined {
  const t = s.trim();
  if (t === "none") return 0;
  if (t.endsWith("%")) {
    const n = num(t.slice(0, -1));
    return n === undefined ? undefined : (n / 100) * scale;
  }
  return num(t);
}

function alphaOf(s: string | undefined): number | undefined {
  if (s === undefined) return 1;
  const t = s.trim();
  if (t === "none") return 0;
  if (t.endsWith("%")) {
    const n = num(t.slice(0, -1));
    return n === undefined ? undefined : n / 100;
  }
  return num(t);
}

function angleOf(s: string): number | undefined {
  const t = s.trim();
  if (t === "none") return 0;
  const m = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(t);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  if (m[2] === "turn") return n * 360;
  if (m[2] === "rad") return (n * 180) / Math.PI;
  if (m[2] === "grad") return n * 0.9;
  return n;
}

export function readOklch(input: string): Oklch | undefined {
  const s = input.trim().toLowerCase();
  if (!s.startsWith("oklch(") || !s.endsWith(")")) return undefined;
  const body = s.slice(6, -1).trim();
  if (body.includes("from")) return undefined;
  const slash = splitDepth(body, "/");
  const coords = (slash ? slash[0] : body).trim();
  const parts = coords.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const l = component(parts[0]!, 1);
  const c = component(parts[1]!, 0.4);
  const h = angleOf(parts[2]!);
  const a = alphaOf(slash ? slash[1] : undefined);
  if (l === undefined || c === undefined || h === undefined || a === undefined) return undefined;
  return { l, c, h, a: snap(clamp(a, 0, 1), 4) };
}

function parseOklch(s: string): RGBA | undefined {
  const o = readOklch(s);
  if (!o) return undefined;
  const rgb = oklchToRgb(clamp(o.l, 0, 1), Math.max(0, o.c), o.h);
  return { ...rgb, a: o.a };
}

function parseColorFn(s: string): RGBA | undefined {
  const m = /^color\(\s*(display-p3|srgb)\s+([^)]*)\)$/.exec(s);
  if (!m) return undefined;
  const body = m[2]!.trim();
  const slash = splitDepth(body, "/");
  const parts = (slash ? slash[0] : body).trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const r = component(parts[0]!, 1);
  const g = component(parts[1]!, 1);
  const b = component(parts[2]!, 1);
  const a = alphaOf(slash ? slash[1] : undefined);
  if (r === undefined || g === undefined || b === undefined || a === undefined) return undefined;
  if (m[1] === "srgb") return rgb8(linSrgb(r), linSrgb(g), linSrgb(b), a);
  const lin = matVec(P3_TO_SRGB, [r, g, b].map((c) => linSrgb(c)) as [number, number, number]);
  return rgb8(lin[0], lin[1], lin[2], a);
}

function peelPercent(s: string): { color: string; pct?: number } {
  const t = s.trim();
  let depth = 0;
  let last = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (/\s/.test(c) && depth === 0) last = i;
  }
  if (last < 0) return { color: t };
  const tail = t.slice(last + 1).trim();
  if (/^\d*\.?\d+%$/.test(tail)) {
    const n = num(tail.slice(0, -1));
    if (n === undefined) return { color: t };
    return { color: t.slice(0, last).trim(), pct: n };
  }
  return { color: t };
}

function hueMix(h1: number, h2: number, t: number) {
  let d = h2 - h1;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  let h = h1 + d * t;
  h %= 360;
  if (h < 0) h += 360;
  return h;
}

function mixSrgb(a: RGBA, b: RGBA, t: number): RGBA {
  const wa = (1 - t) * a.a;
  const wb = t * b.a;
  const w = wa + wb;
  if (w === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: snap((a.r * wa + b.r * wb) / w, 0),
    g: snap((a.g * wa + b.g * wb) / w, 0),
    b: snap((a.b * wa + b.b * wb) / w, 0),
    a: snap(w, 4),
  };
}

function mixOklch(a: RGBA, b: RGBA, t: number): RGBA {
  const A = rgbToOklch(a.r, a.g, a.b);
  const B = rgbToOklch(b.r, b.g, b.b);
  const wa = (1 - t) * a.a;
  const wb = t * b.a;
  const w = wa + wb;
  if (w === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const l = (A.l * wa + B.l * wb) / w;
  const c = (A.c * wa + B.c * wb) / w;
  const rgb = oklchToRgb(clamp(l, 0, 1), Math.max(0, c), hueMix(A.h, B.h, wb / w));
  return { ...rgb, a: snap(w, 4) };
}

function mixP3(a: RGBA, b: RGBA, t: number): RGBA {
  const toP3 = (c: RGBA) => matVec(SRGB_TO_P3, linOf(c));
  const A = toP3(a);
  const B = toP3(b);
  const wa = (1 - t) * a.a;
  const wb = t * b.a;
  const w = wa + wb;
  if (w === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const p3: [number, number, number] = [0, 1, 2].map((i) => (A[i]! * wa + B[i]! * wb) / w) as [number, number, number];
  const lin = matVec(P3_TO_SRGB, p3);
  return rgb8(lin[0], lin[1], lin[2], w);
}

function parseColorMix(s: string, parse: (s: string) => RGBA | undefined): RGBA | undefined {
  const m = /^color-mix\(\s*in\s+([a-z0-9-]+)\s*,\s*([\s\S]*)\)$/.exec(s);
  if (!m) return undefined;
  const space = m[1]!;
  if (space !== "srgb" && space !== "oklch" && space !== "display-p3") return undefined;
  const cut = splitDepth(m[2]!, ",");
  if (!cut) return undefined;
  const left = peelPercent(cut[0]!);
  const right = peelPercent(cut[1]!);
  let p1 = left.pct;
  let p2 = right.pct;
  if (p1 === undefined && p2 === undefined) {
    p1 = 50;
    p2 = 50;
  } else if (p1 === undefined && p2 !== undefined) p1 = 100 - p2;
  else if (p2 === undefined && p1 !== undefined) p2 = 100 - p1;
  if (p1 === undefined || p2 === undefined) return undefined;
  const sum = p1 + p2;
  if (!(sum > 0)) return undefined;
  const t = p2 / sum;
  const a = parse(left.color);
  const b = parse(right.color);
  if (!a || !b) return undefined;
  if (space === "oklch") return mixOklch(a, b, t);
  if (space === "display-p3") return mixP3(a, b, t);
  return mixSrgb(a, b, t);
}

export function parseModernColor(input: string, parse: (s: string) => RGBA | undefined): RGBA | undefined {
  const s = input.trim().toLowerCase();
  if (s.startsWith("oklch(")) return parseOklch(s);
  if (s.startsWith("color(")) return parseColorFn(s);
  if (s.startsWith("color-mix(")) return parseColorMix(s, parse);
  return undefined;
}
