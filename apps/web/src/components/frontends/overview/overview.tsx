import { useHotkey } from "@tanstack/react-hotkeys";
import { Archive } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { EmptyIllustration } from "@/components/ui/empty-illustration";
import { EmptyState } from "@/components/ui/empty-state";
import { errorMessageOr } from "@/lib/use-async-action";
import { NoticeCard } from "@/components/ui/notice-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { CreateForm } from "./create-form";
import { DeleteDialog } from "./delete-dialog";
import { filterWorkspaces, sameView, workspacesView } from "./model";
import { Sidebar } from "./sidebar";
import { initialOverviewState, OverviewRegion } from "./store";
import type { ActionResult, OverviewProps, OverviewView, ProjectEntry, WorkspaceEntry } from "./types";
import { WorkspaceItem } from "./workspace-item";

export function Overview(props: OverviewProps) {
  return (
    <OverviewRegion.Provider initial={initialOverviewState}>
      <OverviewView {...props} />
    </OverviewRegion.Provider>
  );
}

type FailureKind = "create" | "rename" | "delete" | "archive" | "restore" | "cover" | "move" | "project";
type PendingFocus = { removedId: string; targetId: string | null };

const staleFocusMs = 1000;
const noProjects: readonly ProjectEntry[] = [];
const gridClasses = "grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6";

function OverviewView({
  workspaces,
  projects = noProjects,
  profile,
  loading = false,
  error: listError = null,
  view: controlledView,
  defaultView = workspacesView,
  confirmDeleteByName = true,
  now: nowProp,
  renderPreview,
  onViewChange,
  onRetry,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onArchive,
  onRestore,
  onChangeCover,
  onMoveToProject,
  onCreateProject,
  onSubmitProject,
  onOpenImport,
  onOpenProfile,
  theme,
  onThemeChange,
  language,
  languages,
  onLanguageChange,
  className,
}: OverviewProps) {
  const { t } = useTranslation();
  const error = listError === null ? null : listError.trim() || t("frontends.overview.unknownError");
  const actions = OverviewRegion.useRegionActions();
  const creating = OverviewRegion.useRegion((s) => s.creating);
  const deletingId = OverviewRegion.useRegion((s) => s.deletingId);
  const [innerView, setInnerView] = useState<OverviewView>(defaultView);
  const [query, setQuery] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const view = controlledView ?? innerView;
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const coverFor = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<PendingFocus | null>(null);
  const returnToCreate = useRef(false);
  const confirmed = useRef(false);
  const staleFocus = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(staleFocus.current), []);
  const headingId = useId();

  const changeView = (next: OverviewView) => {
    if (controlledView === undefined) setInnerView(next);
    if (!sameView(view, next)) onViewChange?.(next);
  };

  const run = useCallback(
    async (kind: FailureKind, action: () => ActionResult): Promise<boolean> => {
      try {
        await action();
        setFailure(null);
        return true;
      } catch (reason) {
        setFailure(t(`frontends.overview.failures.${kind}`, { reason: errorMessageOr(reason, t("frontends.overview.unknownError")) }));
        return false;
      }
    },
    [t],
  );

  const visible = useMemo(() => filterWorkspaces(workspaces, view, query), [workspaces, view, query]);
  // The cards are memoized: what they receive must keep its identity while their own data does not change, so the owner's
  // callbacks are read through a ref and the handlers below depend only on `run`.
  const owner = useRef({ onRename, onArchive, onRestore, onChangeCover, onMoveToProject });
  owner.current = { onRename, onArchive, onRestore, onChangeCover, onMoveToProject };
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const renameCard = useCallback((id: string, name: string) => void run("rename", () => owner.current.onRename(id, name)), [run]);
  const archiveCard = useCallback((id: string) => void run("archive", () => owner.current.onArchive(id)), [run]);
  const restoreCard = useCallback((id: string) => void run("restore", () => owner.current.onRestore(id)), [run]);
  const dropCover = useCallback((id: string, file: File) => void run("cover", () => owner.current.onChangeCover(id, file)), [run]);
  const removeCover = useCallback((id: string) => void run("cover", () => owner.current.onChangeCover(id, null)), [run]);
  const moveCard = useCallback((id: string, projectId: string | null) => void run("move", () => owner.current.onMoveToProject(id, projectId)), [run]);
  const deletingEntry = useRef<WorkspaceEntry | null>(null);
  const found = workspaces.find((workspace) => workspace.id === deletingId);
  if (found) deletingEntry.current = found;
  const deleting = found ?? (deletingEntry.current?.id === deletingId ? deletingEntry.current : undefined);

  useHotkey("Mod+K", () => searchRef.current?.focus(), { target: root });

  useLayoutEffect(() => {
    if (creating || !returnToCreate.current) return;
    returnToCreate.current = false;
    createButton.current?.focus();
  }, [creating]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || deletingId !== null || workspaces.some((workspace) => workspace.id === pending.removedId)) return;
    pendingFocus.current = null;
    const neighbour = pending.targetId === null ? undefined : buttons.current.get(pending.targetId);
    (neighbour ?? createButton.current)?.focus();
  }, [workspaces, deletingId]);

  useEffect(() => {
    if (deletingId !== null && !deleting) actions.cancelDelete();
  }, [deletingId, deleting, actions]);

  const closeCreate = () => {
    returnToCreate.current = true;
    actions.closeCreate();
  };

  const requestDelete = useCallback(
    (id: string) => {
      const list = visibleRef.current;
      const index = list.findIndex((workspace) => workspace.id === id);
      const neighbour = list[index + 1] ?? list[index - 1];
      pendingFocus.current = { removedId: id, targetId: neighbour?.id ?? null };
      actions.askDelete(id);
    },
    [actions],
  );

  const confirmDelete = async (id: string) => {
    const ok = await run("delete", () => onDelete(id));
    if (!ok) {
      pendingFocus.current = null;
      return;
    }
    const pending = pendingFocus.current;
    clearTimeout(staleFocus.current);
    staleFocus.current = setTimeout(() => {
      if (pendingFocus.current === pending) pendingFocus.current = null;
    }, staleFocusMs);
  };

  const pickCover = useCallback((id: string) => {
    coverFor.current = id;
    coverInput.current?.click();
  }, []);

  const count = visible.length;
  const archivedView = view.kind === "archived";
  const project = view.kind === "project" ? projects.find((entry) => entry.id === view.id) : undefined;
  const heading = archivedView ? t("frontends.overview.archivedTitle") : (project?.name ?? t("frontends.overview.title"));
  const lead = archivedView ? t("frontends.overview.leadArchived", { count }) : t("frontends.overview.leadWorkspaces", { count });
  const searching = query.trim() !== "";
  const showList = !loading && count > 0;
  // With nothing to list the line is only noise ("0 workspaces. Click to open; F2 renames."): the empty state says it.
  const supportText = loading ? t("frontends.overview.states.loading") : count === 0 ? null : lead;

  const emptyTitle = searching
    ? t("frontends.overview.states.noResults")
    : archivedView
      ? t("frontends.overview.states.emptyArchived")
      : project
        ? t("frontends.overview.states.emptyProject")
        : t("frontends.overview.states.empty");

  const newButton = (
    <Button ref={createButton} onClick={actions.openCreate} className="h-9">
      {t("frontends.overview.newWorkspace")}
    </Button>
  );

  return (
    <div ref={root} className={cn("flex h-full min-h-0 bg-bg text-fg", className)}>
      <Sidebar
        view={view}
        workspaces={workspaces}
        projects={projects}
        profile={profile}
        query={query}
        searchRef={searchRef}
        onQueryChange={setQuery}
        onViewChange={changeView}
        onOpen={onOpen}
        onCreateProject={onCreateProject}
        onSubmitProject={onSubmitProject ? (name) => run("project", () => onSubmitProject(name)) : undefined}
        onOpenImport={onOpenImport}
        onOpenProfile={onOpenProfile}
        theme={theme}
        onThemeChange={onThemeChange}
        language={language}
        languages={languages}
        onLanguageChange={onLanguageChange}
      />
      <main aria-labelledby={headingId} aria-busy={loading || undefined} className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto px-10 py-7">
        <div className="flex flex-col gap-3">
          {project ? (
            <Breadcrumb
              label={t("frontends.overview.path")}
              items={[{ label: t("frontends.overview.pathProjects"), onSelect: () => changeView(workspacesView) }, { label: project.name }]}
            />
          ) : null}
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex min-w-0 flex-col gap-2">
              <h1 id={headingId} className="truncate text-[28px] leading-tight font-bold tracking-tight">
                {heading}
              </h1>
              {supportText ? <p className="max-w-xl text-base leading-[1.5] text-muted">{supportText}</p> : null}
            </div>
            {creating ? (
              <CreateForm
                onSubmit={async (name) => {
                  const ok = await run("create", () => onCreate(name));
                  if (ok) closeCreate();
                  return ok;
                }}
                onCancel={closeCreate}
              />
            ) : (
              newButton
            )}
          </div>
        </div>
        {error !== null ? (
          <NoticeCard
            variant="band"
            status="danger"
            role="alert"
            title={t("frontends.overview.states.listFail", { reason: error })}
            actions={
              onRetry ? (
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  {t("frontends.overview.states.retry")}
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {failure ? <NoticeCard variant="band" status="danger" role="alert" title={failure} /> : null}
        {loading ? (
          <div role="status" aria-label={t("frontends.overview.states.loadingList")} className={gridClasses}>
            {[0, 1, 2].map((index) => (
              <div key={index} className="overflow-hidden rounded-xl border border-line bg-panel">
                <Skeleton className="h-42 rounded-none" />
                <div className="flex flex-col gap-2 p-3.5">
                  <Skeleton className="h-3 w-36" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
            ))}
            <Spinner className="sr-only" />
          </div>
        ) : null}
        {showList ? (
          <ul aria-label={t("frontends.overview.list")} className={gridClasses}>
            {visible.map((workspace) => (
              <WorkspaceItem
                key={workspace.id}
                workspace={workspace}
                projects={projects}
                preview={renderPreview?.(workspace)}
                now={nowProp}
                buttons={buttons}
                onOpen={onOpen}
                onRename={renameCard}
                onRequestDelete={requestDelete}
                onArchive={archiveCard}
                onRestore={restoreCard}
                onPickCover={pickCover}
                onDropCover={dropCover}
                onRemoveCover={removeCover}
                onMove={moveCard}
              />
            ))}
          </ul>
        ) : null}
        {!loading && count === 0 && error === null && archivedView && !searching ? (
          <p role="status" className="flex items-center gap-2.5 rounded-lg bg-surface px-3.5 py-2.5 text-base text-muted">
            <Archive aria-hidden="true" className="size-4 shrink-0" />
            {emptyTitle}
          </p>
        ) : null}
        {!loading && count === 0 && error === null && !(archivedView && !searching) ? (
          <EmptyState
            illustration={<EmptyIllustration kind={searching ? "no-results" : "first-use"} />}
            title={emptyTitle}
            action={!searching && !archivedView && !creating ? <Button onClick={actions.openCreate}>{t("frontends.overview.newWorkspace")}</Button> : undefined}
          />
        ) : null}
        <input
          ref={coverInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          aria-label={t("frontends.overview.card.coverInput")}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            const id = coverFor.current;
            if (file && id) void run("cover", () => onChangeCover(id, file));
          }}
        />
      </main>
      {deleting ? (
        <DeleteDialog
          workspace={deleting}
          requireName={confirmDeleteByName}
          finalFocus={() => buttons.current.get(deleting.id) ?? createButton.current}
          onCancel={() => {
            if (!confirmed.current) pendingFocus.current = null;
            confirmed.current = false;
            actions.cancelDelete();
          }}
          onConfirm={async (id) => {
            confirmed.current = true;
            await confirmDelete(id);
          }}
        />
      ) : null}
    </div>
  );
}
