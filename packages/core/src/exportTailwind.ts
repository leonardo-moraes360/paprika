import type { Document, Node } from "./schema.js";
import {
  SHAPE_SVG_CSS,
  SHAPE_TEXT_CSS,
  connectorAttrs,
  connectorLabelAttrs,
  cssToString,
  modeOf,
  nodeStyle,
  pathAttrs,
  shapeAttrs,
  tokenStylesheet,
  type CSS,
} from "./style.js";
import {
  escapeHtml,
  exportParts,
  jsxNode,
  type Bounds,
  type RenderOptions,
  type StyleEmitter,
} from "./render.js";

/**
 * `export_code { format: "tailwind" | "css-modules" }`.
 *
 * Both start from `nodeStyle`, the function the canvas itself paints with, and neither one is
 * allowed to drop a declaration it cannot express: what the target has no utility for goes back
 * into an inline `style`. The promise of the format is that the exported screen *is* the screen,
 * so an unmapped property is a visible fallback (and the golden-board tests fail on it), never a
 * silent visual change.
 */

/** Inside a Tailwind arbitrary value a space closes the class, so they become underscores. */
const arb = (v: string) => v.replace(/\s+/g, "_");

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
  ["dashed", "border-dashed", ],
  ["dotted", "border-dotted"],
  ["none", "border-none"],
]);

/** `1px solid #c43d27`: the shorthand is not a Tailwind arbitrary value, so it splits in three. */
function borderClasses(value: string): string[] | undefined {
  const m = value.match(/^(\d+(?:\.\d+)?px)\s+(solid|dashed|dotted|none)\s+(.+)$/);
  if (!m) return undefined;
  const style = BORDER_STYLE.get(m[2]!);
  if (!style) return undefined;
  return [`border-[${arb(m[1]!)}]`, style, `border-[${arb(m[3]!)}]`];
}

/** `16px` → `p-[16px]`; four sides → the four directional utilities (what the canvas means). */
function paddingClasses(value: string): string[] | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) return [`p-[${parts[0]!}]`];
  if (parts.length === 2) return [`py-[${parts[0]!}]`, `px-[${parts[1]!}]`];
  if (parts.length === 4) return [`pt-[${parts[0]!}]`, `pr-[${parts[1]!}]`, `pb-[${parts[2]!}]`, `pl-[${parts[3]!}]`];
  return undefined;
}

/**
 * One `nodeStyle` declaration as Tailwind utilities; `undefined` means "this target has no
 * utility for it", and the caller keeps it inline.
 */
export function tailwindClassesFor(key: string, value: string | number): string[] | undefined {
  const v = String(value);
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
      return [`bg-[${arb(v)}]`];
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
      return [`text-[${arb(v)}]`];
    case "fontFamily":
      return [`font-[${arb(v)}]`];
    case "fontSize":
      return [`text-[${arb(v)}]`];
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
  /** The utilities, in the order `nodeStyle` emitted the declarations. */
  classes: string[];
  /** What the target could not express: goes back inline so the pixel does not move. */
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

/** ` class="…"` for the HTML document, plus `style` only for what has no utility. */
export const tailwindClassAttr: StyleEmitter = (css) => {
  const { classes, fallback } = tailwindClasses(css);
  const cls = classes.length ? ` class="${escapeHtml(classes.join(" "))}"` : "";
  const inline = Object.keys(fallback).length ? ` style="${escapeHtml(cssToString(fallback))}"` : "";
  return `${cls}${inline}`;
};

/** ` className="…"` for the JSX component. */
export const tailwindClassNameAttr: StyleEmitter = (css) => {
  const { classes, fallback } = tailwindClasses(css);
  const cls = classes.length ? ` className=${JSON.stringify(classes.join(" "))}` : "";
  const inline = Object.keys(fallback).length ? jsxStyleObject(fallback) : "";
  return `${cls}${inline}`;
};

function jsxStyleObject(css: CSS): string {
  return ` style={{ ${Object.entries(css)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? v : JSON.stringify(v)}`)
    .join(", ")} }}`;
}

/** The CDN is what the parity test renders; a project with its own Tailwind build drops the tag. */
export const TAILWIND_CDN = "https://cdn.tailwindcss.com";

/** The `<body>` box: the same numbers the HTML export writes in its stylesheet, as utilities. */
function bodyClasses(bounds: Bounds, background: string): string {
  return ["relative", `w-[${bounds.width}px]`, `h-[${bounds.height}px]`, `bg-[${arb(String(background))}]`, "font-[Inter_system-ui_sans-serif]"].join(" ");
}

/**
 * Standalone HTML with utility classes: same tree as the `html` format, but the styling is
 * Tailwind (CDN tag included, so the file renders as it is) and the token sheet is only there
 * when `cssVariables` asked for `var(--nome)`.
 */
export function renderTailwindHTML(doc: Document, opts: RenderOptions = {}): { html: string; bounds: Bounds } {
  const p = exportParts(doc, opts, tailwindClassAttr);
  const tokens = p.vars ? `\n<style>${tokenStylesheet(doc)}</style>` : "";
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>
<script src="${TAILWIND_CDN}"></script>${tokens}
</head><body${p.bodyMode} class="${bodyClasses(p.bounds, p.background)}">${p.body}</body></html>`;
  return { html, bounds: p.bounds };
}

/** Component name, identical to the `react` format so the two exports are sibling screens. */
function componentName(s: string): string {
  const base = pascal(s).replace(/^[^A-Za-z]+/, "");
  return base ? base[0]!.toUpperCase() + base.slice(1) : "Design";
}

/** "Card grande" → "CardGrande"; accents are dropped, as in the React export. */
function pascal(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""));
}

function requireRoot(doc: Document, rootId: string): Node {
  const node = doc.nodes[rootId];
  if (!node) throw new Error(`node "${rootId}" does not exist`);
  if (node.type === "page") throw new Error(`"${rootId}" is a page; export one of its frames (export_code with the frame id)`);
  return node;
}

/**
 * React (TSX) component with utility classes. With `cssVariables`, tokens come out as
 * `var(--nome)` inside the classes and the module exports `tokensCss` (the sheet per mode), the
 * same contract as the `react` format: the app includes the sheet once and switches mode through
 * `data-paprika-mode`.
 */
export function exportTailwind(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): string {
  const node = requireRoot(doc, rootId);
  const vars = !!opts.cssVariables;
  const tokens = vars ? `export const tokensCss = ${JSON.stringify(tokenStylesheet(doc))};\n\n` : "";
  const name = componentName(node.name || node.id);
  return `${tokens}export function ${name}() {\n  return (\n${jsxNode(doc, node, true, "    ", vars, tailwindClassNameAttr)}\n  );\n}\n`;
}

export interface CssModuleExport {
  /** The React (TSX) component that imports the module. */
  component: string;
  /** The contents of `<Name>.module.css`. */
  css: string;
  /** The suggested file name for the sheet. */
  fileName: string;
}

/** One rule per node, named after it; the declarations are exactly `nodeStyle`'s. */
class ModuleRules {
  private rules: string[] = [];
  private used = new Set<string>();
  private shared = new Map<string, string>();

  for(node: Node): string {
    const base = camel(node.name || node.id) || "node";
    let name = base;
    for (let i = 2; this.used.has(name); i++) name = `${base}${i}`;
    this.used.add(name);
    return name;
  }

  add(selector: string, css: CSS): void {
    this.rules.push(`.${selector}{${cssToString(css)}}`);
  }

  /** The shape's outline and text blocks are the same on every shape: one rule, emitted once. */
  sharedClass(key: string, label: string, css: CSS): string {
    let name = this.shared.get(key);
    if (!name) {
      name = camel(label);
      this.used.add(name);
      this.shared.set(key, name);
      this.add(name, css);
    }
    return name;
  }

  build(): string {
    return this.rules.join("");
  }
}

function camel(s: string): string {
  const p = pascal(s);
  return p ? p[0]!.toLowerCase() + p.slice(1) : "";
}

/**
 * `export_code { format: "css-modules" }`: `<Name>.tsx` plus `<Name>.module.css`, for a project
 * that wants no Tailwind and no inline styles. The token sheet, when asked for, sits at the top
 * of the module so mode switching keeps working the same way.
 */
export function exportCssModules(doc: Document, rootId: string, opts: { cssVariables?: boolean } = {}): CssModuleExport {
  const node = requireRoot(doc, rootId);
  const vars = !!opts.cssVariables;
  const name = componentName(node.name || node.id);
  const rules = new ModuleRules();
  const component = moduleNode(doc, node, true, "    ", vars, rules);
  const tokens = vars ? `${tokenStylesheet(doc)}\n` : "";
  return {
    component: `import styles from "./${name}.module.css";\n\nexport function ${name}() {\n  return (\n${component}\n  );\n}\n`,
    css: `${tokens}${rules.build()}`,
    fileName: `${name}.module.css`,
  };
}

/** Its own walk: every node needs its class name, so the rules object is threaded through. */
function moduleNode(doc: Document, node: Node, asRoot: boolean, indent: string, vars: boolean, rules: ModuleRules): string {
  const selector = rules.for(node);
  rules.add(selector, nodeStyle(doc, node, { asRoot, vars }));
  const style = ` className={styles.${selector}}`;
  const mode = (node.type === "frame" || node.type === "page") && node.mode ? node.mode : asRoot && vars ? modeOf(doc, node) : undefined;
  const attrs = `${node.name ? ` data-name=${JSON.stringify(node.name)}` : ""}${mode ? ` data-paprika-mode=${JSON.stringify(mode)}` : ""}`;
  switch (node.type) {
    case "frame":
    case "group":
    case "page": {
      const kids = node.children
        .map((c) => doc.nodes[c])
        .filter((c): c is Node => !!c)
        .map((c) => moduleNode(doc, c, false, indent + "  ", vars, rules))
        .join("\n");
      return kids ? `${indent}<div${attrs}${style}>\n${kids}\n${indent}</div>` : `${indent}<div${attrs}${style} />`;
    }
    case "text":
      return `${indent}<div${attrs}${style}>${jsxText(node.text)}</div>`;
    case "image":
      return `${indent}<img${attrs}${style} src=${JSON.stringify(node.src)} alt=${JSON.stringify(node.alt)} />`;
    case "path": {
      const a = pathAttrs(doc, node, { vars });
      return `${indent}<svg${attrs}${style}${jsxAttrs(a.svg)}>\n${indent}  <path${jsxAttrs(a.path)} />\n${indent}</svg>`;
    }
    case "connector": {
      const label = connectorLabelAttrs(doc, node, { vars });
      const text = label ? `\n${indent}  <text${jsxAttrs(label)}>{${JSON.stringify(node.label)}}</text>` : "";
      return `${indent}<svg${attrs}${style}>\n${indent}  <path${jsxAttrs(connectorAttrs(doc, node, { vars }))} />${text}\n${indent}</svg>`;
    }
    case "shape": {
      const a = shapeAttrs(doc, node, { vars });
      const fold = a.fold ? `\n${indent}    <path${jsxAttrs(a.fold)} />` : "";
      const svgClass = rules.sharedClass("shapeSvg", "shapeSvg", SHAPE_SVG_CSS);
      const textClass = rules.sharedClass("shapeText", "shapeText", SHAPE_TEXT_CSS);
      return `${indent}<div${attrs}${style}>\n${indent}  <svg${jsxAttrs(a.svg)} className={styles.${svgClass}}>\n${indent}    <path${jsxAttrs(a.path)} />${fold}\n${indent}  </svg>\n${indent}  <div className={styles.${textClass}}>${jsxText(node.text)}</div>\n${indent}</div>`;
    }
    default:
      return `${indent}<div${attrs}${style} />`;
    }
}

function jsxAttrs(o: Record<string, string | number | undefined>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}=${typeof v === "number" ? `{${v}}` : JSON.stringify(v)}`)
    .join("");
}

function jsxText(s: string): string {
  return s.replace(/[{}<>]/g, (c) => `{${JSON.stringify(c)}}`).replace(/\n/g, "{'\\n'}");
}
