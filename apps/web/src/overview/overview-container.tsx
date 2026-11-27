import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Overview } from "@/components/frontends/overview";
import { toProjectEntries, toWorkspaceEntries } from "@/adapters/workspaces";
import { errorText } from "@/data/api";
import { openWorkspace, useWorkspaceActions, useWorkspaces, useWorkspacesFollow, type PreviewShape } from "@/data/queries/workspaces";
import { showStatusToast } from "@/lib/notify";
import { RegionProfiler } from "@/perf";
import { coverBody } from "./cover-image";
import { previewFor } from "./workspace-preview";
import { OverviewNotice } from "./overview-notice";

/**
 * `/`: the workspaces the server lists (active and archived in one list, the frontend filters by view and search),
 * the folders as projects, and every action of the cards. It never reads the live document: the list follows the
 * server through `useWorkspacesFollow`, which renders nothing, so a stream of deltas does not touch the grid.
 */
export function OverviewContainer() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useWorkspaces();
  const actions = useWorkspaceActions();
  useWorkspacesFollow();
  const workspaces = useMemo(() => toWorkspaceEntries(query.data?.workspaces ?? []), [query.data]);
  const folders = query.data?.folders;
  const projects = useMemo(() => toProjectEntries(folders ?? []), [folders]);
  const previews = useMemo(() => {
    const map = new Map<string, readonly PreviewShape[]>();
    for (const workspace of query.data?.workspaces ?? []) if (workspace.preview?.length) map.set(workspace.id, workspace.preview);
    return map;
  }, [query.data]);
  const renderPreview = useCallback(
    (workspace: { id: string }): ReactNode => {
      const shapes = previews.get(workspace.id);
      return shapes ? previewFor(shapes) : undefined;
    },
    [previews],
  );
  const { refetch } = query;
  const onRetry = useCallback(() => void refetch(), [refetch]);

  const onOpen = useCallback(
    (id: string) => {
      void navigate({ to: "/w/$workspaceId", params: { workspaceId: id } });
      openWorkspace(id).catch((error: unknown) => {
        showStatusToast({ status: "danger", title: t("app.overview.openFailed"), description: errorText(error) });
      });
    },
    [navigate, t],
  );
  const onCreate = useCallback(async (name: string) => onOpen((await actions.create(name)).id), [actions, onOpen]);
  const onRename = useCallback((id: string, name: string) => actions.rename(id, name), [actions]);
  const onDelete = useCallback((id: string) => actions.remove(id), [actions]);
  const onArchive = useCallback((id: string) => actions.archive(id), [actions]);
  const onRestore = useCallback((id: string) => actions.unarchive(id), [actions]);
  const onChangeCover = useCallback(
    async (id: string, file: File | null) => {
      if (!file) return actions.clearCover(id);
      return actions.setCover(id, await coverBody(file, t("app.overview.coverConvertFailed")));
    },
    [actions, t],
  );
  const onMoveToProject = useCallback((id: string, projectId: string | null) => actions.move(id, projectId), [actions]);
  const onSubmitProject = useCallback((name: string) => actions.createFolder(name), [actions]);

  return (
    <div className="h-dvh">
      <RegionProfiler id="overview">
        <Overview
          workspaces={workspaces}
          projects={projects}
          loading={query.isPending}
          error={query.isError ? errorText(query.error) || t("app.overview.loadFailed") : null}
          renderPreview={renderPreview}
          onRetry={onRetry}
          onOpen={onOpen}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={onDelete}
          onArchive={onArchive}
          onRestore={onRestore}
          onChangeCover={onChangeCover}
          onMoveToProject={onMoveToProject}
          onSubmitProject={onSubmitProject}
        />
      </RegionProfiler>
      <RegionProfiler id="overview-notice">
        <OverviewNotice />
      </RegionProfiler>
    </div>
  );
}
