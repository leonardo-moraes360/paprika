import { ENTRIES } from "../docs.config";
import { pretty } from "../lib/paths";

export function GET({ site }: { site?: URL }) {
  const base = (site?.href ?? "https://paprika.js.org/").replace(/\/$/, "");
  const pages = ["index.html", "pt-BR/index.html", ...ENTRIES.flatMap((e) => [e.out.en, e.out["pt-BR"]])];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${base}/${pretty(p)}</loc></url>`).join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml" } });
}
