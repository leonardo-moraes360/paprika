import { useHotkey } from "@tanstack/react-hotkeys";
import { Archive, ArchiveRestore, Ellipsis, ImagePlus, ImageOff, Pencil, Trash2, ExternalLink } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/icon-button";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { WorkspaceCard } from "@/components/ui/workspace-card";
import { relativeTime } from "./model";
import { CoverPreview } from "./preview";
import { OverviewRegion } from "./store";
import type { ProjectEntry, WorkspaceEntry } from "./types";

const noProject = "__none__";
const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type WorkspaceItemProps = {
  workspace: WorkspaceEntry;
  projects: readonly ProjectEntry[];
  preview?: ReactNode;
  now: number;
  buttons: RefObject<Map<string, HTMLButtonElement>>;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRequestDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onPickCover: (id: string) => void;
  onDropCover: (id: string, file: File) => void;
  onRemoveCover: (id: string) => void;
  onMove: (id: string, projectId: string | null) => void;
};

export function WorkspaceItem({
  workspace,
  projects,
  preview,
  now,
  buttons,
  onOpen,
  onRename,
  onRequestDelete,
  onArchive,
  onRestore,
  onPickCover,
  onDropCover,
  onRemoveCover,
  onMove,
}: WorkspaceItemProps) {
  const { t, i18n } = useTranslation();
  const actions = OverviewRegion.useRegionActions();
  const renaming = OverviewRegion.useRegion((s) => s.renamingId === workspace.id);
  const item = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const settled = useRef(false);
  const returnFocus = useRef(false);
  const [dropping, setDropping] = useState(false);
  const { id, name } = workspace;
  const archived = workspace.archived === true;
  const canDelete = workspace.canDelete !== false;
  const canArchive = workspace.canArchive !== false;

  const openRef = useCallback(
    (element: HTMLButtonElement | null) => {
      button.current = element;
      if (element) buttons.current.set(id, element);
      else buttons.current.delete(id);
    },
    [buttons, id],
  );

  useLayoutEffect(() => {
    if (renaming || !returnFocus.current) return;
    returnFocus.current = false;
    button.current?.focus();
  }, [renaming]);

  const startRename = () => {
    settled.current = false;
    actions.startRename(id);
  };

  const finishRename = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    returnFocus.current = item.current?.contains(document.activeElement) ?? false;
    actions.stopRename();
    const next = value?.trim();
    if (next && next !== name) onRename(id, next);
  };

  useHotkey("F2", startRename, { target: item, enabled: !renaming });
  useHotkey("Delete", () => onRequestDelete(id), { target: item, enabled: !renaming && canDelete });

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const projectValue = workspace.projectId ?? noProject;

  return (
    <li
      ref={item}
      data-workspace-id={id}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        setDropping(false);
        const file = event.dataTransfer.files[0];
        if (!file || !imageTypes.includes(file.type)) return;
        event.preventDefault();
        onDropCover(id, file);
      }}
    >
      <WorkspaceCard
        name={name}
        meta={t("frontends.overview.card.meta", {
          count: workspace.nodes,
          when: relativeTime(workspace.updatedAt, i18n.language, t("frontends.overview.card.now"), now),
        })}
        preview={<CoverPreview cover={workspace.cover} name={name} custom={preview} />}
        active={workspace.active === true}
        activeLabel={t("frontends.overview.card.active")}
        archivedLabel={archived ? t("frontends.overview.card.archived") : undefined}
        dropping={dropping}
        droppingLabel={t("frontends.overview.card.dropCover")}
        renaming={renaming}
        renameLabel={t("frontends.overview.card.renameLabel")}
        openRef={openRef}
        onOpen={() => onOpen(id)}
        onRename={finishRename}
        onRenameCancel={() => finishRename(null)}
        menu={
          renaming ? null : (
            <Menu pendingAnnouncement={t("common.working")}>
              <MenuTrigger render={<IconButton size="sm" bordered aria-label={t("frontends.overview.card.more")} className="bg-popover" />}>
                <Ellipsis aria-hidden="true" />
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={<ExternalLink aria-hidden="true" />} shortcut="Enter" onSelect={() => onOpen(id)}>
                  {t("frontends.overview.card.open")}
                </MenuItem>
                <MenuItem icon={<Pencil aria-hidden="true" />} shortcut="F2" onSelect={startRename}>
                  {t("frontends.overview.card.rename")}
                </MenuItem>
                <MenuItem icon={<ImagePlus aria-hidden="true" />} onSelect={() => onPickCover(id)}>
                  {workspace.cover ? t("frontends.overview.card.changeCover") : t("frontends.overview.card.addCover")}
                </MenuItem>
                {workspace.cover ? (
                  <MenuItem icon={<ImageOff aria-hidden="true" />} onSelect={() => onRemoveCover(id)}>
                    {t("frontends.overview.card.removeCover")}
                  </MenuItem>
                ) : null}
                {projects.length > 0 ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>
                        {t("frontends.overview.card.moveToProject")}
                      </MenuGroupLabel>
                      <MenuRadioGroup value={projectValue} onValueChange={(next) => onMove(id, next === noProject ? null : next)}>
                        <MenuRadioItem value={noProject}>{t("frontends.overview.card.noProject")}</MenuRadioItem>
                        {projects.map((project) => (
                          <MenuRadioItem key={project.id} value={project.id}>
                            {project.name}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </>
                ) : null}
                <MenuSeparator />
                {archived ? (
                  <MenuItem icon={<ArchiveRestore aria-hidden="true" />} onSelect={() => onRestore(id)}>
                    {t("frontends.overview.card.restore")}
                  </MenuItem>
                ) : (
                  <MenuItem icon={<Archive aria-hidden="true" />} disabled={!canArchive} onSelect={() => onArchive(id)}>
                    {t("frontends.overview.card.archive")}
                  </MenuItem>
                )}
                <MenuItem icon={<Trash2 aria-hidden="true" />} destructive shortcut="Del" disabled={!canDelete} onSelect={() => onRequestDelete(id)}>
                  {t("frontends.overview.card.delete")}
                </MenuItem>
              </MenuContent>
            </Menu>
          )
        }
      />
    </li>
  );
}
