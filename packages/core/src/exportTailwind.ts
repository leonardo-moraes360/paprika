import type { Document, Node } from "./schema.js";
import { cssToString, tokenStylesheet, type CSS } from "./style.js";
import {
  componentName,
  escapeHtml,
  exportParts,
  jsxNode,
  jsxStyleAttr,
  pascalName,
  type Bounds,
  type RenderOptions,
  type StyleEmitter,
} from "./render.js";

const arb = (v: string) => v.replace(/_|\s+/g, (m) => (m === "_" ? "\\_" : "_"));

const UNSAFE = /[\[\]{};]/;

const POSITION = new Set(["static", "fixed", "absolute", "relative", "sticky"]);
const DISPLAY = new Map([
  ["block", "block"],
  ["inline-block", "inline-block"],
  ["inline", "inline"],
  ["flex", "flex"],
  ["inline-flex", "inline-flex"],
  ["grid", "grid"],
  ["none", "hidden"],
]);
const ALIGN_ITEMS = new Map([
  ["flex-start", "items-start"],
  ["flex-end", "items-end"],
  ["center", "items-center"],
  ["stretch", "items-stretch"],
  ["baseline", "items-baseline"],
]);
const ALIGN_SELF = new Map([
  ["auto", "self-auto"],
  ["flex-start", "self-start"],
  ["flex-end", "self-end"],
  ["center", "self-center"],
  ["stretch", "self-stretch"],
  ["baseline", "self-baseline"],
]);
const JUSTIFY = new Map([
  ["flex-start", "justify-start"],
  ["flex-end", "justify-end"],
  ["center", "justify-center"],
  ["space-between", "justify-between"],
  ["space-around", "justify-around"],
  ["space-evenly", "justify-evenly"],
]);
const FLEX_DIRECTION = new Map([
  ["row", "flex-row"],
  ["row-reverse", "flex-row-reverse"],
  ["column", "flex-col"],
  ["column-reverse", "flex-col-reverse"],
]);
const OVERFLOW = new Map([
  ["visible", "overflow-visible"],
  ["hidden", "overflow-hidden"],
  ["scroll", "overflow-scroll"],
  ["auto", "overflow-auto"],
]);
const OBJECT_FIT = new Map([
  ["cover", "object-cover"],
  ["contain", "object-contain"],
  ["fill", "object-fill"],
  ["none", "object-none"],
  ["scale-down", "object-scale-down"],
]);
const TEXT_ALIGN = new Map([
  ["left", "text-left"],
  ["right", "text-right"],
  ["center", "text-center"],
  ["justify", "text-justify"],
  ["start", "text-start"],
  ["end", "text-end"],
]);
const WHITE_SPACE = new Map([
  ["normal", "whitespace-normal"],
  ["nowrap", "whitespace-nowrap"],
  ["pre", "whitespace-pre"],
  ["pre-line", "whitespace-pre-line"],
  ["pre-wrap", "whitespace-pre-wrap"],
]);
const SIZE_VALUE = new Map([
  ["auto", "auto"],
  ["max-content", "max"],
  ["min-content", "min"],
  ["fit-content", "fit"],
  ["100%", "full"],
]);
const BORDER_STYLE = new Map([
  ["solid", "border-solid"],
  ["dashed", "border-dashed"],
  ["dotted", "border-dotted"],
  ["none", "border-none"],
]);

function borderClasses(value: string): string[] | undefined {
  const [width, styleName, ...color] = value.split(/\s+/);
  if (!width || !styleName || color.length === 0 || !/^\d+(?:\.\d+)?px$/.test(width)) return undefined;
  const style = BORDER_STYLE.get(styleName);
  if (!style) return undefined;
  return [`border-[length:${arb(width)}]`, style, `border-[color:${arb(color.join(" "))}]`];
}

function paddingClasses(value: string): string[] | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) return [`p-[${parts[0]!}]`];
  if (parts.length === 2) return [`py-[${parts[0]!}]`, `px-[${parts[1]!}]`];
  if (parts.length === 4) return [`pt-[${parts[0]!}]`, `pr-[${parts[1]!}]`, `pb-[${parts[2]!}]`, `pl-[${parts[3]!}]`];
  return undefined;
}

export function tailwindClassesFor(key: string, value: string | number): string[] | undefined {
  const v = String(value);
  if (UNSAFE.test(v)) return undefined;
  switch (key) {
    case "boxSizing":
      return v === "border-box" ? ["box-border"] : v === "content-box" ? ["box-content"] : undefined;
    case "position":
      return POSITION.has(v) ? [v] : undefined;
    case "left":
    case "top":
    case "right":
    case "bottom":
      return [`${key}-[${arb(v)}]`];
    case "width":
    case "height": {
      const prefix = key === "width" ? "w" : "h";
      const named = SIZE_VALUE.get(v);
      return [named ? `${prefix}-${named}` : `${prefix}-[${arb(v)}]`];
    }
    case "minWidth":
    case "minHeight": {
      const prefix = key === "minWidth" ? "min-w" : "min-h";
      return v === "0" || v === "0px" ? [`${prefix}-0`] : [`${prefix}-[${arb(v)}]`];
    }
    case "maxWidth":
    case "maxHeight":
      return [`${key === "maxWidth" ? "max-w" : "max-h"}-[${arb(v)}]`];
    case "flex":
      return [`flex-[${arb(v)}]`];
    case "flexShrink":
      return v === "0" ? ["shrink-0"] : [`shrink-[${v}]`];
    case "flexGrow":
      return v === "1" ? ["grow"] : [`grow-[${v}]`];
    case "alignItems":
      return ALIGN_ITEMS.get(v) ? [ALIGN_ITEMS.get(v)!] : undefined;
    case "alignSelf":
      return ALIGN_SELF.get(v) ? [ALIGN_SELF.get(v)!] : undefined;
    case "justifyContent":
      return JUSTIFY.get(v) ? [JUSTIFY.get(v)!] : undefined;
    case "flexDirection":
      return FLEX_DIRECTION.get(v) ? [FLEX_DIRECTION.get(v)!] : undefined;
    case "flexWrap":
      return v === "wrap" ? ["flex-wrap"] : v === "nowrap" ? ["flex-nowrap"] : undefined;
    case "gap":
      return [`gap-[${arb(v)}]`];
    case "padding":
      return paddingClasses(v);
    case "margin":
      return v === "0" ? ["m-0"] : [`m-[${arb(v)}]`];
    case "display":
      return DISPLAY.get(v) ? [DISPLAY.get(v)!] : undefined;
    case "opacity":
      return [`opacity-[${v}]`];
    case "transform": {
      const m = v.match(/^rotate\((-?[\d.]+)deg\)$/);
      return m ? [`rotate-[${m[1]!}deg]`] : undefined;
    }
    case "background":
    case "backgroundColor":
      return [`bg-[color:${arb(v)}]`];
    case "border":
      return borderClasses(v);
    case "borderRadius":
      return [`rounded-[${arb(v)}]`];
    case "boxShadow":
      return [`shadow-[${arb(v)}]`];
    case "filter": {
      const m = v.match(/^drop-shadow\((.+)\)$/);
      return m ? [`drop-shadow-[${arb(m[1]!)}]`] : undefined;
    }
    case "overflow":
      return OVERFLOW.get(v) ? [OVERFLOW.get(v)!] : undefined;
    case "color":
      return [`text-[color:${arb(v)}]`];
    case "fontFamily":
      return [`font-[family-name:${arb(v)}]`];
    case "fontSize":
      return [`text-[length:${arb(v)}]`];
    case "fontWeight":
      return v === "normal" ? ["font-normal"] : v === "bold" ? ["font-bold"] : [`font-[${v}]`];
    case "lineHeight":
      return [`leading-[${v}]`];
    case "letterSpacing":
      return [`tracking-[${arb(v)}]`];
    case "textAlign":
      return TEXT_ALIGN.get(v) ? [TEXT_ALIGN.get(v)!] : undefined;
    case "whiteSpace":
      return WHITE_SPACE.get(v) ? [WHITE_SPACE.get(v)!] : undefined;
    case "overflowWrap":
      return v === "anywhere" ? ["[overflow-wrap:anywhere]"] : v === "break-word" ? ["break-words"] : undefined;
    case "objectFit":
      return OBJECT_FIT.get(v) ? [OBJECT_FIT.get(v)!] : undefined;
    default:
      return undefined;
  }
}

export interface TailwindCSS {
  classes: string[];
  fallback: CSS;
}

export function tailwindClasses(css: CSS): TailwindCSS {
  const classes: string[] = [];
  const fallback: CSS = {};
  for (const [key, value] of Object.entries(css)) {
    const mapped = tailwindClassesFor(key, value);
    if (mapped && mapped.length) classes.push(...mapped);
    else fallback[key] = value;
  }
  return { classes, fallback };
}

const tailwindClassAttr: StyleEmitter = (css) => {
  const { classes, fallback } = tailwindClasses(css);
  const cls = classes.length ? ` class="${escapeHtml(classes.join(" "))}"` : "";
  const inline = Object.keys(fallback).length ? ` style="${escapeHtml(cssToString(fallback))}"` : "";
  return `${cls}${inline}`;
};

const tailwindClassNameAttr: StyleEmitter = (css, owner) => {
  const { classes, fallback } = tailwindClasses(css);
  const cls = classes.length ? ` className=${JSON.stringify(classes.join(" "))}` : "";
  const inline = Object.keys(fallback).length ? jsxStyleAttr(fallback, owner) : "";
  return `${cls}${inline}`;
};

export const TAILWIND_CDN = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";

function bodyClasses(bounds: Bounds, background: string): string {
  return [
    "relative",
    `w-[${bounds.width}px]`,
    `h-[${bounds.height}px]`,
    `bg-[color:${arb(background)}]`,
    "font-[family-name:Inter,system-ui,sans-serif]",
    "antialiased",
  ].join(" ");
}

export function renderTailwindHTML(doc: Document, opts: RenderOptions = {}): { html: string; bounds: Bounds } {
  const p = exportParts(doc, opts, tailwindClassAttr);
  const tokens = p.vars ? `\n<style>${tokenStylesheet(doc)}</style>` : "";
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>
<script src="${TAILWIND_CDN}"></script>${tokens}
</head><body${p.bodyMode} class="${escapeHtml(bodyClasses(p.bounds, p.background))}">${p.body}</body></html>`;
  return { html, bounds: p.bounds };
}

function exportRoot(doc: Document, rootId: string): Node {
  const node = doc.nodes[rootId];
  if (!node) throw new Error(`node "${rootId}" does not exist`);
  if (node.type === "page") throw new Error(`"${rootId}" is a page; export one of its frames (export_code with the frame id)`);
  return node;
}

export function exportTailwind(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): string {
  const node = exportRoot(doc, rootId);
  const vars = !!opts.cssVariables;
  const tokens = vars ? `export const tokensCss = ${JSON.stringify(tokenStylesheet(doc))};\n\n` : "";
  const name = componentName(node.name || node.id);
  return `${tokens}export function ${name}() {\n  return (\n${jsxNode(doc, node, true, "    ", vars, tailwindClassNameAttr)}\n  );\n}\n`;
}

export interface CssModuleExport {
  component: string;
  css: string;
  fileName: string;
}

function cssModuleEmitter(): { emit: StyleEmitter; sheet: () => string } {
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
      if (known) return ` className={styles.${known}}`;
      name = unique(owner);
      shared.set(owner, name);
    } else name = unique(owner.name || owner.id);
    rules.push(`.${name}{${cssToString(css)}}`);
    return ` className={styles.${name}}`;
  };
  return { emit, sheet: () => rules.join("\n") };
}

export function exportCssModules(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): CssModuleExport {
  const node = exportRoot(doc, rootId);
  const vars = !!opts.cssVariables;
  const name = componentName(node.name || node.id);
  const { emit, sheet } = cssModuleEmitter();
  const body = jsxNode(doc, node, true, "    ", vars, emit);
  const tokens = vars ? `${tokenStylesheet(doc)}\n` : "";
  return {
    component: `import styles from "./${name}.module.css";\n\nexport function ${name}() {\n  return (\n${body}\n  );\n}\n`,
    css: `${tokens}${sheet()}\n`,
    fileName: `${name}.module.css`,
  };
}
