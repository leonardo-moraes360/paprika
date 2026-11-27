import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EditorHeader, type EditorHeaderCrumb } from "@/components/frontends/editor-header";
import { resolvePageId } from "@/adapters/pages";
import { parseTeamChip, teamChipKey } from "@/adapters/team-chip";
import { useLive } from "@/data/live";
import { useOpenPins } from "@/data/queries/open-pins";
import { useThemePreference } from "@/lib/use-theme-preference";
import { useEditor, useEditorActions } from "../editor-store";
import { useActiveAgents } from "../use-active-agents";

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
 * Path (workspaces, this workspace, this page), the counters of open pins and active agents (numbers from the state:
 * the panels are other regions, the chips only open or close their flags), the team chip when there is a team, the
 * connection, the language and the theme.
 */
export function Header() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const editor = useEditorActions();
  const workspaceId = useLive((s) => s.doc?.id ?? "");
  const name = useLive((s) => s.doc?.name ?? "");
  const connected = useLive((s) => s.connected);
  const pinsRev = useLive((s) => s.pinsRev);
  const teamKey = useLive((s) => teamChipKey(s.team));
  const agents = useActiveAgents((a) => a.count);
  const agentsOpen = useEditor((s) => s.dialogs.agents);
  const pageName = usePageName();
  const pins = useOpenPins(workspaceId, pinsRev).data ?? 0;
  const [theme, setTheme] = useThemePreference();

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

  const team = useMemo(() => parseTeamChip(teamKey), [teamKey]);

  return (
    <EditorHeader
      path={path}
      pins={pins}
      onPinsClick={() => editor.toggleDialog("pins")}
      agents={agents}
      agentsOpen={agentsOpen}
      onAgentsClick={() => editor.toggleDialog("agents")}
      team={team}
      onTeamClick={() => {
        editor.setRightTab("team");
        editor.openDialog("team");
      }}
      connected={connected}
      connectionLabel={connected ? t("app.shell.mcpOn") : undefined}
      language={i18n.resolvedLanguage ?? "en"}
      onLanguageChange={(language) => void i18n.changeLanguage(language)}
      theme={theme}
      onThemeChange={setTheme}
    />
  );
}
