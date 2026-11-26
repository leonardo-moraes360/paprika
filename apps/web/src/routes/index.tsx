import { createFileRoute } from "@tanstack/react-router";
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import { ArrowRight, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
          className="relative isolate inline-flex gap-1 rounded-md border border-border p-1"
        >
          <SegmentedControlIndicator className="absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-sm bg-muted transition-[top,left,width,height] duration-200 data-[activation-direction=none]:transition-none" />
          {languages.map((l) => (
            <SegmentedControlItem
              key={l}
              value={l}
              className="inline-flex h-8 cursor-pointer items-center rounded-sm px-3 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:text-foreground"
            >
              {t(`language.${l}`)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
    </main>
  );
}
