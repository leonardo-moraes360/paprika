// Static site (SSG) for paprika.js.org: the landing page and the docs, in English and Brazilian
// Portuguese. The docs are the repository's own Markdown files (src/content.config.ts); search is
// Pagefind, indexed after the build (`pnpm --filter @paprika/site site:build`).
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "@astrojs/markdown-remark";
import { defineConfig } from "astro/config";
import { ROOT, rehypeCodeFrames, remarkRepoLinks } from "./src/markdown.ts";

const TYPES = { ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** Serves repository images referenced by the docs under /doc-assets/ (dev) and copies them into the build. */
const docAssets = {
  name: "paprika-doc-assets",
  hooks: {
    "astro:server:setup": ({ server }) => {
      server.middlewares.use("/doc-assets/", (req, res, next) => {
        const file = join(ROOT, decodeURIComponent((req.url ?? "").split("?")[0]));
        if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    // The Markdown is cached between builds (the remark plugin may not run), so the images to copy
    // are read back from the built pages.
    "astro:build:done": ({ dir, pages }) => {
      const out = fileURLToPath(dir);
      const used = new Set();
      for (const { pathname } of pages) {
        const html = join(out, pathname, "index.html");
        if (!existsSync(html)) continue;
        for (const m of readFileSync(html, "utf8").matchAll(/\/doc-assets\/([^"'?#\s)]+)/g)) used.add(decodeURIComponent(m[1]));
      }
      for (const rel of used) {
        const from = join(ROOT, rel);
        if (!from.startsWith(ROOT) || !existsSync(from)) throw new Error(`doc asset not found: ${rel}`);
        const to = join(out, "doc-assets", rel);
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
    },
  },
};

export default defineConfig({
  site: process.env.PAPRIKA_SITE_URL ?? "https://paprika.js.org",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  i18n: { locales: ["en", "pt-BR"], defaultLocale: "en", routing: { prefixDefaultLocale: false } },
  markdown: {
    shikiConfig: { theme: "github-dark-default" },
    processor: unified({ remarkPlugins: [remarkRepoLinks], rehypePlugins: [rehypeCodeFrames] }),
  },
  integrations: [docAssets],
  vite: { server: { fs: { allow: [ROOT] } }, build: { assetsInlineLimit: 0 } },
});
