import { useHotkey } from "@tanstack/react-hotkeys";
import { Ellipsis } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
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

const metaClockMs = 30_000;

/**
 * "1,204 nodes · 5 minutes ago": a leaf with its own clock. The tick reads the clock but only sets state when the sentence
 * would change, so a grid left open for hours re-renders no card until a label really turns over (the clock used to live in
 * `Overview` and rebuilt every card every 30 s). `now` fixes the clock (tests, previews).
 */
function CardMeta({ count, at, now }: { count: number; at: number; now?: number }) {
  const { t, i18n } = useTranslation();
  // The reading belongs to the `at` it was taken for: a card whose workspace was just edited reads the clock again.
  const [stamp, setStamp] = useState(() => ({ at, clock: now ?? Date.now() }));
  const shown = now ?? (stamp.at === at ? stamp.clock : Date.now());
  const label = (time: number) => t("frontends.overview.card.meta", { count, when: relativeTime(at, i18n.language, t("frontends.overview.card.now"), time) });
  const latest = useRef({ label, shown, at });
  latest.current = { label, shown, at };
  useEffect(() => {
    if (now !== undefined) return;
    const id = setInterval(() => {
      const next = Date.now();
      const { label: current, shown: before, at: forAt } = latest.current;
      if (current(next) !== current(before)) setStamp({ at: forAt, clock: next });
    }, metaClockMs);
    return () => clearInterval(id);
  }, [now]);
  return <>{label(shown)}</>;
}

export type WorkspaceItemProps = {
  workspace: WorkspaceEntry;
  projects: readonly ProjectEntry[];
  preview?: ReactNode;
  now?: number;
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

export const WorkspaceItem = memo(function WorkspaceItem({
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
  const { t } = useTranslation();
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
        meta={<CardMeta count={workspace.nodes} at={workspace.updatedAt} now={now} />}
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
              <MenuContent align="end" className="w-63.75">
                <MenuItem shortcut="Enter" onSelect={() => onOpen(id)}>
                  {t("frontends.overview.card.open")}
                </MenuItem>
                <MenuItem shortcut="F2" onSelect={startRename}>
                  {t("frontends.overview.card.rename")}
                </MenuItem>
                <MenuItem onSelect={() => onPickCover(id)}>
                  {workspace.cover ? t("frontends.overview.card.changeCover") : t("frontends.overview.card.addCover")}
                </MenuItem>
                {workspace.cover ? (
                  <MenuItem onSelect={() => onRemoveCover(id)}>
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
                  <MenuItem onSelect={() => onRestore(id)}>
                    {t("frontends.overview.card.restore")}
                  </MenuItem>
                ) : (
                  <MenuItem disabled={!canArchive} onSelect={() => onArchive(id)}>
                    {t("frontends.overview.card.archive")}
                  </MenuItem>
                )}
                <MenuItem destructive shortcut="Del" disabled={!canDelete} onSelect={() => onRequestDelete(id)}>
                  {t("frontends.overview.card.delete")}
                </MenuItem>
              </MenuContent>
            </Menu>
          )
        }
      />
    </li>
  );
});
