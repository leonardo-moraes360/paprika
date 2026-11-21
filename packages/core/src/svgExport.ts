import { firstPage, pageRoots, isContainer, type Document, type Node } from "./schema.js";
import { canvasBounds, escapeHtml, svgAttrs } from "./render.js";
import { pathAttrs, resolveValue } from "./style.js";

/**
 * Exporta um nó, uma página ou o canvas como SVG vetorial. O layout automático (row/column, hug,
 * fill) é resolvido pelo navegador: quem exporta renderiza o HTML de `renderHTML` num Chromium,
 * roda `MEASURE_SCRIPT` e passa o resultado em `measure` (caixas antes da rotação e linhas de
 * texto já quebradas). Sem `measure`, só nós com posição absoluta e tamanho em números podem ser
 * exportados, e o texto quebra apenas em `\n`.
 */

export interface Measure {
  /** Caixa de cada nó na página do HTML: [x, y, largura, altura], sem rotação. */
  boxes: Record<string, [number, number, number, number]>;
  /** Linhas de cada texto, relativas à caixa do nó: texto, x e y da linha de base. */
  lines?: Record<string, { t: string; x: number; y: number }[]>;
}

/** Script para `page.evaluate` (Playwright ou CDP) no HTML de `renderHTML`; devolve um `Measure`. */
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
    if (el.getAttribute("data-paprika-type") !== "text") continue;
    const node = el.firstChild;
    if (!node || node.nodeType !== 3 || node.data.length > 5000) continue;
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    el.insertBefore(probe, node);
    const base = probe.getBoundingClientRect().bottom;
    el.removeChild(probe);
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

const f = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? "0" : String(v);
};

type Box = [number, number, number, number];

function paint(doc: Document, v: string | undefined, warn: (w: string) => void): string | undefined {
  if (v === undefined) return undefined;
  const s = String(resolveValue(doc, v)).trim();
  if (/gradient\(/i.test(s) || /url\(/i.test(s)) {
    warn("gradientes e imagens de fundo não vão para o SVG; o preenchimento foi omitido");
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
  if (opts.rootId && !node) throw new Error(`nó "${opts.rootId}" não existe`);
  const page = node ? (node.type === "page" ? node : undefined) : firstPage(doc);
  const single = node && node.type !== "page" ? node : undefined;
  const roots = single ? [single.id] : pageRoots(doc, page?.id);
  const cb = single ? undefined : canvasBounds(doc, page?.id);
  const measured = opts.measure?.boxes ?? {};
  const boxes = new Map<string, Box>();

  // Caixas: medidas pelo navegador ou, sem medida, derivadas de x/y/width/height em números.
  const boxOf = (n: Node, parent: Box, inFlow: boolean, root: boolean): Box | undefined => {
    const m = measured[n.id];
    if (m) return m;
    if (opts.measure) return undefined; // medido e sem caixa: escondido
    if (n.type === "page") return undefined;
    if (inFlow || typeof n.width !== "number" || typeof n.height !== "number")
      throw new Error(`"${n.id}" depende de layout automático (row/column, hug ou fill); exporte pelo servidor (export_code com format "svg"), que mede o layout num navegador`);
    if (single && root) return [0, 0, n.width, n.height];
    const x = root && cb ? n.x - cb.x : parent[0] + n.x;
    const y = root && cb ? n.y - cb.y : parent[1] + n.y;
    return [x, y, n.width, n.height];
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
    const rotation = n.type === "group" ? 0 : n.rotation;
    if (rotation) tr += ` rotate(${f(rotation)} ${f(w / 2)} ${f(h / 2)})`;
    const id = escapeHtml(n.id);
    let open = `<g data-paprika-id="${id}"${n.name ? ` data-name="${escapeHtml(n.name)}"` : ""} transform="${tr}"`;
    if (n.opacity !== 1) open += ` opacity="${f(n.opacity)}"`;
    open += ">";
    const kids = () => (isContainer(n) ? n.children.map((c) => doc.nodes[c]).filter((c): c is Node => !!c).map((c) => emit(c, b, false)).join("") : "");
    if (n.type === "group") return `${open}${kids()}</g>`;

    let defs = "";
    let shadowAttr = "";
    if (n.shadow && n.type !== "text") {
      const s = n.shadow;
      if (s.spread) warn("sombra com spread: o SVG usa só deslocamento, blur e cor");
      defs += `<filter id="shadow-${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${f(s.x)}" dy="${f(s.y)}" stdDeviation="${f(s.blur / 2)}" flood-color="${escapeHtml(String(resolveValue(doc, s.color)))}"/></filter>`;
      shadowAttr = ` filter="url(#shadow-${id})"`;
    }
    const fill = n.type === "path" ? undefined : paint(doc, n.fill, warn);
    const sw = n.type !== "path" && n.stroke && n.stroke.width > 0 ? n.stroke.width : 0;
    const strokeAttr = sw ? ` stroke="${escapeHtml(String(resolveValue(doc, n.stroke!.color)))}" stroke-width="${f(sw)}"` : "";
    const fillAttr = ` fill="${escapeHtml(fill ?? "none")}"`;
    // A borda do CSS fica por dentro da caixa; o traço do SVG é centrado: recua meia espessura.
    const inset = `x="${f(sw / 2)}" y="${f(sw / 2)}" width="${f(Math.max(0, w - sw))}" height="${f(Math.max(0, h - sw))}"`;
    // O CSS limita o raio à metade do lado menor (pílula); o SVG limitaria cada eixo (elipse).
    const r = n.type !== "ellipse" && n.type !== "path" ? Math.min(n.radius, w / 2, h / 2) : 0;
    const radius = r ? ` rx="${f(Math.max(0, r - sw / 2))}"` : "";
    const clipRadius = r ? ` rx="${f(r)}"` : "";
    let body = "";
    switch (n.type) {
      case "frame":
      case "rect":
      case "text":
      case "image": {
        if (fill || sw) body += `<rect ${inset}${radius}${fillAttr}${strokeAttr}${shadowAttr}/>`;
        else if (shadowAttr) body += `<rect width="${f(w)}" height="${f(h)}"${radius} fill="none"${shadowAttr}/>`;
        break;
      }
      case "ellipse":
        body += `<ellipse cx="${f(w / 2)}" cy="${f(h / 2)}" rx="${f(Math.max(0, (w - sw) / 2))}" ry="${f(Math.max(0, (h - sw) / 2))}"${fillAttr}${strokeAttr}${shadowAttr}/>`;
        break;
      case "path": {
        const a = pathAttrs(doc, n);
        const pfill = a.path.fill === "none" ? "none" : paint(doc, n.fill, warn) ?? "none";
        body += `<svg width="${f(w)}" height="${f(h)}"${svgAttrs(a.svg)} overflow="visible"><path${svgAttrs({ ...a.path, fill: pfill })}${shadowAttr}/></svg>`;
        break;
      }
    }
    if (n.type === "text") {
      const fs = resolveValue(doc, n.fontSize);
      const size = typeof fs === "number" ? fs : parseFloat(String(fs)) || 16;
      const color = escapeHtml(String(resolveValue(doc, n.color)));
      const measuredLines = opts.measure?.lines?.[n.id];
      let tspans = "";
      let anchor = "";
      if (measuredLines) {
        tspans = measuredLines.map((l) => `<tspan x="${f(l.x)}" y="${f(l.y)}">${escapeHtml(l.t)}</tspan>`).join("");
      } else {
        const lh = n.lineHeight * size;
        const ax = n.textAlign === "center" ? w / 2 : n.textAlign === "right" ? w : 0;
        if (n.textAlign !== "left") anchor = ` text-anchor="${n.textAlign === "center" ? "middle" : "end"}"`;
        tspans = n.text
          .split("\n")
          .map((t, k) => (t ? `<tspan x="${f(ax)}" y="${f(k * lh + (lh - size) / 2 + size * 0.8)}">${escapeHtml(t)}</tspan>` : ""))
          .join("");
      }
      const ls = n.letterSpacing ? ` letter-spacing="${f(n.letterSpacing)}"` : "";
      body += `<text xml:space="preserve" font-family="${escapeHtml(n.fontFamily)}" font-size="${f(size)}" font-weight="${n.fontWeight}" fill="${color}"${ls}${anchor}>${tspans}</text>`;
    }
    if (n.type === "image") {
      const fit = n.fit === "cover" ? "xMidYMid slice" : n.fit === "contain" ? "xMidYMid meet" : "none";
      if (n.radius) {
        defs += `<clipPath id="clip-${id}"><rect width="${f(w)}" height="${f(h)}"${clipRadius}/></clipPath>`;
        body += `<image href="${escapeHtml(n.src)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="${fit}" clip-path="url(#clip-${id})"/>`;
      } else body += `<image href="${escapeHtml(n.src)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="${fit}"/>`;
    }
    if (n.type === "frame") {
      const inner = kids();
      if (n.clip && inner) {
        defs += `<clipPath id="clip-${id}"><rect width="${f(w)}" height="${f(h)}"${clipRadius}/></clipPath>`;
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
  const bg = single ? "" : `<rect width="${f(width)}" height="${f(height)}" fill="${escapeHtml(page?.fill ? String(resolveValue(doc, page.fill)) : "#ffffff")}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(width)}" height="${f(height)}" viewBox="0 0 ${f(width)} ${f(height)}">${bg}${content}</svg>`;
  return { svg, width, height, warnings };
}
