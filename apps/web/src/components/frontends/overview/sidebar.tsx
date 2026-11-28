import { useFormatForDisplay } from "@tanstack/react-hotkeys";
import { Archive, Briefcase, Globe, Languages, Layers, Network, Plus, Upload } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import { NavItem } from "@/components/ui/nav-item";
import { Profile } from "@/components/ui/profile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchField } from "@/components/ui/search-field";
import { SectionHeader } from "@/components/ui/section-header";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { Tooltip } from "@/components/ui/tooltip";
import { TextField } from "@/components/ui/text-field";
import { cn, focusRing } from "@/lib/utils";
import { sameView } from "./model";
import type { OverviewLanguage, OverviewProfile, OverviewTheme, OverviewView, ProjectEntry, WorkspaceEntry } from "./types";

export type SidebarProps = {
  view: OverviewView;
  workspaces: readonly WorkspaceEntry[];
  projects: readonly ProjectEntry[];
  profile?: OverviewProfile;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onViewChange: (view: OverviewView) => void;
  onOpen: (id: string) => void;
  onCreateProject?: () => void;
  onSubmitProject?: (name: string) => Promise<boolean>;
  onOpenImport?: () => void;
  onOpenProfile?: () => void;
  theme?: OverviewTheme;
  onThemeChange?: (theme: OverviewTheme) => void;
  language?: string;
  languages?: readonly OverviewLanguage[];
  onLanguageChange?: (language: string) => void;
};

export function Sidebar({
  view,
  workspaces,
  projects,
  profile,
  query,
  searchRef,
  onQueryChange,
  onViewChange,
  onOpen,
  onCreateProject,
  onSubmitProject,
  onOpenImport,
  onOpenProfile,
  theme,
  onThemeChange,
  language,
  languages,
  onLanguageChange,
}: SidebarProps) {
  const { t } = useTranslation();
  const formatForDisplay = useFormatForDisplay();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(view.kind === "project" ? [view.id] : []));
  const [projectName, setProjectName] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const plusButton = useRef<HTMLButtonElement>(null);
  const closeProjectForm = () => {
    setProjectName(null);
    requestAnimationFrame(() => plusButton.current?.focus());
  };
  const submitProject = async (event: FormEvent) => {
    event.preventDefault();
    const name = (projectName ?? "").trim();
    if (!onSubmitProject || savingProject) return;
    if (!name) return closeProjectForm();
    setSavingProject(true);
    const ok = await onSubmitProject(name);
    setSavingProject(false);
    if (ok) closeProjectForm();
  };
  const onProjectKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeProjectForm();
  };
  const options: readonly OverviewLanguage[] = languages ?? [
    { value: "en", label: t("language.en"), short: "EN" },
    { value: "pt-BR", label: t("language.pt-BR"), short: "PT" },
  ];
  const short = language === undefined ? "" : (options.find((option) => option.value === language)?.short ?? language.slice(0, 2).toUpperCase());
  const showLanguage = language !== undefined && onLanguageChange !== undefined;
  const showTheme = theme !== undefined && onThemeChange !== undefined;
  const live = workspaces.filter((workspace) => workspace.archived !== true);
  const archivedCount = workspaces.length - live.length;
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside aria-label={t("frontends.overview.sidebar.label")} className="flex w-64 shrink-0 flex-col border-e border-line bg-panel">
      <div className="flex flex-col gap-0.5 px-2.5 pt-3 pb-2">
        <SearchField
          ref={searchRef}
          aria-label={t("frontends.overview.sidebar.search")}
          placeholder={t("frontends.overview.sidebar.search")}
          shortcut={formatForDisplay("Mod+K", { parts: true })}
          clearLabel={t("frontends.overview.sidebar.clearSearch")}
          value={query}
          onValueChange={onQueryChange}
          className="mb-1.5"
        />
        <NavItem
          icon={<Layers />}
          label={t("frontends.overview.sidebar.workspaces")}
          trailing={live.length}
          active={view.kind === "workspaces"}
          onClick={() => onViewChange({ kind: "workspaces" })}
        />
        <NavItem
          icon={<Archive />}
          label={t("frontends.overview.sidebar.archived")}
          trailing={archivedCount}
          active={view.kind === "archived"}
          onClick={() => onViewChange({ kind: "archived" })}
        />
      </div>
      <div className="border-t border-line" />
      <SectionHeader
        title={t("frontends.overview.sidebar.projects")}
        headingLevel={2}
        actions={
          onCreateProject || onSubmitProject ? (
            <Tooltip content={t("frontends.overview.sidebar.newProject")} side="bottom">
              <IconButton
                ref={plusButton}
                size="xs"
                aria-label={t("frontends.overview.sidebar.newProject")}
                onClick={() => {
                  onCreateProject?.();
                  if (onSubmitProject) setProjectName("");
                }}
              >
                <Plus aria-hidden="true" />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
      />
      {projectName !== null ? (
        <form className="px-2.5 pb-2" onSubmit={submitProject} onKeyDown={onProjectKey}>
          <TextField
            autoFocus
            aria-label={t("frontends.overview.sidebar.projectName")}
            placeholder={t("frontends.overview.sidebar.projectName")}
            value={projectName}
            onValueChange={setProjectName}
            maxLength={120}
            autoComplete="off"
            disabled={savingProject}
            className="h-8 text-sm"
          />
        </form>
      ) : null}
      <ScrollArea className="min-h-0 shrink">
        <nav aria-label={t("frontends.overview.sidebar.projectList")} className="flex flex-col gap-0.5 px-2.5 pb-2">
          {projects.map((project) => {
            const inside = live.filter((workspace) => workspace.projectId === project.id);
            const expanded = open.has(project.id);
            return (
              <div key={project.id} className="flex flex-col gap-0.5">
                <NavItem
                  icon={<Briefcase />}
                  label={project.name}
                  trailing={inside.length}
                  expanded={expanded}
                  active={sameView(view, { kind: "project", id: project.id })}
                  onClick={() => {
                    toggle(project.id);
                    onViewChange({ kind: "project", id: project.id });
                  }}
                />
                {expanded
                  ? inside.map((workspace) => (
                      <NavItem key={workspace.id} level={1} icon={<Layers />} label={workspace.name} onClick={() => onOpen(workspace.id)} />
                    ))
                  : null}
              </div>
            );
          })}
        </nav>
      </ScrollArea>
      <div className="border-t border-line" />
      <SectionHeader title={t("frontends.overview.sidebar.community")} headingLevel={2} />
      <div className="flex flex-col gap-0.5 px-2.5 pb-2">
        <NavItem icon={<Globe />} label={t("frontends.overview.sidebar.explore")} trailing={t("frontends.overview.sidebar.soon")} disabled />
        <NavItem icon={<Network />} label={t("frontends.overview.sidebar.federations")} trailing={t("frontends.overview.sidebar.soon")} disabled />
      </div>
      <div className="flex-1" />
      {onOpenImport || profile || showLanguage || showTheme ? (
        <div className="flex flex-col gap-1.5 border-t border-line px-2.5 py-2">
          {onOpenImport ? <NavItem icon={<Upload />} label={t("frontends.overview.sidebar.importFiles")} onClick={onOpenImport} /> : null}
          {profile ? (
            <Profile
              aria-label={t("frontends.overview.sidebar.profile")}
              name={profile.name}
              detail={profile.detail}
              avatar={<Avatar initials={profile.initials} tone="select-pill" />}
              onClick={onOpenProfile}
            />
          ) : null}
          {showLanguage || showTheme ? (
            <div className="flex items-center justify-between gap-2 px-1">
              {showLanguage ? (
                <Menu pendingAnnouncement={t("common.working")}>
                  <MenuTrigger
                    aria-label={t("frontends.overview.sidebar.languageCurrent", { code: short })}
                    className={cn("inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-panel px-2.5 text-xs font-semibold text-muted hover:bg-surface", focusRing)}
                  >
                    <Languages aria-hidden="true" className="size-3.5" />
                    {short}
                  </MenuTrigger>
                  <MenuContent align="start">
                    <MenuRadioGroup value={language} onValueChange={(next) => typeof next === "string" && onLanguageChange(next)}>
                      {options.map((option) => (
                        <MenuRadioItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuContent>
                </Menu>
              ) : (
                <span />
              )}
              {showTheme ? (
                <ThemeSwitch
                  compact
                  value={theme}
                  onValueChange={onThemeChange}
                  labels={{ label: t("theme.label"), system: t("theme.system"), light: t("theme.light"), dark: t("theme.dark") }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
