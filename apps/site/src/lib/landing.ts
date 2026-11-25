import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SITE } from "./root";
import { cssToString, escapeHtml, nodeStyle, pathAttrs } from "@paprika/core";

const doc = JSON.parse(readFileSync(join(SITE, "design/landing.paprika.json"), "utf8"));
const LINK = /^link:(.+)$/;
const ANCHOR = /^anchor:(.+)$/;
const COPY = /^copy:(.+)$/;
const HEADING = /^h[1-3]$/;

type Node = { id: string; type: string; name?: string; text?: string; src?: string; alt?: string; decorative?: boolean; children?: string[] };

function renderNode(node: Node, asRoot: boolean, suffix = ""): string {
  const css = nodeStyle(doc, node, { asRoot }) as Record<string, string | number | undefined>;
  if (asRoot) {
    css.position = "relative";
    css.width = "100%";
    delete css.height;
    delete css.left;
    delete css.top;
    css.minHeight = "100vh";
  }
  const name = node.name ?? "";
  const link = LINK.exec(name);
  const anchor = ANCHOR.exec(name);
  const copy = COPY.exec(name);
  const id = anchor ? ` id="${escapeHtml(anchor[1] + suffix)}"` : "";
  const attrs = `data-paprika-id="${escapeHtml(node.id)}"${id} style="${escapeHtml(cssToString(css))}"`;
  let inner = "";
  switch (node.type) {
    case "frame":
      inner = (node.children ?? []).map((c) => doc.nodes[c]).filter(Boolean).map((c: Node) => renderNode(c, false, suffix)).join("");
      break;
    case "text":
      inner = escapeHtml(node.text ?? "");
      break;
    case "image": {
      const alt = node.decorative ? "" : escapeHtml(node.alt ?? "");
      const img = `<img ${link ? `style="${escapeHtml(cssToString(css))}"` : attrs} src="${escapeHtml(node.src ?? "")}" alt="${alt}"${node.decorative ? ' aria-hidden="true"' : ""}>`;
      if (!link) return img;
      const h = link[1].startsWith("#") ? link[1] + suffix : link[1];
      return `<a data-paprika-id="${escapeHtml(node.id)}" href="${escapeHtml(h)}"${/^https?:/.test(h) ? ' rel="noopener"' : ""} style="display:inline-flex">${img}</a>`;
    }
    case "path": {
      const a = pathAttrs(doc, node);
      const kv = (o: Record<string, unknown>) =>
        Object.entries(o)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => ` ${k === "viewBox" ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${escapeHtml(String(v))}"`)
          .join("");
      return `<svg ${attrs} aria-hidden="true" xmlns="http://www.w3.org/2000/svg"${kv(a.svg)}><path${kv(a.path)}/></svg>`;
    }
  }
  if (link) {
    const h = link[1].startsWith("#") ? link[1] + suffix : link[1];
    return `<a ${attrs} href="${escapeHtml(h)}"${/^https?:/.test(h) ? ' rel="noopener"' : ""}>${inner}</a>`;
  }
  if (copy) return `<button type="button" ${attrs} data-copy="${escapeHtml(copy[1])}">${inner}</button>`;
  if (node.type === "text" && HEADING.test(name)) return `<${name} ${attrs}>${inner}</${name}>`;
  return `<div ${attrs}>${inner}</div>`;
}

export function landingFrames(lang: "en" | "pt-BR") {
  const desktop = doc.nodes[`lp-desktop-${lang}`];
  const mobile = doc.nodes[`lp-mobile-${lang}`];
  if (!desktop || !mobile) throw new Error(`landing frames for ${lang} are missing; run scripts/draw-landing.mjs`);
  return { desktop: renderNode(desktop, true), mobile: renderNode(mobile, true, "-m") };
}

export function landingText(lang: "en" | "pt-BR", id: string): string | undefined {
  const root = doc.nodes[`lp-desktop-${lang}`];
  const walk = (n: Node): string | undefined => {
    if (n.name === id && n.type === "text") return n.text;
    for (const c of n.children ?? []) {
      const r = walk(doc.nodes[c]);
      if (r) return r;
    }
  };
  return root ? walk(root) : undefined;
}

const README = { en: "README.md", "pt-BR": "docs/pt-BR/README.md" } as const;

export function setupPrompt(lang: "en" | "pt-BR"): string {
  const md = readFileSync(join(ROOT, README[lang]), "utf8");
  const m = /```text\n([\s\S]*?)\n```/.exec(md);
  if (!m) throw new Error(`setup prompt not found in ${README[lang]}`);
  return m[1];
}
