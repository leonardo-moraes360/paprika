import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { LANGS, PAGES } from "./docs.ts";

// One entry per Markdown file of the docs, keyed by its path from the repository root.
const docs = defineCollection({
  loader: glob({
    base: "../..",
    pattern: PAGES.flatMap((p) => LANGS.map((l) => p[l].file)),
    generateId: ({ entry }) => entry,
  }),
});

export const collections = { docs };
