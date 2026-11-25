import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { defaultPageName, defaultUntitledName, type NameLocale } from "@paprika/core";
import { catalogs, type Messages } from "./messages";
import { LOCALES, type Locale } from "./locales";
import { getLocale, setLocale, subscribeLocale, t } from "./store";

export type { Locale, Messages };
export { LOCALES, detectLocale, isLocale, LOCALE_STORAGE_KEY, resolveLocale } from "./locales";
export { getLocale, getMessages, setLocale, t } from "./store";

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void; m: Messages } | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  const value = useMemo(() => ({ locale, setLocale, m: catalogs[locale] }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale outside LocaleProvider");
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}

export function useT(): Messages {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT outside LocaleProvider");
  return ctx.m;
}

export function pageNameFor(n: number, locale: Locale = getLocale()): string {
  return defaultPageName(n, locale as NameLocale);
}

export function untitledFor(locale: Locale = getLocale()): string {
  return defaultUntitledName(locale as NameLocale);
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale: set } = useLocale();
  const m = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className={className} data-testid="language-switcher">
      <label className="sr-only" htmlFor="paprika-locale">
        {m.switchLanguage}
      </label>
      <select
        id="paprika-locale"
        className="h-7 cursor-pointer rounded-md border border-ui-border bg-ui-secondary px-1.5 text-xs text-ui-foreground"
        aria-label={m.switchLanguage}
        value={locale}
        onChange={(e) => {
          set(e.target.value as Locale);
          setOpen(false);
        }}
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        data-open={open || undefined}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {l === "en" ? m.languageEn : m.languagePt}
          </option>
        ))}
      </select>
    </div>
  );
}
