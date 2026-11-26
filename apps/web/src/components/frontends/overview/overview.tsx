import { useHotkey } from "@tanstack/react-hotkeys";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { EmptyIllustration } from "@/components/ui/empty-illustration";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { CreateForm } from "./create-form";
import { DeleteDialog } from "./delete-dialog";
import { errorText, filterWorkspaces, sameView, workspacesView } from "./model";
import { Sidebar } from "./sidebar";
import { initialOverviewState, OverviewRegion } from "./store";
import type { ActionResult, OverviewProps, OverviewView, WorkspaceEntry } from "./types";
import { WorkspaceItem } from "./workspace-item";

export function Overview(props: OverviewProps) {
  return (
    <OverviewRegion.Provider initial={initialOverviewState}>
      <OverviewView {...props} />
    </OverviewRegion.Provider>
  );
}

type FailureKind = "create" | "rename" | "delete" | "archive" | "restore" | "cover" | "move";
type PendingFocus = { removedId: string; targetId: string | null };

const gridClasses = "grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6";

function OverviewView({
  workspaces,
  projects = [],
  profile,
  loading = false,
  error = null,
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
  onOpenImport,
  onOpenProfile,
  className,
}: OverviewProps) {
  const { t } = useTranslation();
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
  const now = nowProp ?? Date.now();

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
        setFailure(t(`frontends.overview.failures.${kind}`, { reason: errorText(reason) }));
        return false;
      }
    },
    [t],
  );

  const visible = useMemo(() => filterWorkspaces(workspaces, view, query), [workspaces, view, query]);
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

  const requestDelete = (id: string) => {
    const index = visible.findIndex((workspace) => workspace.id === id);
    const neighbour = visible[index + 1] ?? visible[index - 1];
    pendingFocus.current = { removedId: id, targetId: neighbour?.id ?? null };
    actions.askDelete(id);
  };

  const confirmDelete = async (id: string) => {
    const ok = await run("delete", () => onDelete(id));
    if (!ok) pendingFocus.current = null;
  };

  const pickCover = (id: string) => {
    coverFor.current = id;
    coverInput.current?.click();
  };

  const count = visible.length;
  const archivedView = view.kind === "archived";
  const project = view.kind === "project" ? projects.find((entry) => entry.id === view.id) : undefined;
  const heading = archivedView ? t("frontends.overview.archivedTitle") : (project?.name ?? t("frontends.overview.title"));
  const lead = archivedView ? t("frontends.overview.leadArchived", { count }) : t("frontends.overview.leadWorkspaces", { count });
  const searching = query.trim() !== "";
  const showList = !loading && count > 0;

  const emptyTitle = searching
    ? t("frontends.overview.states.noResults")
    : archivedView
      ? t("frontends.overview.states.emptyArchived")
      : project
        ? t("frontends.overview.states.emptyProject")
        : t("frontends.overview.states.empty");

  const newButton = (
    <Button ref={createButton} onClick={actions.openCreate} className="h-9">
      <Plus aria-hidden="true" />
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
        onOpenImport={onOpenImport}
        onOpenProfile={onOpenProfile}
      />
      <main aria-labelledby="overview-heading" aria-busy={loading || undefined} className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto px-10 py-7">
        <div className="flex flex-col gap-3">
          {project ? (
            <Breadcrumb
              label={t("frontends.overview.path")}
              items={[{ label: t("frontends.overview.pathProjects"), onSelect: () => changeView(workspacesView) }, { label: project.name }]}
            />
          ) : null}
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex min-w-0 flex-col gap-2">
              <h1 id="overview-heading" className="truncate text-[28px] leading-tight font-bold tracking-tight">
                {heading}
              </h1>
              <p className="max-w-xl text-sm leading-normal text-muted">{loading ? t("frontends.overview.states.loading") : error && count === 0 ? null : lead}</p>
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
        {error ? (
          <ErrorBanner
            action={
              onRetry ? (
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  {t("frontends.overview.states.retry")}
                </Button>
              ) : undefined
            }
          >
            {t("frontends.overview.states.listFail", { reason: error })}
          </ErrorBanner>
        ) : null}
        {failure ? <ErrorBanner>{failure}</ErrorBanner> : null}
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
                now={now}
                buttons={buttons}
                onOpen={onOpen}
                onRename={(id, name) => void run("rename", () => onRename(id, name))}
                onRequestDelete={requestDelete}
                onArchive={(id) => void run("archive", () => onArchive(id))}
                onRestore={(id) => void run("restore", () => onRestore(id))}
                onPickCover={pickCover}
                onDropCover={(id, file) => void run("cover", () => onChangeCover(id, file))}
                onRemoveCover={(id) => void run("cover", () => onChangeCover(id, null))}
                onMove={(id, projectId) => void run("move", () => onMoveToProject(id, projectId))}
              />
            ))}
          </ul>
        ) : null}
        {!loading && count === 0 && !error ? (
          <EmptyState
            illustration={<EmptyIllustration kind={searching ? "no-results" : "first-use"} />}
            title={emptyTitle}
            action={!searching && !archivedView && !creating ? <Button onClick={actions.openCreate}><Plus aria-hidden="true" />{t("frontends.overview.newWorkspace")}</Button> : undefined}
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
