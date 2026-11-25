import data from "./docs.json";

export type Lang = "en" | "pt-BR";

export interface DocEntry {
  slug: string;
  title: Record<Lang, string>;
  src: Record<Lang, string>;
  out: Record<Lang, string>;
}

export interface DocGroup {
  title: Record<Lang, string>;
  items: DocEntry[];
}

type Pair = string[];
type RawPage = { title: Pair; src: Pair; out: Pair };

const pair = ([en, pt]: Pair): Record<Lang, string> => ({ en, "pt-BR": pt });

export const HOME: DocEntry = {
  slug: "index",
  title: { en: "Introduction", "pt-BR": "Introdução" },
  src: { en: "", "pt-BR": "" },
  out: { en: "docs/index.html", "pt-BR": "docs/pt-BR/index.html" },
};

const page = (p: RawPage): DocEntry => ({
  slug: p.out[0],
  title: pair(p.title),
  src: pair(p.src),
  out: { en: `docs/${p.out[0]}`, "pt-BR": `docs/pt-BR/${p.out[1]}` },
});

export const GROUPS: DocGroup[] = data.map((g) => ({
  title: pair(g.title),
  items: g.items.map((i) => (i === "home" ? HOME : page(i as RawPage))),
}));

export const ENTRIES: DocEntry[] = GROUPS.flatMap((g) => g.items);
