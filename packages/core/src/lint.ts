import type { Document, Node } from "./schema.js";
import { resolveValue } from "./style.js";

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, RGBA> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

/** Converte hex/rgb()/rgba()/nomes básicos. Retorna undefined para formatos não suportados (gradientes etc.). */
export function parseColor(input: string): RGBA | undefined {
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return undefined;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return { r: +rgb[1]!, g: +rgb[2]!, b: +rgb[3]!, a };
  }
  return undefined;
}

function blend(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

function luminance(c: RGBA): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** Razão de contraste WCAG 2.x entre duas cores opacas. */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Cor de fundo efetiva atrás de um nó: compõe os fills dos ancestrais sobre branco. */
export function effectiveBackground(doc: Document, node: Node): RGBA | undefined {
  const layers: RGBA[] = [];
  let cur: Node | undefined = node.type === "text" ? node : node.parentId ? doc.nodes[node.parentId] : undefined;
  while (cur) {
    if (cur.fill) {
      const c = parseColor(String(resolveValue(doc, cur.fill)));
      if (!c) return undefined;
      layers.push(c);
      if (c.a >= 1) break;
    }
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  let bg: RGBA = NAMED.white!;
  for (const layer of layers.reverse()) bg = blend(layer, bg);
  return bg;
}

export type Severity = "error" | "warning" | "info";

export interface LintIssue {
  rule: string;
  severity: Severity;
  nodeId: string;
  message: string;
}

function tokenRefs(node: Node): string[] {
  const refs: string[] = [];
  const check = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("$")) refs.push(v.slice(1));
  };
  check(node.fill);
  check(node.stroke?.color);
  check(node.shadow?.color);
  if (node.type === "text") {
    check(node.color);
    check(node.fontSize);
  }
  return refs;
}

/**
 * Regras de qualidade pensadas para agentes: cada problema vem com o id do nó e uma mensagem
 * acionável, para o agente corrigir com `update_nodes` sem precisar de screenshot.
 */
export function lintDocument(doc: Document, opts: { rootId?: string } = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const ids = opts.rootId ? collect(doc, opts.rootId) : Object.keys(doc.nodes);
  const hasColorTokens = Object.values(doc.tokens).some((v) => typeof v === "string" && !!parseColor(v));

  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    for (const ref of tokenRefs(node)) {
      if (doc.tokens[ref] === undefined)
        issues.push({ rule: "unknown-token", severity: "error", nodeId: id, message: `token "$${ref}" não existe` });
    }

    if (node.type === "text") {
      if (!node.text.trim())
        issues.push({ rule: "empty-text", severity: "warning", nodeId: id, message: "texto vazio" });
      const fs = resolveValue(doc, node.fontSize);
      const size = typeof fs === "number" ? fs : parseFloat(String(fs));
      if (size < 12)
        issues.push({ rule: "small-text", severity: "warning", nodeId: id, message: `fonte de ${size}px (< 12px)` });
      const fg = parseColor(String(resolveValue(doc, node.color)));
      const bg = effectiveBackground(doc, node);
      if (fg && bg) {
        const ratio = contrastRatio(blend(fg, bg), bg);
        const large = size >= 24 || (size >= 18.66 && node.fontWeight >= 700);
        const min = large ? 3 : 4.5;
        if (ratio < min)
          issues.push({
            rule: "contrast",
            severity: "error",
            nodeId: id,
            message: `contraste ${ratio.toFixed(2)}:1 abaixo de ${min}:1 (WCAG AA${large ? ", texto grande" : ""})`,
          });
      }
      if (hasColorTokens && !node.color.startsWith("$"))
        issues.push({ rule: "raw-color", severity: "info", nodeId: id, message: `cor literal "${node.color}"; prefira um token` });
    }

    if (node.type === "image" && !node.alt.trim())
      issues.push({ rule: "missing-alt", severity: "warning", nodeId: id, message: "imagem sem texto alternativo (alt)" });

    if (hasColorTokens && node.fill && !node.fill.startsWith("$") && node.fill !== "transparent")
      issues.push({ rule: "raw-color", severity: "info", nodeId: id, message: `fill literal "${node.fill}"; prefira um token` });

    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    const absolute = parent?.type === "frame" && (!parent.layout || parent.layout.mode === "none");
    if (
      absolute &&
      parent &&
      typeof parent.width === "number" &&
      typeof parent.height === "number" &&
      typeof node.width === "number" &&
      typeof node.height === "number" &&
      node.visible
    ) {
      const out = node.x < 0 || node.y < 0 || node.x + node.width > parent.width || node.y + node.height > parent.height;
      if (out)
        issues.push({
          rule: "overflow",
          severity: "warning",
          nodeId: id,
          message: `sai dos limites de "${parent.name || parent.id}" (${parent.width}×${parent.height})${
            parent.type === "frame" && parent.clip ? " e será cortado" : ""
          }`,
        });
    }

    if (node.type === "frame" && !node.name && !node.parentId)
      issues.push({ rule: "unnamed-frame", severity: "info", nodeId: id, message: "frame de nível superior sem nome" });
  }
  return issues;
}

function collect(doc: Document, rootId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    out.push(id);
    if (n.type === "frame") n.children.forEach(walk);
  };
  walk(rootId);
  return out;
}
