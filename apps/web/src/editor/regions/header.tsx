import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EditorHeader } from "@/components/frontends/editor-header";
import { useLive } from "@/data/live";
import { useThemePreference } from "@/lib/use-theme-preference";

/** Skeleton: path, connection, language and theme. Owner after the foundation: batch 2 (pins, agents and team chips come from batch 4's data). */
export function Header() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const name = useLive((s) => s.doc?.name ?? "");
  const connected = useLive((s) => s.connected);
  const [theme, setTheme] = useThemePreference();
  const path = useMemo(
    () => [
      {
        label: t("app.workspaces"),
        href: "/",
        onSelect: (event: { preventDefault: () => void }) => {
          event.preventDefault();
          void navigate({ to: "/" });
        },
      },
      { label: name || t("app.untitled") },
    ],
    [t, name, navigate],
  );
  return (
    <EditorHeader
      path={path}
      connected={connected}
      language={i18n.resolvedLanguage ?? "en"}
      onLanguageChange={(language) => void i18n.changeLanguage(language)}
      theme={theme}
      onThemeChange={setTheme}
    />
  );
}
