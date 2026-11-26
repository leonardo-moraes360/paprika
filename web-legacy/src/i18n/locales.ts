export const LOCALES = ["en", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "paprika.locale";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function detectLocale(languages: readonly string[] = typeof navigator !== "undefined" ? navigator.languages : ["en"]): Locale {
  for (const raw of languages) {
    const tag = raw.toLowerCase();
    if (tag === "pt" || tag.startsWith("pt-")) return "pt-BR";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "en";
}

export function readStoredLocale(storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null): Locale | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCALE_STORAGE_KEY);
    return raw && isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale, storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null): void {
  if (!storage) return;
  const safe = LOCALES.find((item) => item === locale);
  if (!safe) return;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, safe);
  } catch {
  }
}

export function resolveLocale(
  storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null,
  languages?: readonly string[],
): Locale {
  return readStoredLocale(storage) ?? detectLocale(languages);
}
