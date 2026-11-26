import { Archive, Briefcase, Globe, Layers, Network, Plus, Upload } from "lucide-react";
import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/icon-button";
import { NavItem } from "@/components/ui/nav-item";
import { Profile } from "@/components/ui/profile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchField } from "@/components/ui/search-field";
import { SectionHeader } from "@/components/ui/section-header";
import { Tooltip } from "@/components/ui/tooltip";
import { sameView } from "./model";
import type { OverviewProfile, OverviewView, ProjectEntry, WorkspaceEntry } from "./types";

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
  onOpenImport?: () => void;
  onOpenProfile?: () => void;
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
  onOpenImport,
  onOpenProfile,
}: SidebarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(view.kind === "project" ? [view.id] : []));
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
          shortcut={t("frontends.overview.sidebar.searchShortcut")}
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
          onCreateProject ? (
            <Tooltip content={t("frontends.overview.sidebar.newProject")} side="bottom">
              <IconButton size="xs" aria-label={t("frontends.overview.sidebar.newProject")} onClick={onCreateProject}>
                <Plus aria-hidden="true" />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
      />
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
      {onOpenImport || profile ? (
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
        </div>
      ) : null}
    </aside>
  );
}
