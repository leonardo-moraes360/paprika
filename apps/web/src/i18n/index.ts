import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { defaultLanguage, languages, resources } from "./resources";

/** The old app kept the language under `paprika.locale`: read it once as the starting value when i18next has none yet. */
export function adoptLegacyLocale(storage: Pick<Storage, "getItem" | "setItem">) {
  try {
    if (storage.getItem("i18nextLng") !== null) return;
    const legacy = storage.getItem("paprika.locale");
    if (legacy !== null && (languages as readonly string[]).includes(legacy)) storage.setItem("i18nextLng", legacy);
  } catch {
    return;
  }
}

if (!i18n.isInitialized) {
  if (typeof window !== "undefined") {
    try {
      adoptLegacyLocale(window.localStorage);
    } catch {
      // storage can be blocked
    }
  }
  const instance = typeof window === "undefined" ? i18n : i18n.use(LanguageDetector);
  void instance.use(initReactI18next).init({
    resources,
    fallbackLng: defaultLanguage,
    supportedLngs: [...languages],
    initAsync: false,
    interpolation: { escapeValue: false },
    detection: { order: ["localStorage", "navigator"], caches: ["localStorage"] },
  });
}

export default i18n;
