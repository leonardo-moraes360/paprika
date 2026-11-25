import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { Marked, type Tokens } from "marked";
import { createHighlighter } from "shiki";
import { ENTRIES } from "../docs.config";
import { REPO, href, rel } from "./paths";

import { ROOT } from "./root";
export { ROOT };

export interface Heading {
  depth: number;
  id: string;
  text: string;
}

const pageOf = new Map<string, string>([
  ["README.md", "docs/index.html"],
  ["docs/pt-BR/README.md", "docs/pt-BR/index.html"],
  ...ENTRIES.flatMap((e) => [
    [e.src.en, e.out.en] as [string, string],
    [e.src["pt-BR"], e.out["pt-BR"]] as [string, string],
  ]).filter(([s]) => s),
]);

const LANGS = ["bash", "sh", "shell", "json", "yaml", "ts", "tsx", "js", "javascript", "typescript", "go", "rust", "toml", "html", "css", "text", "dockerfile", "diff", "sql", "markdown", "jsx"];
const highlighter = await createHighlighter({ themes: ["github-dark-default"], langs: LANGS });

const assets = new Set<string>();
export const assetFiles = () => [...assets];

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function rewriteHref(link: string, src: string, page: string): string {
  if (!link || /^(?:[a-z]+:|#|\/\/)/i.test(link)) return link;
  const [path, hash = ""] = link.split("#");
  const target = posix.normalize(posix.join(posix.dirname(src), path));
  const anchor = hash ? `#${hash}` : "";
  const out = pageOf.get(target);
  if (out) return href(page, out) + anchor;
  if (target.startsWith("..")) return link;
  const abs = join(ROOT, target);
  const isDir = existsSync(abs) && statSync(abs).isDirectory();
  return `${REPO}/${isDir ? "tree" : "blob"}/main/${target}${anchor}`;
}

function rewriteImage(link: string, src: string, page: string): string {
  if (!link || /^(?:[a-z]+:|\/\/)/i.test(link)) return link;
  const target = posix.normalize(posix.join(posix.dirname(src), link));
  if (!existsSync(join(ROOT, target))) return `${REPO}/raw/main/${target}`;
  assets.add(target);
  return rel(page, `assets/${target}`);
}

export interface RenderedDoc {
  html: string;
  title: string;
  headings: Heading[];
}

export function renderDoc(src: string, page: string, lang: "en" | "pt-BR"): RenderedDoc {
  const md = readFileSync(join(ROOT, src), "utf8").replace(/^.*(?:English|Português)\s*\|.*\n+/m, "").replace(/^\[.*Português\]\(.*\)\s*\n+/m, "")
    .replace(/^(?:Português|English|Inglês):\s*\[[^\]]*\]\([^)]*\)\.?\s*\n+/gm, "");
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  let title = "";
  const marked = new Marked({ gfm: true });
  marked.use({
    walkTokens(t) {
      if (t.type === "link") (t as Tokens.Link).href = rewriteHref((t as Tokens.Link).href, src, page);
      if (t.type === "image") (t as Tokens.Image).href = rewriteImage((t as Tokens.Image).href, src, page);
      if (t.type === "html") {
        const h = t as Tokens.HTML;
        h.text = h.text.replace(/\b(src|href)="([^"]+)"/g, (_, attr: string, v: string) =>
          `${attr}="${escapeHtml(attr === "src" ? rewriteImage(v, src, page) : rewriteHref(v, src, page))}"`,
        );
        h.raw = h.text;
      }
    },
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = this.parser.parseInline(tokens, this.parser.textRenderer);
        let id = slug(text) || "section";
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth === 1 && !title) {
          title = text;
          return `<h1 id="${id}">${html}</h1>\n`;
        }
        if (depth <= 3) headings.push({ depth, id, text });
        const label = lang === "pt-BR" ? `Link para a seção “${text}”` : `Link to the “${text}” section`;
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="${escapeHtml(label)}">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang: codeLang }) {
        const l = (codeLang ?? "").split(/\s/)[0].toLowerCase();
        const known = LANGS.includes(l) ? l : "text";
        const body = highlighter.codeToHtml(text, {
          lang: known,
          theme: "github-dark-default",
        });
        const copy = lang === "pt-BR" ? "Copiar" : "Copy";
        return `<figure class="code"><figcaption data-pagefind-ignore><span>${escapeHtml(l || "text")}</span><button type="button" class="copy" data-copied="${lang === "pt-BR" ? "Copiado" : "Copied"}">${copy}</button></figcaption>${body}</figure>\n`;
      },
    },
  });
  const html = (marked.parse(md, { async: false }) as string).replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>");
  return { html, title, headings };
}
