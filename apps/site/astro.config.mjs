import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.PAPRIKA_SITE_URL ?? "https://paprika.js.org",
  output: "static",
  outDir: "dist",
  trailingSlash: "ignore",
  build: { format: "preserve", inlineStylesheets: "always" },
  devToolbar: { enabled: false },
  vite: { server: { fs: { allow: ["../.."] } } },
});
