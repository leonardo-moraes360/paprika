// Markdown plugins for the docs, which are the repository's own .md files:
// - remarkRepoLinks drops everything above the first `# ` heading (language banner, README art),
//   points links between docs at their pages, any other repository path at GitHub, and images at
//   /doc-assets/<path> (served and copied into the build by the doc-assets integration in astro.config.mjs);
// - rehypeCodeFrames wraps each highlighted code block in a frame with its language and a Copy button.
import { existsSync, statSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { FILE_TO_PAGE, REPO, docHref } from "./docs.ts";

// The repository root: the folder with pnpm-workspace.yaml above the working directory. Not taken
// from import.meta.url, which points into the build output once Astro bundles this module.
function findRoot(dir: string): string {
  if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
  const up = dirname(dir);
  if (up === dir) throw new Error("repository root (pnpm-workspace.yaml) not found above the working directory");
  return findRoot(up);
}
export const ROOT = findRoot(process.cwd());

type Node = { type: string; children?: Node[]; [k: string]: any };

const external = (href: string) => /^(?:[a-z][a-z0-9+.-]*:|#|\/\/|\/)/i.test(href);

function walk(node: Node, fn: (n: Node) => void) {
  fn(node);
  node.children?.forEach((c) => walk(c, fn));
}

export function resolveHref(href: string, from: string): string {
  if (!href || external(href)) return href;
  const [path = "", hash] = href.split("#");
  const anchor = hash ? `#${hash}` : "";
  const target = posix.normalize(posix.join(posix.dirname(from), decodeURI(path)));
  const page = FILE_TO_PAGE.get(target);
  if (page) return docHref(page[0], page[1]) + anchor;
  if (target.startsWith("..")) return href;
  const abs = join(ROOT, target);
  const isDir = existsSync(abs) && statSync(abs).isDirectory();
  return `${REPO}/${isDir ? "tree" : "blob"}/main/${target}${anchor}`;
}

export function resolveSrc(src: string, from: string): string {
  if (!src || external(src)) return src;
  const target = posix.normalize(posix.join(posix.dirname(from), decodeURI(src)));
  if (!existsSync(join(ROOT, target))) return `${REPO}/raw/main/${target}`;
  return `/doc-assets/${target}`;
}

const repoPath = (file: { path?: string; history?: string[] }) => {
  const p = file.path ?? file.history?.[0];
  return p ? relative(ROOT, p).split("\\").join("/") : null;
};

export function remarkRepoLinks() {
  return (tree: Node, file: { path?: string; history?: string[] }) => {
    const from = repoPath(file);
    if (!from || from.startsWith("..")) return;
    const first = tree.children!.findIndex((n) => n.type === "heading" && n.depth === 1);
    if (first > 0) tree.children!.splice(0, first);
    // "Português: [link]" / "English: [link]" lines point at the other language: the site has a switch for that.
    const languageLine = (n: Node) => {
      if (n.type !== "paragraph" || !n.children?.length) return false;
      const [a, b] = n.children;
      if (n.children.length === 1 && a?.type === "link") return /^(?:Português|English)$/.test(a.children?.[0]?.value ?? "");
      return a?.type === "text" && /^\s*(?:Português|English):\s*$/.test(a.value) && n.children.length <= 3 && b?.type === "link";
    };
    tree.children = tree.children!.filter((n) => !languageLine(n) && !(n.type === "blockquote" && n.children?.length === 1 && languageLine(n.children[0]!)));
    walk(tree, (n) => {
      if (n.type === "link" || n.type === "definition") n.url = resolveHref(n.url, from);
      if (n.type === "image") n.url = resolveSrc(n.url, from);
      if (n.type === "html")
        n.value = String(n.value).replace(/\b(src|href)="([^"]+)"/g, (_: string, attr: string, v: string) =>
          `${attr}="${attr === "src" ? resolveSrc(v, from) : resolveHref(v, from)}"`,
        );
    });
  };
}

const text = (value: string): Node => ({ type: "text", value });
const el = (tagName: string, properties: Record<string, unknown>, children: Node[] = []): Node => ({ type: "element", tagName, properties, children });

export function rehypeCodeFrames() {
  return (tree: Node) => {
    walk(tree, (parent) => {
      if (parent.tagName === "figure") return;
      parent.children?.forEach((child, i) => {
        if (child.type !== "element" || child.tagName !== "pre") return;
        const lang = String(child.properties?.dataLanguage ?? "text");
        const label = lang === "plaintext" ? "text" : lang;
        parent.children![i] = el("figure", { className: ["code-frame"] }, [
          el("figcaption", { className: ["code-head"] }, [
            el("span", { className: ["code-lang"] }, [text(label)]),
            el("button", { type: "button", className: ["code-copy"], dataCopy: "" }, [text("Copy")]),
          ]),
          child,
        ]);
      });
    });
  };
}
