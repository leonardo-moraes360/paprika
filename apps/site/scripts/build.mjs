// Builds the GitHub Pages site into apps/site/dist:
//   /            landing page (English), rendered from apps/site/design/landing.paprika.json
//   /pt-BR/      landing page (Brazilian Portuguese)
//   /docs/       README + docs/ in English
//   /docs/pt-BR/ the Brazilian Portuguese mirror
//
// The landing page is drawn in Paprika (scripts/draw-landing.mjs) and rendered here with the same
// style engine as the canvas, screenshot and export (`nodeStyle` from @paprika/core). Two
// changes for the web: root frames stretch to the viewport width, and nodes named `link:<href>`
// become links.
//
// Usage: pnpm --filter @paprika/core build && pnpm --filter @paprika/site site:build
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cssToString, escapeHtml, nodeStyle, pathAttrs } from "@paprika/core";
import { Marked } from "marked";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(SITE, "..", "..");
const OUT = join(SITE, "dist");
const REPO = "https://github.com/leonardo-moraes360/paprika";
const DOMAIN = process.env.PAPRIKA_SITE_URL ?? "https://paprika.js.org";
const MOBILE_MAX = 760;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const write = (rel, content) => {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const copy = (fromRel, toRel) => {
  const to = join(OUT, toRel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(ROOT, fromRel), to);
};
/** Relative URL from one output page to another output path. */
const rel = (fromPage, toPath) => {
  const r = posix.relative(posix.dirname(fromPage), toPath);
  if (r === "") return "./";
  return toPath.endsWith("/") && !r.endsWith("/") ? `${r}/` : r;
};
const pretty = (p) => p.replace(/(^|\/)index\.html$/, "$1");

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap">';

const head = ({ lang, title, description, page, alternates, icon, css }) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${DOMAIN}/${pretty(page)}">
<meta name="theme-color" content="#141827">
<link rel="canonical" href="${DOMAIN}/${pretty(page)}">
${alternates.map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${DOMAIN}/${pretty(p)}">`).join("\n")}
<link rel="icon" href="${icon}" type="image/svg+xml">
${FONTS}
<style>${css}</style>
</head>`;

copy("docs/brand/icon.svg", "icon.svg");

// ---------------------------------------------------------------- landing page

const doc = JSON.parse(readFileSync(join(SITE, "design", "landing.paprika.json"), "utf8"));
const LINK = /^link:(.+)$/;

function renderNode(node, asRoot) {
  const css = nodeStyle(doc, node, { asRoot });
  if (asRoot) {
    // The design is drawn at a fixed width; on the web the root follows the viewport.
    css.position = "relative";
    css.width = "100%";
    delete css.height;
    delete css.left;
    delete css.top;
    css.minHeight = "100vh";
  }
  const link = LINK.exec(node.name ?? "");
  const attrs = `data-paprika-id="${escapeHtml(node.id)}" style="${escapeHtml(cssToString(css))}"`;
  let inner = "";
  switch (node.type) {
    case "frame":
      inner = node.children.map((c) => doc.nodes[c]).filter(Boolean).map((c) => renderNode(c, false)).join("");
      break;
    case "text":
      inner = escapeHtml(node.text);
      break;
    case "image":
      return `<img ${attrs} src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}">`;
    case "path": {
      const a = pathAttrs(doc, node);
      const kv = (o) =>
        Object.entries(o)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => ` ${k === "viewBox" ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${escapeHtml(String(v))}"`)
          .join("");
      return `<svg ${attrs} xmlns="http://www.w3.org/2000/svg"${kv(a.svg)}><path${kv(a.path)}/></svg>`;
    }
  }
  if (link) {
    const href = link[1];
    const ext = /^https?:/.test(href) ? ' rel="noopener"' : "";
    return `<a ${attrs} href="${escapeHtml(href)}"${ext}>${inner}</a>`;
  }
  return `<div ${attrs}>${inner}</div>`;
}

const landingCss = `html,body{margin:0;padding:0;background:#141827}
body{font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;color-scheme:dark}
a{text-decoration:none;color:inherit;cursor:pointer}
a:hover{filter:brightness(1.15)}
a:focus-visible{outline:2px solid #4cc7d8;outline-offset:3px;border-radius:6px}
.lp-mobile{display:none}
@media (max-width:${MOBILE_MAX}px){.lp-desktop{display:none}.lp-mobile{display:block}}`;

const landing = [
  { lang: "en", page: "index.html", title: "Paprika: the design canvas for AI agents", description: "A local design tool for AI agents with a built-in MCP server. Open source, MIT." },
  { lang: "pt-BR", page: "pt-BR/index.html", title: "Paprika: o canvas de design para agentes de IA", description: "Ferramenta de design local para agentes de IA, com servidor MCP embutido. Código aberto, MIT." },
];
for (const l of landing) {
  const desktop = doc.nodes[`lp-desktop-${l.lang}`];
  const mobile = doc.nodes[`lp-mobile-${l.lang}`];
  if (!desktop || !mobile) throw new Error(`landing frames for ${l.lang} are missing; run scripts/draw-landing.mjs`);
  const html =
    head({
      ...l,
      alternates: landing.map((x) => [x.lang, x.page]),
      icon: rel(l.page, "icon.svg"),
      css: landingCss,
    }) +
    `<body><div class="lp-desktop">${renderNode(desktop, true)}</div><div class="lp-mobile">${renderNode(mobile, true)}</div></body></html>\n`;
  write(l.page, html);
}

// ---------------------------------------------------------------- docs

/** [source file, output page, sidebar title]. Same order and keys in both languages. */
const DOCS = {
  en: [
    ["README.md", "docs/index.html", "Overview"],
    ["docs/canvas.md", "docs/canvas.html", "Using the canvas"],
    ["docs/mcp.md", "docs/mcp.html", "Agents and MCP"],
    ["docs/docker.md", "docs/docker.html", "Docker"],
    ["docs/development.md", "docs/development.html", "Development"],
    ["docs/architecture.md", "docs/architecture.html", "Architecture"],
    ["server-go/README.md", "docs/go-server.html", "Go server (SQLite)"],
    ["docs/ci.md", "docs/ci.html", "CI"],
    ["docs/backlog.md", "docs/backlog.html", "Backlog"],
    ["docs/agent-feedback.md", "docs/agent-feedback.html", "Agent feedback"],
    ["docs/adr/0001-go-server-sqlite.md", "docs/adr/0001-go-server-sqlite.html", "ADR 0001: Go server + SQLite"],
    ["docs/adr/0002-canvas-renderer-rust-wasm.md", "docs/adr/0002-canvas-renderer-rust-wasm.html", "ADR 0002: Rust/WASM renderer"],
    ["CONTRIBUTING.md", "docs/contributing.html", "Contributing"],
    ["SECURITY.md", "docs/security.html", "Security"],
    ["CODE_OF_CONDUCT.md", "docs/code-of-conduct.html", "Code of Conduct"],
  ],
  "pt-BR": [
    ["README.pt-BR.md", "docs/pt-BR/index.html", "Visão geral"],
    ["docs/pt-BR/canvas.md", "docs/pt-BR/canvas.html", "Usando o canvas"],
    ["docs/pt-BR/mcp.md", "docs/pt-BR/mcp.html", "Agentes e MCP"],
    ["docs/pt-BR/docker.md", "docs/pt-BR/docker.html", "Docker"],
    ["docs/pt-BR/desenvolvimento.md", "docs/pt-BR/desenvolvimento.html", "Desenvolvimento"],
    ["docs/pt-BR/arquitetura.md", "docs/pt-BR/arquitetura.html", "Arquitetura"],
    ["server-go/README.pt-BR.md", "docs/pt-BR/servidor-go.html", "Servidor Go (SQLite)"],
    ["docs/pt-BR/ci.md", "docs/pt-BR/ci.html", "CI"],
    ["docs/pt-BR/backlog.md", "docs/pt-BR/backlog.html", "Backlog"],
    ["docs/pt-BR/feedback-agentes.md", "docs/pt-BR/feedback-agentes.html", "Feedback de agentes"],
    ["docs/pt-BR/adr/0001-servidor-go-sqlite.md", "docs/pt-BR/adr/0001-servidor-go-sqlite.html", "ADR 0001: servidor Go + SQLite"],
    ["docs/pt-BR/adr/0002-renderizador-canvas-rust-wasm.md", "docs/pt-BR/adr/0002-renderizador-canvas-rust-wasm.html", "ADR 0002: renderizador Rust/WASM"],
    ["CONTRIBUTING.pt-BR.md", "docs/pt-BR/contribuindo.html", "Como contribuir"],
    ["SECURITY.pt-BR.md", "docs/pt-BR/seguranca.html", "Segurança"],
    ["CODE_OF_CONDUCT.pt-BR.md", "docs/pt-BR/codigo-de-conduta.html", "Código de Conduta"],
  ],
};
const UI = {
  en: { home: "./", other: "pt-BR", otherLabel: "Português", docs: "Docs", edit: "Edit this page on GitHub", landing: "index.html" },
  "pt-BR": { home: "pt-BR/", other: "en", otherLabel: "English", docs: "Docs", edit: "Editar esta página no GitHub", landing: "pt-BR/index.html" },
};

/** Source path → output page, for both languages. */
const pageOf = new Map(Object.values(DOCS).flat().map(([src, out]) => [src, out]));

const slug = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

function rewriteHref(href, src, page) {
  if (!href || /^(?:[a-z]+:|#|\/\/)/i.test(href)) return href;
  const [path, hash = ""] = href.split("#");
  const target = posix.normalize(posix.join(posix.dirname(src), path));
  const anchor = hash ? `#${hash}` : "";
  const out = pageOf.get(target);
  if (out) return rel(page, pretty(out) || "./") + anchor;
  if (target.startsWith("..")) return href;
  // Anything else in the repo opens on GitHub.
  const isDir = existsSync(join(ROOT, target)) && statSync(join(ROOT, target)).isDirectory();
  return `${REPO}/${isDir ? "tree" : "blob"}/main/${target}${anchor}`;
}

function rewriteImage(href, src, page) {
  if (!href || /^(?:[a-z]+:|\/\/)/i.test(href)) return href;
  const target = posix.normalize(posix.join(posix.dirname(src), href));
  if (!existsSync(join(ROOT, target))) return `${REPO}/raw/main/${target}`;
  copy(target, `assets/${target}`);
  return rel(page, `assets/${target}`);
}

function renderMarkdown(md, src, page) {
  const marked = new Marked({ gfm: true });
  const used = new Map();
  marked.use({
    walkTokens(t) {
      if (t.type === "link") t.href = rewriteHref(t.href, src, page);
      if (t.type === "image") t.href = rewriteImage(t.href, src, page);
      if (t.type === "html") {
        t.text = t.text.replace(/\b(src|href)="([^"]+)"/g, (_, attr, v) =>
          `${attr}="${escapeHtml(attr === "src" ? rewriteImage(v, src, page) : rewriteHref(v, src, page))}"`,
        );
        t.raw = t.text;
      }
    },
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        // Slug from the plain text, so markup never reaches the id.
        let id = slug(this.parser.parseInline(tokens, this.parser.textRenderer)) || `section`;
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
      },
    },
  });
  return marked.parse(md);
}

const docsCss = `:root{--bg:#141827;--bg-2:#181d2e;--panel:#1e2336;--code:#10131f;--line:#2c3350;--text:#eef0f7;--muted:#a6acc4;--accent:#e04a2b;--accent-ink:#ff9a7c;--link:#7fd6e2;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--link)}
a:focus-visible{outline:2px solid var(--link);outline-offset:2px;border-radius:4px}
.top{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;background:rgba(20,24,39,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-weight:700;font-size:18px}
.brand img{width:30px;height:30px;border-radius:8px}
.top nav{display:flex;gap:20px;font-weight:500}
.top nav a{color:var(--muted);text-decoration:none}
.top nav a:hover{color:var(--text)}
.wrap{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1240px;margin:0 auto}
aside{position:sticky;top:59px;align-self:start;max-height:calc(100vh - 59px);overflow:auto;padding:28px 16px 28px 24px;border-right:1px solid var(--line)}
aside ul{list-style:none;margin:0;padding:0}
aside a{display:block;padding:6px 10px;border-radius:8px;color:var(--muted);text-decoration:none;font-size:14.5px}
aside a:hover{color:var(--text);background:var(--panel)}
aside a[aria-current]{color:var(--text);background:var(--panel);box-shadow:inset 3px 0 0 var(--accent)}
main{padding:32px 48px 80px;min-width:0}
main h1{font-size:40px;line-height:1.15;letter-spacing:-.8px;margin:8px 0 20px}
main h2{font-size:27px;line-height:1.25;margin:44px 0 14px;padding-top:8px;border-top:1px solid var(--line)}
main h3{font-size:20px;margin:30px 0 10px}
main h1 .anchor,main h2 .anchor,main h3 .anchor,main h4 .anchor{float:left;margin-left:-1em;padding-right:.25em;color:var(--muted);text-decoration:none;opacity:0}
main :is(h1,h2,h3,h4):hover .anchor{opacity:1}
main p,main li{color:#d9dcea}
main code{font:.88em/1.5 "JetBrains Mono",ui-monospace,monospace;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:.1em .35em}
main pre{background:var(--code);border:1px solid var(--line);border-radius:12px;padding:18px 20px;overflow:auto}
main pre code{background:none;border:0;padding:0;font-size:14px;line-height:1.7}
main table{border-collapse:collapse;display:block;overflow:auto;margin:18px 0;font-size:15px}
main th,main td{border:1px solid var(--line);padding:8px 12px;text-align:left;vertical-align:top}
main th{background:var(--panel)}
main blockquote{margin:18px 0;padding:10px 18px;border-left:3px solid var(--accent);background:var(--bg-2);border-radius:0 10px 10px 0}
main blockquote p{color:var(--muted)}
main img{max-width:100%}
main hr{border:0;border-top:1px solid var(--line);margin:32px 0}
.edit{margin-top:48px;font-size:14px}
.edit a{color:var(--muted)}
@media (max-width:860px){.wrap{grid-template-columns:1fr}aside{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--line);padding:16px}aside ul{display:flex;flex-wrap:wrap;gap:4px}main{padding:24px 18px 64px}main h1{font-size:32px}.top{padding:12px 16px}.top nav{gap:14px}}`;

for (const [lang, entries] of Object.entries(DOCS)) {
  const ui = UI[lang];
  const otherEntries = DOCS[ui.other];
  entries.forEach(([src, page, title], i) => {
    const md = readFileSync(join(ROOT, src), "utf8")
      // The language switch lives in the header.
      .replace(/^.*(?:English|Português)\s*\|.*\n+/m, "");
    const body = renderMarkdown(md, src, page);
    const h1 = /^#[ \t]*([^\n]+?)[ \t]*$/m.exec(md)?.[1] ?? title;
    const counterpart = otherEntries[i][1];
    const sidebar = entries
      .map(([, p, t]) => `<li><a href="${rel(page, pretty(p) || "./")}"${p === page ? ' aria-current="page"' : ""}>${escapeHtml(t)}</a></li>`)
      .join("");
    const html =
      head({
        lang,
        title: page.endsWith("index.html") ? `Paprika docs` : `${h1.replace(/[`*]/g, "")} · Paprika docs`,
        description: lang === "en" ? "Paprika documentation: a local design tool for AI agents with a built-in MCP server." : "Documentação do Paprika: ferramenta de design local para agentes de IA, com servidor MCP embutido.",
        page,
        alternates: [
          [lang, page],
          [ui.other, counterpart],
        ],
        icon: rel(page, "icon.svg"),
        css: docsCss,
      }) +
      `<body>
<header class="top"><a class="brand" href="${rel(page, ui.home)}"><img src="${rel(page, "icon.svg")}" alt="">Paprika</a>
<nav><a href="${rel(page, pretty(entries[0][1]))}">${ui.docs}</a><a href="${REPO}" rel="noopener">GitHub</a><a href="${rel(page, pretty(counterpart) || "./")}" hreflang="${ui.other}">${ui.otherLabel}</a></nav></header>
<div class="wrap"><aside><ul>${sidebar}</ul></aside>
<main>${body}<p class="edit"><a href="${REPO}/edit/main/${src}" rel="noopener">${ui.edit}</a></p></main></div>
</body></html>\n`;
    write(page, html);
  });
}

// ---------------------------------------------------------------- extras

write(
  "404.html",
  head({ lang: "en", title: "Not found · Paprika", description: "Page not found.", page: "404.html", alternates: [], icon: "/icon.svg", css: docsCss }) +
    `<body><header class="top"><a class="brand" href="/"><img src="/icon.svg" alt="">Paprika</a><nav><a href="/docs/">Docs</a><a href="${REPO}">GitHub</a></nav></header><main><h1>Page not found</h1><p><a href="/">Back to the home page</a> · <a href="/docs/">Docs</a></p></main></body></html>\n`,
);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${DOMAIN}/sitemap.xml\n`);
const pages = [...landing.map((l) => l.page), ...Object.values(DOCS).flat().map(([, p]) => p)];
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `  <url><loc>${DOMAIN}/${pretty(p)}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);

console.log(`site: ${pages.length} pages in ${relative(ROOT, OUT)}`);
