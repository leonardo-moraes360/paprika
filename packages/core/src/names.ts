/** Locales that default page / untitled names understand (web UI + MCP English fallback). */
export type NameLocale = "en" | "pt-BR";

/** Default page label for a 1-based index (`Page 1` / `Página 1`). Agent/MCP path uses `en`. */
export function defaultPageName(index: number, locale: NameLocale = "en"): string {
  return locale === "pt-BR" ? `Página ${index}` : `Page ${index}`;
}

/** Blank workspace / document name (`Untitled` / `Sem título`). Agent/HTTP path uses `en`. */
export function defaultUntitledName(locale: NameLocale = "en"): string {
  return locale === "pt-BR" ? "Sem título" : "Untitled";
}
