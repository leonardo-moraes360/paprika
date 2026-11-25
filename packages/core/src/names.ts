export type NameLocale = "en" | "pt-BR";

export function defaultPageName(index: number, locale: NameLocale = "en"): string {
  return locale === "pt-BR" ? `Página ${index}` : `Page ${index}`;
}

export function defaultUntitledName(locale: NameLocale = "en"): string {
  return locale === "pt-BR" ? "Sem título" : "Untitled";
}
