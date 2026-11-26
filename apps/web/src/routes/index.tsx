import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { languages, type Language } from "@/i18n/resources";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { t, i18n } = useTranslation();
  return (
    <main>
      <h1>{t("home.title")}</h1>
      <p>{t("home.tagline")}</p>
      <button type="button">{t("home.start")}</button>
      <label>
        {t("language.label")}
        <select
          value={i18n.resolvedLanguage}
          onChange={(e) => void i18n.changeLanguage(e.target.value as Language)}
        >
          {languages.map((l) => (
            <option key={l} value={l}>
              {t(`language.${l}`)}
            </option>
          ))}
        </select>
      </label>
    </main>
  );
}
