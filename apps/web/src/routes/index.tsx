import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { languages } from "@/i18n/resources";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { t, i18n } = useTranslation();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-6 px-4">
      <h1 className="text-4xl font-semibold tracking-tight">{t("home.title")}</h1>
      <p className="text-muted-foreground">{t("home.tagline")}</p>
      <Button>
        {t("home.start")}
        <ArrowRight aria-hidden="true" />
      </Button>
      <div className="flex items-center gap-2">
        <Languages aria-hidden="true" className="size-4 text-muted-foreground" />
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
    </main>
  );
}
