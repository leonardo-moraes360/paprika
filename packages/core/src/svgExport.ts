import { firstPage, pageRoots, isContainer, type Document, type Node } from "./schema.js";
import { canvasBounds, escapeHtml, svgAttrs } from "./render.js";
import {
  connectorAttrs,
  connectorLabelAttrs,
  modeOf,
  pathAttrs,
  resolveCorners,
  resolveLength,
  resolveValue,
  usedCornerRadii,
  uniformCorner,
  shapeAttrs,
  strokeDasharray,
  strokePositionOf,
  strokeStyleOf,
} from "./style.js";
import { shapePadding } from "./diagram.js";
import { layout } from "./layout.js";

/**
 * Exporta um nó, uma página ou o canvas como SVG vetorial. As caixas vêm de `layout(doc)`
 * (auto layout row/column, hug e fill sem navegador). `measure` opcional sobrescreve as caixas
 * e as linhas de texto (usado nos goldens e em caminhos legados). Sem `measure.lines`, o texto
 * quebra só em `\n` (a medição de glifos do navegador não entra no SVG).
 */

function len(doc: Document, n: Node, v: number | string | undefined): number {
  return resolveLength(doc, v, modeOf(doc, n)) ?? 0;
}

export interface Measure {
  /** Caixa de cada nó: [x, y, largura, altura], sem rotação, relativa à origem do export. */
  boxes: Record<string, [number, number, number, number]>;
  /** Linhas de cada texto, relativas à caixa do nó: texto, x e y da linha de base. */
  lines?: Record<string, { t: string; x: number; y: number }[]>;
}

/** Script legado para `page.evaluate` no HTML de `renderHTML`; devolve um `Measure`. */
export const MEASURE_SCRIPT = `(() => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const els = Array.from(document.querySelectorAll("[data-paprika-id]"));
  for (const el of els) el.style.transform = "none";
  const boxes = {};
  const lines = {};
  for (const el of els) {
    if (!el.getClientRects().length) continue;
    const id = el.getAttribute("data-paprika-id");
    const b = el.getBoundingClientRect();
    boxes[id] = [r2(b.left + scrollX), r2(b.top + scrollY), r2(b.width), r2(b.height)];
    const type = el.getAttribute("data-paprika-type");
    const host = type === "text" ? el : type === "shape" ? el.lastElementChild : null;
    if (!host) continue;
    const node = host.firstChild;
    if (!node || node.nodeType !== 3 || node.data.length > 5000) continue;
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    host.insertBefore(probe, node);
    const base = probe.getBoundingClientRect().bottom;
    host.removeChild(probe);
    const range = document.createRange();
    const out = [];
    let cur = null;
    for (let i = 0; i < node.data.length; i++) {
      const ch = node.data[i];
      if (ch === "\\n") { cur = null; continue; }
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rs = range.getClientRects();
      if (!rs.length) continue;
      const r = rs[rs.length - 1];
      if (!cur || Math.abs(r.top - cur.top) > 1) { cur = { t: "", x: r.left, top: r.top }; out.push(cur); }
      cur.t += ch;
    }
    if (!out.length) continue;
    const offset = base - out[0].top;
    lines[id] = out
      .map((l) => ({ t: l.t.replace(/ +$/, ""), x: r2(l.x - b.left), y: r2(l.top + offset - b.top) }))
      .filter((l) => l.t);
  }
  return { boxes, lines };
})()`;

/** Absolute layout boxes remapped so the export origin is (0, 0). */
export function measureFromLayout(doc: Document, rootId?: string): Measure {
  const laid = layout(doc, rootId ? { rootId } : {});
  const node = rootId ? doc.nodes[rootId] : undefined;
  if (rootId && !node) throw new Error(`node "${rootId}" does not exist`);
  const page = node ? (node.type === "page" ? node : undefined) : firstPage(doc);
  const single = node && node.type !== "page" ? node : undefined;
  let ox = 0;
  let oy = 0;
  if (single) {
    const b = laid[single.id];
    if (b) {
      ox = b.x;
      oy = b.y;
    }
  } else {
    const cb = canvasBounds(doc, page?.id);
    ox = cb.x;
    oy = cb.y;
  }
  const boxes: Record<string, [number, number, number, number]> = {};
  for (const [id, b] of Object.entries(laid)) {
    boxes[id] = [b.x - ox, b.y - oy, b.width, b.height];
  }
  return { boxes };
}

const f = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? "0" : String(v);
};

function roundedRectD(x: number, y: number, w: number, h: number, radii: [number, number, number, number]): string {
  const [tl, tr, br, bl] = radii;
  const parts = [`M${f(x + tl)} ${f(y)}`, `L${f(x + w - tr)} ${f(y)}`];
  if (tr) parts.push(`A${f(tr)} ${f(tr)} 0 0 1 ${f(x + w)} ${f(y + tr)}`);
  parts.push(`L${f(x + w)} ${f(y + h - br)}`);
  if (br) parts.push(`A${f(br)} ${f(br)} 0 0 1 ${f(x + w - br)} ${f(y + h)}`);
  parts.push(`L${f(x + bl)} ${f(y + h)}`);
  if (bl) parts.push(`A${f(bl)} ${f(bl)} 0 0 1 ${f(x)} ${f(y + h - bl)}`);
  parts.push(`L${f(x)} ${f(y + tl)}`);
  if (tl) parts.push(`A${f(tl)} ${f(tl)} 0 0 1 ${f(x + tl)} ${f(y)}`);
  parts.push("Z");
  return parts.join(" ");
}

type Box = [number, number, number, number];

function paint(doc: Document, v: string | undefined, mode: string | undefined, warn: (w: string) => void): string | undefined {
  if (v === undefined) return undefined;
  const s = String(resolveValue(doc, v, mode)).trim();
  if (/gradient\(/i.test(s) || /url\(/i.test(s)) {
    warn("gradients and background images do not go into SVG; the fill was left out");
    return undefined;
  }
  return s;
}

export function exportSVG(
  doc: Document,
  opts: { rootId?: string; measure?: Measure } = {},
): { svg: string; width: number; height: number; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  const node = opts.rootId ? doc.nodes[opts.rootId] : undefined;
  if (opts.rootId && !node) throw new Error(`node "${opts.rootId}" does not exist`);
  const page = node ? (node.type === "page" ? node : undefined) : firstPage(doc);
  const single = node && node.type !== "page" ? node : undefined;
  const roots = single ? [single.id] : pageRoots(doc, page?.id);
  const cb = single ? undefined : canvasBounds(doc, page?.id);
  const measure = opts.measure ?? measureFromLayout(doc, opts.rootId);
  const measured = measure.boxes;
  const boxes = new Map<string, Box>();

  const boxOf = (n: Node, _parent: Box, _inFlow: boolean, _root: boolean): Box | undefined => {
    if (n.type === "page") return undefined;
    return measured[n.id];
  };

  /** Forma de diagrama: contorno (e dobra), depois o texto em linhas (medidas ou quebradas em \n). */
  const shapeSVG = (n: Extract<Node, { type: "shape" }>, w: number, h: number): string => {
    const mode = modeOf(doc, n);
    const id = escapeHtml(n.id);
    const a = shapeAttrs(doc, n);
    let defs = "";
    let shadowAttr = "";
    if (n.shadow) {
      const s = n.shadow;
      if (len(doc, n, s.spread)) warn("shadow with spread: SVG uses only offset, blur and color");
      defs += `<filter id="shadow-${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${f(len(doc, n, s.x))}" dy="${f(len(doc, n, s.y))}" stdDeviation="${f(len(doc, n, s.blur) / 2)}" flood-color="${escapeHtml(String(resolveValue(doc, s.color, mode)))}"/></filter>`;
      shadowAttr = ` filter="url(#shadow-${id})"`;
    }
    const fill = a.path.fill === "none" ? "none" : (paint(doc, n.fill, mode, warn) ?? "none");
    let body = `<g${shadowAttr}><path${svgAttrs({ ...a.path, fill })}/>`;
    if (a.fold) body += `<path${svgAttrs(a.fold)}/>`;
    body += "</g>";
    const fs = resolveValue(doc, n.fontSize, mode);
    const size = typeof fs === "number" ? fs : Number.parseFloat(String(fs)) || 16;
    const measuredLines = measure.lines?.[n.id];
    let tspans = "";
    let anchor = "";
    if (measuredLines) tspans = measuredLines.map((l) => `<tspan x="${f(l.x)}" y="${f(l.y)}">${escapeHtml(l.t)}</tspan>`).join("");
    else if (n.text) {
      const [pv, ph] = shapePadding(n);
      const lh = len(doc, n, n.lineHeight) * size;
      const lines = n.text.split("\n");
      const top = n.shape === "note" ? pv : (h - lines.length * lh) / 2;
      const ax = n.textAlign === "center" ? w / 2 : n.textAlign === "right" ? w - ph : ph;
      if (n.textAlign !== "left") anchor = ` text-anchor="${n.textAlign === "center" ? "middle" : "end"}"`;
      tspans = lines.map((t, k) => (t ? `<tspan x="${f(ax)}" y="${f(top + k * lh + (lh - size) / 2 + size * 0.8)}">${escapeHtml(t)}</tspan>` : "")).join("");
    }
    if (tspans) {
      const color = escapeHtml(String(resolveValue(doc, n.color, mode)));
      body += `<text xml:space="preserve" font-family="${escapeHtml(n.fontFamily)}" font-size="${f(size)}" font-weight="${n.fontWeight}" fill="${color}"${anchor}>${tspans}</text>`;
    }
    return `${defs ? `<defs>${defs}</defs>` : ""}${body}`;
  };

  const emit = (n: Node, parent: Box, root: boolean): string => {
    if (n.type === "page") return "";
    const pn = n.parentId ? doc.nodes[n.parentId] : undefined;
    const inFlow = !root && pn?.type === "frame" && !!pn.layout && pn.layout.mode !== "none";
    const b = boxOf(n, parent, inFlow, root);
    if (!b || !n.visible) return "";
    boxes.set(n.id, b);
    const [x, y, w, h] = b;
    let tr = `translate(${f(x - parent[0])} ${f(y - parent[1])})`;
    const rotation = n.type === "group" || n.type === "connector" ? 0 : n.rotation;
    if (rotation) tr += ` rotate(${f(rotation)} ${f(w / 2)} ${f(h / 2)})`;
    const id = escapeHtml(n.id);
    let open = `<g data-paprika-id="${id}"${n.name ? ` data-name="${escapeHtml(n.name)}"` : ""} transform="${tr}"`;
    if (n.opacity !== 1) open += ` opacity="${f(n.opacity)}"`;
    open += ">";
    const kids = () => (isContainer(n) ? n.children.map((c) => doc.nodes[c]).filter((c): c is Node => !!c).map((c) => emit(c, b, false)).join("") : "");
    if (n.type === "group") return `${open}${kids()}</g>`;
    if (n.type === "connector") {
      const a = connectorAttrs(doc, n);
      const label = connectorLabelAttrs(doc, n);
      const text = label ? `<text${svgAttrs(label)}>${escapeHtml(n.label!)}</text>` : "";
      return `${open}<path${svgAttrs(a)}/>${text}</g>`;
    }
    if (n.type === "shape") return `${open}${shapeSVG(n, w, h)}</g>`;

    const mode = modeOf(doc, n);
    let defs = "";
    let shadowAttr = "";
    if (n.shadow && n.type !== "text") {
      const s = n.shadow;
      if (len(doc, n, s.spread)) warn("shadow with spread: SVG uses only offset, blur and color");
      defs += `<filter id="shadow-${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${f(len(doc, n, s.x))}" dy="${f(len(doc, n, s.y))}" stdDeviation="${f(len(doc, n, s.blur) / 2)}" flood-color="${escapeHtml(String(resolveValue(doc, s.color, mode)))}"/></filter>`;
      shadowAttr = ` filter="url(#shadow-${id})"`;
    }
    const fill = n.type === "path" ? undefined : paint(doc, n.fill, mode, warn);
    const sw = n.type !== "path" && n.stroke && len(doc, n, n.stroke.width) > 0 ? len(doc, n, n.stroke.width) : 0;
    const pos = sw && n.stroke ? strokePositionOf(n) : "inside";
    const style = sw && n.stroke ? strokeStyleOf(n.stroke) : "solid";
    const dash = sw && n.stroke ? strokeDasharray(sw, style) : undefined;
    const dashAttr = dash ? ` stroke-dasharray="${escapeHtml(dash)}"` : "";
    const strokeAttr = sw
      ? ` stroke="${escapeHtml(String(resolveValue(doc, n.stroke!.color, mode)))}" stroke-width="${f(sw)}"${dashAttr}`
      : "";
    const fillAttr = ` fill="${escapeHtml(fill ?? "none")}"`;
    // SVG stroke is centered: shift the path so the painted band matches CSS position.
    const insetBy = pos === "inside" ? sw / 2 : pos === "outside" ? -sw / 2 : 0;
    const inset = `x="${f(insetBy)}" y="${f(insetBy)}" width="${f(Math.max(0, w - insetBy * 2))}" height="${f(Math.max(0, h - insetBy * 2))}"`;
    const boxRadius =
      n.type === "ellipse" || n.type === "path" || !("radius" in n)
        ? undefined
        : usedCornerRadii(w, h, resolveCorners(doc, n.radius, mode));
    const even = !boxRadius || uniformCorner(boxRadius) !== undefined;
    const r = boxRadius && even ? boxRadius[0] : 0;
    const radius = r ? ` rx="${f(Math.max(0, r - insetBy))}"` : "";
    const clipRadius = r ? ` rx="${f(r)}"` : "";
    const cornerPath = () => {
      const insetR = boxRadius!.map((c) => Math.max(0, c - insetBy)) as [number, number, number, number];
      return roundedRectD(insetBy, insetBy, Math.max(0, w - insetBy * 2), Math.max(0, h - insetBy * 2), insetR);
    };
    const clipDef = (clipId: string) =>
      even
        ? `<clipPath id="${clipId}"><rect width="${f(w)}" height="${f(h)}"${clipRadius}/></clipPath>`
        : `<clipPath id="${clipId}"><path d="${roundedRectD(0, 0, w, h, boxRadius!)}"/></clipPath>`;
    let body = "";
    switch (n.type) {
      case "frame":
      case "rect":
      case "text":
      case "image": {
        if (!even && boxRadius) {
          if (fill || sw || shadowAttr) body += `<path d="${cornerPath()}"${fillAttr}${strokeAttr}${shadowAttr}/>`;
        } else if (fill || sw) body += `<rect ${inset}${radius}${fillAttr}${strokeAttr}${shadowAttr}/>`;
        else if (shadowAttr) body += `<rect width="${f(w)}" height="${f(h)}"${radius} fill="none"${shadowAttr}/>`;
        break;
      }
      case "ellipse":
        body += `<ellipse cx="${f(w / 2)}" cy="${f(h / 2)}" rx="${f(Math.max(0, (w - insetBy * 2) / 2))}" ry="${f(Math.max(0, (h - insetBy * 2) / 2))}"${fillAttr}${strokeAttr}${shadowAttr}/>`;
        break;
      case "path": {
        const a = pathAttrs(doc, n);
        const pfill = a.path.fill === "none" ? "none" : paint(doc, n.fill, mode, warn) ?? "none";
        body += `<svg width="${f(w)}" height="${f(h)}"${svgAttrs(a.svg)} overflow="visible"><path${svgAttrs({ ...a.path, fill: pfill })}${shadowAttr}/></svg>`;
        break;
      }
    }
    if (n.type === "text") {
      const fs = resolveValue(doc, n.fontSize, mode);
      const size = typeof fs === "number" ? fs : Number.parseFloat(String(fs)) || 16;
      const color = escapeHtml(String(resolveValue(doc, n.color, mode)));
      const measuredLines = measure.lines?.[n.id];
      let tspans = "";
      let anchor = "";
      if (measuredLines) {
        tspans = measuredLines.map((l) => `<tspan x="${f(l.x)}" y="${f(l.y)}">${escapeHtml(l.t)}</tspan>`).join("");
      } else {
        const lh = len(doc, n, n.lineHeight) * size;
        const ax = n.textAlign === "center" ? w / 2 : n.textAlign === "right" ? w : 0;
        if (n.textAlign !== "left") anchor = ` text-anchor="${n.textAlign === "center" ? "middle" : "end"}"`;
        tspans = n.text
          .split("\n")
          .map((t, k) => (t ? `<tspan x="${f(ax)}" y="${f(k * lh + (lh - size) / 2 + size * 0.8)}">${escapeHtml(t)}</tspan>` : ""))
          .join("");
      }
      const ls = n.letterSpacing ? ` letter-spacing="${f(len(doc, n, n.letterSpacing))}"` : "";
      body += `<text xml:space="preserve" font-family="${escapeHtml(n.fontFamily)}" font-size="${f(size)}" font-weight="${n.fontWeight}" fill="${color}"${ls}${anchor}>${tspans}</text>`;
    }
    if (n.type === "image") {
      const fit = n.fit === "cover" ? "xMidYMid slice" : n.fit === "contain" ? "xMidYMid meet" : "none";
      if (boxRadius && boxRadius.some((c) => c > 0)) {
        defs += clipDef(`clip-${id}`);
        body += `<image href="${escapeHtml(n.src)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="${fit}" clip-path="url(#clip-${id})"/>`;
      } else body += `<image href="${escapeHtml(n.src)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="${fit}"/>`;
    }
    if (n.type === "frame") {
      const inner = kids();
      if (n.clip && inner) {
        defs += clipDef(`clip-${id}`);
        body += `<g clip-path="url(#clip-${id})">${inner}</g>`;
      } else body += inner;
    }
    return `${open}${defs ? `<defs>${defs}</defs>` : ""}${body}</g>`;
  };

  const origin: Box = [0, 0, 0, 0];
  const content = roots
    .map((r) => doc.nodes[r])
    .filter((n): n is Node => !!n)
    .map((n) => emit(n, origin, true))
    .join("");
  let width: number, height: number;
  if (single) {
    const b = boxes.get(single.id);
    width = b ? b[2] : 1;
    height = b ? b[3] : 1;
  } else {
    width = cb!.width;
    height = cb!.height;
  }
  const bg = single ? "" : `<rect width="${f(width)}" height="${f(height)}" fill="${escapeHtml(page?.fill ? String(resolveValue(doc, page.fill, page.mode)) : "#ffffff")}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(width)}" height="${f(height)}" viewBox="0 0 ${f(width)} ${f(height)}">${bg}${content}</svg>`;
  return { svg, width, height, warnings };
}
