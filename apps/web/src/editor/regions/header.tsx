import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EditorHeader, type EditorHeaderCrumb } from "@/components/frontends/editor-header";
import { resolvePageId } from "@/adapters/pages";
import { useLive } from "@/data/live";
import { useThemePreference } from "@/lib/use-theme-preference";
import { useAssignPresenceTones } from "../collab";
import { useEditor } from "../editor-store";
import { useAgentsHeader } from "./agents";
import { usePinsHeader } from "./pins";
import { useTeamHeader } from "./team";

/** Name of the page in view (`""` without pages): a leaf of the path, it changes only when that page is renamed or another one is opened. */
function usePageName() {
  const chosen = useEditor((s) => s.pageId);
  return useLive((s) => {
    const id = resolvePageId(s.doc, chosen);
    const page = id ? s.doc?.nodes[id] : undefined;
    return page?.type === "page" ? page.name || page.id : "";
  });
}

/**
 * Path (workspaces, this workspace, this page), the pins and the team chip, the roster of the agents (its own region
 * inside the header: it counts the active ones on a clock of its own), the connection, the language and the theme.
 * Each number has ONE source: the pins and the team come from the hooks of their regions, the agents from the roster.
 */
export function Header() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const name = useLive((s) => s.doc?.name ?? "");
  const connected = useLive((s) => s.connected);
  const pageName = usePageName();
  const { agents, renderAgents } = useAgentsHeader();
  const { pins, onPinsClick } = usePinsHeader();
  const { team, onTeamClick } = useTeamHeader();
  const [theme, setTheme] = useThemePreference();
  useAssignPresenceTones();

  const path = useMemo<EditorHeaderCrumb[]>(() => {
    const crumbs: EditorHeaderCrumb[] = [
      {
        label: t("app.workspaces"),
        href: "/",
        onSelect: (event) => {
          event.preventDefault();
          void navigate({ to: "/" });
        },
      },
      { label: name || t("app.untitled") },
    ];
    if (pageName) crumbs.push({ label: pageName });
    return crumbs;
  }, [t, name, pageName, navigate]);

  return (
    <EditorHeader
      path={path}
      pins={pins}
      onPinsClick={onPinsClick}
      agents={connected ? agents : 0}
      renderAgents={renderAgents}
      team={team}
      onTeamClick={onTeamClick}
      connected={connected}
      connectionLabel={connected ? t("app.shell.mcpOn") : undefined}
      language={i18n.resolvedLanguage ?? "en"}
      onLanguageChange={(language) => void i18n.changeLanguage(language)}
      theme={theme}
      onThemeChange={setTheme}
    />
  );
}
