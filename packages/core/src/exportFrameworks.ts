import type { Document, Node } from "./schema.js";
import { cssToString, tokenStylesheet } from "./style.js";
import {
  componentName,
  escapeHtml,
  exportParts,
  pascalName,
  type Bounds,
  type RenderOptions,
  type StyleEmitter,
} from "./render.js";

function exportRoot(doc: Document, rootId: string): Node {
  const node = doc.nodes[rootId];
  if (!node) throw new Error(`node "${rootId}" does not exist`);
  if (node.type === "page") throw new Error(`"${rootId}" is a page; export one of its frames (export_code with the frame id)`);
  return node;
}

function kebabName(pascal: string): string {
  const k = pascal
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return k || "design";
}

function classSheetEmitter(): { emit: StyleEmitter; sheet: () => string } {
  const rules: string[] = [];
  const used = new Set<string>();
  const shared = new Map<string, string>();
  const unique = (label: string) => {
    const pascal = pascalName(label);
    const base = pascal ? pascal[0]!.toLowerCase() + pascal.slice(1) : "node";
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}${i}`;
    used.add(name);
    return name;
  };
  const emit: StyleEmitter = (css, owner) => {
    let name: string;
    if (typeof owner === "string") {
      const known = shared.get(owner);
      if (known) return ` class="${known}"`;
      name = unique(owner);
      shared.set(owner, name);
    } else name = unique(owner.name || owner.id);
    rules.push(`.${name}{${cssToString(css)}}`);
    return ` class="${name}"`;
  };
  return { emit, sheet: () => rules.join("\n") };
}

function classExport(doc: Document, rootId: string, cssVariables: boolean): { body: string; css: string; name: string; bounds: Bounds; background: string; bodyMode: string } {
  const node = exportRoot(doc, rootId);
  const name = componentName(node.name || node.id);
  const { emit, sheet } = classSheetEmitter();
  const p = exportParts(doc, { rootId, cssVariables }, emit);
  const tokens = cssVariables ? `${tokenStylesheet(doc)}\n` : "";
  return { body: p.body, css: `${tokens}${sheet()}\n`, name, bounds: p.bounds, background: p.background, bodyMode: p.bodyMode };
}

export interface AngularExport {
  typescript: string;
  template: string;
  styles: string;
  className: string;
  selector: string;
  fileBase: string;
}

export function exportAngular(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): AngularExport {
  const out = classExport(doc, rootId, !!opts.cssVariables);
  const fileBase = out.name;
  const selector = `app-${kebabName(out.name)}`;
  return {
    typescript: `import { Component } from "@angular/core";\n\n@Component({\n  selector: ${JSON.stringify(selector)},\n  standalone: true,\n  templateUrl: "./${fileBase}.component.html",\n  styleUrl: "./${fileBase}.component.css",\n})\nexport class ${out.name} {}\n`,
    template: `${out.body}\n`,
    styles: out.css,
    className: out.name,
    selector,
    fileBase,
  };
}

export interface SvelteExport {
  source: string;
  fileName: string;
}

function svelteGlobalCss(css: string): string {
  return css.replace(/(:root|\[data-paprika-mode="[^"]*"\])\{/g, ":global($1){");
}

export function exportSvelte(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): SvelteExport {
  const out = classExport(doc, rootId, !!opts.cssVariables);
  const styles = opts.cssVariables ? svelteGlobalCss(out.css) : out.css;
  return {
    source: `${out.body}\n\n<style>\n${styles.trimEnd()}\n</style>\n`,
    fileName: `${out.name}.svelte`,
  };
}

function previewPage(doc: Document, p: { bounds: Bounds; background: string; bodyMode: string }, body: string, css: string): { html: string; bounds: Bounds } {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>
<style>html,body{margin:0;padding:0}body{position:relative;width:${p.bounds.width}px;height:${p.bounds.height}px;background:${escapeHtml(p.background)};font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}${css.trimEnd()}</style>
</head><body${p.bodyMode}>${body}</body></html>`;
  return { html, bounds: p.bounds };
}

/** Static HTML of the class+stylesheet path shared by Angular/Svelte (for visual parity with renderHTML). */
export function renderFrameworkHTML(doc: Document, opts: RenderOptions = {}): { html: string; bounds: Bounds } {
  const { emit, sheet } = classSheetEmitter();
  const p = exportParts(doc, opts, emit);
  const css = `${p.vars ? `${tokenStylesheet(doc)}\n` : ""}${sheet()}\n`;
  return previewPage(doc, p, p.body, css);
}

export function angularPreviewHTML(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): { html: string; bounds: Bounds } {
  const ang = exportAngular(doc, rootId, opts);
  const p = exportParts(doc, { rootId, cssVariables: !!opts.cssVariables }, () => "");
  return previewPage(doc, p, ang.template.trim(), ang.styles);
}

function unwrapSvelteGlobal(css: string): string {
  const marker = ":global(";
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf(marker, i);
    if (at < 0) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    const inner = at + marker.length;
    const end = css.indexOf(")", inner);
    if (end < 0) {
      out += css.slice(at);
      break;
    }
    out += css.slice(inner, end);
    i = end + 1;
  }
  return out;
}

function stripSvelteStyle(source: string): { body: string; style: string } {
  const open = source.lastIndexOf("<style>");
  const close = source.lastIndexOf("</style>");
  if (open < 0 || close < open) return { body: source.trim(), style: "" };
  let style = source.slice(open + "<style>".length, close);
  if (style.startsWith("\n")) style = style.slice(1);
  if (style.endsWith("\n")) style = style.slice(0, -1);
  let body = source.slice(0, open);
  while (body.endsWith("\n")) body = body.slice(0, -1);
  return { body: body.trim(), style: unwrapSvelteGlobal(style) };
}

export function sveltePreviewHTML(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): { html: string; bounds: Bounds } {
  const sv = exportSvelte(doc, rootId, opts);
  const p = exportParts(doc, { rootId, cssVariables: !!opts.cssVariables }, () => "");
  const { body, style } = stripSvelteStyle(sv.source);
  return previewPage(doc, p, body, style);
}
