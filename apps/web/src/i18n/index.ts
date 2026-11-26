import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { defaultLanguage, languages, resources } from "./resources";

if (!i18n.isInitialized) {
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
