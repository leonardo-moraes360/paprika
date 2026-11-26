import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Languages } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/segmented-control";
import { ThemeSwitch } from "@/components/theme-switch";
import { languages } from "@/i18n/resources";
import { readThemePreference, setThemePreference, type ThemePreference } from "@/lib/theme";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-6 px-4">
      <h1 className="text-3xl font-semibold tracking-tight">{t("home.title")}</h1>
      <p className="text-muted">{t("home.tagline")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button>
          {t("home.start")}
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button variant="secondary" render={<Link to="/components" />}>
          {t("home.components")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Languages aria-hidden="true" className="size-4 text-muted" />
          <SegmentedControl
            aria-label={t("language.label")}
            value={i18n.resolvedLanguage ?? null}
            onValueChange={(value) => {
              if (value) void i18n.changeLanguage(value);
            }}
          >
            {languages.map((l) => (
              <SegmentedControlItem key={l} value={l}>
                {t(`language.${l}`)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        <ThemeSwitch
          value={theme}
          onValueChange={(next) => {
            setTheme(next);
            setThemePreference(next);
          }}
          labels={{ label: t("theme.label"), system: t("theme.system"), light: t("theme.light"), dark: t("theme.dark") }}
        />
      </div>
    </main>
  );
}
